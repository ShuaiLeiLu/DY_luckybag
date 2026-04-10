package license

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	bindSessionTTL = 5 * time.Minute
)

// BindSession 描述扫码绑定授权会话。
type BindSession struct {
	BindToken      string  `json:"bindToken"`
	SceneCode      string  `json:"sceneCode"`
	Status         string  `json:"status"`
	Message        string  `json:"message"`
	ClientID       string  `json:"clientId"`
	Fingerprint    string  `json:"fingerprint"`
	AppVersion     string  `json:"appVersion"`
	WechatOpenID   string  `json:"wechatOpenId"`
	WechatUnionID  string  `json:"wechatUnionId"`
	WechatNickname string  `json:"wechatNickname"`
	LicenseID      int64   `json:"licenseId"`
	AdUnlockDays   int     `json:"adUnlockDays"`
	ExpireAtMS     int64   `json:"expireAt"`
	RemainingSec   int64   `json:"remainingSec"`
	ScannedAtMS    int64   `json:"scannedAt"`
	GrantedAtMS    int64   `json:"grantedAt"`
	Authorized     bool    `json:"authorized"`
	SignedToday    bool    `json:"signedToday"`
	License        *Status `json:"license,omitempty"`
}

// CreateBindSessionRequest 描述客户端创建扫码绑定会话的请求。
type CreateBindSessionRequest struct {
	ClientID     string
	Fingerprint  string
	AppVersion   string
	AdUnlockDays int
}

// BindSessionScanRequest 描述小程序扫码登录回写请求。
type BindSessionScanRequest struct {
	BindToken string
	OpenID    string
	UnionID   string
	Nickname  string
}

// BindSessionGrantRequest 描述每日签到后的授权续期请求。
type BindSessionGrantRequest struct {
	BindToken string
	Days      int
	OpenID    string
}

type bindSessionRow struct {
	ID             int64
	BindToken      string
	ClientID       string
	Fingerprint    string
	AppVersion     string
	Status         string
	WechatOpenID   string
	WechatUnionID  string
	WechatNickname string
	LicenseID      sql.NullInt64
	AdUnlockDays   int
	ExpireAt       time.Time
	ScannedAt      sql.NullTime
	GrantedAt      sql.NullTime
}

// CreateBindSession 为客户端创建一个短时有效的扫码绑定会话。
func (s *Service) CreateBindSession(ctx context.Context, req CreateBindSessionRequest) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	clientID := strings.TrimSpace(req.ClientID)
	fingerprint := normalizeMachineFingerprint(req.Fingerprint)
	if clientID == "" || fingerprint == "" {
		return BindSession{}, fmt.Errorf("clientId and valid fingerprint required")
	}

	currentStatus, err := s.Status(ctx, clientID, fingerprint)
	if err == nil && currentStatus.Unrestricted {
		return BindSession{
			Status:       "authorized",
			Message:      "服务端免授权已开启，无需绑定",
			ClientID:     clientID,
			Fingerprint:  fingerprint,
			AppVersion:   strings.TrimSpace(req.AppVersion),
			Authorized:   true,
			AdUnlockDays: normalizeAdUnlockDays(req.AdUnlockDays),
			License:      &currentStatus,
		}, nil
	}

	if existing, err := s.findReusableBindSession(ctx, clientID, fingerprint); err == nil {
		return s.buildBindSession(ctx, existing, time.Now())
	}

	token, err := generateBindToken()
	if err != nil {
		return BindSession{}, err
	}
	now := time.Now()
	expireAt := now.Add(bindSessionTTL)
	adUnlockDays := normalizeAdUnlockDays(req.AdUnlockDays)
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO license_bind_sessions (
			bind_token,
			client_id,
			fingerprint,
			app_version,
			status,
			ad_unlock_days,
			expire_at,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())
	`, token, clientID, fingerprint, strings.TrimSpace(req.AppVersion), adUnlockDays, expireAt); err != nil {
		return BindSession{}, err
	}
	row, err := s.findBindSessionByToken(ctx, token)
	if err != nil {
		return BindSession{}, err
	}
	return s.buildBindSession(ctx, row, now)
}

// GetBindSession 查询绑定会话状态，供客户端轮询。
func (s *Service) GetBindSession(ctx context.Context, bindToken string) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	row, err := s.findBindSessionByToken(ctx, bindToken)
	if err != nil {
		return BindSession{}, err
	}
	return s.buildBindSession(ctx, row, time.Now())
}

// MarkBindSessionScanned 标记扫码会话已被小程序登录用户接管。
func (s *Service) MarkBindSessionScanned(ctx context.Context, req BindSessionScanRequest) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	token := strings.TrimSpace(req.BindToken)
	if token == "" {
		return BindSession{}, fmt.Errorf("bindToken required")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BindSession{}, err
	}
	defer func() { _ = tx.Rollback() }()

	row, err := s.findBindSessionByTokenTx(ctx, tx, token)
	if err != nil {
		return BindSession{}, err
	}
	now := time.Now()
	if isBindSessionExpired(row, now) && !row.GrantedAt.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE license_bind_sessions SET status='expired', updated_at=NOW() WHERE id=?`, row.ID); err != nil {
			return BindSession{}, err
		}
		if err := tx.Commit(); err != nil {
			return BindSession{}, err
		}
		updated, getErr := s.findBindSessionByToken(ctx, token)
		if getErr != nil {
			return BindSession{}, getErr
		}
		return s.buildBindSession(ctx, updated, now)
	}
	if row.GrantedAt.Valid {
		if err := tx.Commit(); err != nil {
			return BindSession{}, err
		}
		return s.buildBindSession(ctx, row, now)
	}
	if strings.TrimSpace(row.WechatOpenID) != "" && strings.TrimSpace(req.OpenID) != "" && strings.TrimSpace(row.WechatOpenID) != strings.TrimSpace(req.OpenID) {
		return BindSession{}, fmt.Errorf("bind_session_claimed_by_other_user")
	}

	nextStatus := "scanned"
	if _, err := tx.ExecContext(ctx, `
		UPDATE license_bind_sessions
		SET status = ?,
		    wechat_open_id = ?,
		    wechat_union_id = ?,
		    wechat_nickname = ?,
		    scanned_at = NOW(),
		    updated_at = NOW()
		WHERE id = ?
	`, nextStatus, strings.TrimSpace(req.OpenID), strings.TrimSpace(req.UnionID), strings.TrimSpace(req.Nickname), row.ID); err != nil {
		return BindSession{}, err
	}
	if err := tx.Commit(); err != nil {
		return BindSession{}, err
	}
	updated, err := s.findBindSessionByToken(ctx, token)
	if err != nil {
		return BindSession{}, err
	}
	return s.buildBindSession(ctx, updated, now)
}

// GrantBindSession 在小程序签到完成后为当前客户端续期授权；同一设备每天仅允许成功一次。
func (s *Service) GrantBindSession(ctx context.Context, req BindSessionGrantRequest) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	token := strings.TrimSpace(req.BindToken)
	if token == "" {
		return BindSession{}, fmt.Errorf("bindToken required")
	}
	days := normalizeSignInDays(req.Days)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BindSession{}, err
	}
	defer func() { _ = tx.Rollback() }()

	row, err := s.findBindSessionByTokenTx(ctx, tx, token)
	if err != nil {
		return BindSession{}, err
	}
	now := time.Now()
	if isBindSessionExpired(row, now) && !row.GrantedAt.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE license_bind_sessions SET status='expired', updated_at=NOW() WHERE id=?`, row.ID); err != nil {
			return BindSession{}, err
		}
		if err := tx.Commit(); err != nil {
			return BindSession{}, err
		}
		return BindSession{}, fmt.Errorf("bind_session_expired")
	}
	if strings.TrimSpace(row.WechatOpenID) == "" {
		return BindSession{}, fmt.Errorf("bind_session_not_scanned")
	}
	if strings.TrimSpace(req.OpenID) != "" && strings.TrimSpace(row.WechatOpenID) != strings.TrimSpace(req.OpenID) {
		return BindSession{}, fmt.Errorf("bind_session_claimed_by_other_user")
	}
	if err := s.recordMiniAppDailySigninTx(ctx, tx, row.ClientID, row.Fingerprint, row.WechatOpenID, days, now); err != nil {
		if isDuplicateLicenseKeyErr(err) {
			return BindSession{}, fmt.Errorf("miniapp_signin_already_claimed")
		}
		return BindSession{}, err
	}

	licenseID, err := s.grantOrExtendMiniAppLicenseTx(ctx, tx, row, days, now)
	if err != nil {
		return BindSession{}, err
	}
	if err := s.touchActivationTx(ctx, tx, licenseID, row.ClientID, row.Fingerprint, 0, row.AppVersion); err != nil {
		return BindSession{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE license_bind_sessions
		SET status = 'granted',
		    license_id = ?,
		    ad_unlock_days = ?,
		    granted_at = NOW(),
		    updated_at = NOW()
		WHERE id = ?
	`, licenseID, days, row.ID); err != nil {
		return BindSession{}, err
	}
	if err := tx.Commit(); err != nil {
		return BindSession{}, err
	}
	updated, err := s.findBindSessionByToken(ctx, token)
	if err != nil {
		return BindSession{}, err
	}
	return s.buildBindSession(ctx, updated, now)
}

func normalizeSignInDays(days int) int {
	if days <= 0 {
		return 1
	}
	if days > 30 {
		return 30
	}
	return days
}

func normalizeAdUnlockDays(days int) int {
	if days <= 0 {
		return 1
	}
	if days > 3650 {
		return 3650
	}
	return days
}

func (s *Service) recordMiniAppDailySigninTx(ctx context.Context, tx *sql.Tx, clientID, fingerprint, openID string, days int, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO miniapp_signin_records (
			client_id,
			fingerprint,
			wechat_open_id,
			sign_date,
			gain_days,
			created_at
		) VALUES (?, ?, ?, ?, ?, NOW())
	`, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint), strings.TrimSpace(openID), now.Format("2006-01-02"), normalizeSignInDays(days))
	return err
}

func (s *Service) grantOrExtendMiniAppLicenseTx(ctx context.Context, tx *sql.Tx, row bindSessionRow, days int, now time.Time) (int64, error) {
	licenseRow, found, err := s.findGrantedLicenseTx(ctx, tx, row)
	if err != nil {
		return 0, err
	}
	if found {
		baseTime := now
		if licenseRow.ExpireAt.After(now) {
			baseTime = licenseRow.ExpireAt
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE licenses
			SET expire_at = ?,
			    status = 'used',
			    updated_at = NOW()
			WHERE id = ?
		`, baseTime.Add(time.Duration(days)*24*time.Hour), licenseRow.ID); err != nil {
			return 0, err
		}
		return licenseRow.ID, nil
	}

	licenseKey, err := generateLicenseKey()
	if err != nil {
		return 0, err
	}
	featuresJSON := "{}"
	features := defaultFullFeatures(days)
	features["source"] = "daily_signin"
	features["wechatOpenId"] = strings.TrimSpace(row.WechatOpenID)
	if strings.TrimSpace(row.WechatUnionID) != "" {
		features["wechatUnionId"] = strings.TrimSpace(row.WechatUnionID)
	}
	if strings.TrimSpace(row.WechatNickname) != "" {
		features["wechatNickname"] = strings.TrimSpace(row.WechatNickname)
	}
	if b, marshalErr := json.Marshal(features); marshalErr == nil {
		featuresJSON = string(b)
	}

	res, err := tx.ExecContext(ctx, `
		INSERT INTO licenses (
			license_key, customer_name, plan_name, status, expire_at, max_clients, max_accounts, features_json, bind_client_id, bind_fingerprint
		) VALUES (?, ?, ?, 'used', ?, ?, ?, ?, ?, ?)
	`, licenseKey, strings.TrimSpace(row.WechatNickname), "daily_signin", now.Add(time.Duration(days)*24*time.Hour), 1, 999, featuresJSON, row.ClientID, row.Fingerprint)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Service) findGrantedLicenseTx(ctx context.Context, tx *sql.Tx, row bindSessionRow) (licenseRow, bool, error) {
	if row.LicenseID.Valid && row.LicenseID.Int64 > 0 {
		foundRow, err := s.findLicenseByIDTx(ctx, tx, row.LicenseID.Int64)
		if err == nil {
			return foundRow, true, nil
		}
		if err != sql.ErrNoRows {
			return licenseRow{}, false, err
		}
	}

	foundRow, err := s.findLicenseByClientTx(ctx, tx, row.ClientID, row.Fingerprint)
	if err == nil {
		return foundRow, true, nil
	}
	if err == sql.ErrNoRows {
		return licenseRow{}, false, nil
	}
	return licenseRow{}, false, err
}

func (s *Service) findLicenseByIDTx(ctx context.Context, tx *sql.Tx, id int64) (licenseRow, error) {
	row := licenseRow{}
	err := tx.QueryRowContext(ctx, `
		SELECT
			id,
			license_key,
			customer_name,
			plan_name,
			status,
			expire_at,
			max_clients,
			max_accounts,
			features_json,
			bind_client_id,
			bind_fingerprint
		FROM licenses
		WHERE id = ?
		LIMIT 1
		FOR UPDATE
	`, id).Scan(
		&row.ID,
		&row.LicenseKey,
		&row.CustomerName,
		&row.PlanName,
		&row.Status,
		&row.ExpireAt,
		&row.MaxClients,
		&row.MaxAccounts,
		&row.FeaturesJSON,
		&row.BindClientID,
		&row.BindFingerprint,
	)
	return row, err
}

func (s *Service) findLicenseByClientTx(ctx context.Context, tx *sql.Tx, clientID, fingerprint string) (licenseRow, error) {
	row := licenseRow{}
	err := tx.QueryRowContext(ctx, `
		SELECT
			id,
			license_key,
			customer_name,
			plan_name,
			status,
			expire_at,
			max_clients,
			max_accounts,
			features_json,
			bind_client_id,
			bind_fingerprint
		FROM licenses
		WHERE bind_client_id = ?
		  AND (? = '' OR bind_fingerprint = '' OR bind_fingerprint = ?)
		ORDER BY id DESC
		LIMIT 1
		FOR UPDATE
	`, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint), strings.TrimSpace(fingerprint)).Scan(
		&row.ID,
		&row.LicenseKey,
		&row.CustomerName,
		&row.PlanName,
		&row.Status,
		&row.ExpireAt,
		&row.MaxClients,
		&row.MaxAccounts,
		&row.FeaturesJSON,
		&row.BindClientID,
		&row.BindFingerprint,
	)
	return row, err
}

func generateBindToken() (string, error) {
	key, err := generateLicenseKey()
	if err != nil {
		return "", err
	}
	return strings.Replace(key, "DY-", "BT-", 1), nil
}

func isBindSessionExpired(row bindSessionRow, now time.Time) bool {
	return !row.ExpireAt.IsZero() && !row.ExpireAt.After(now)
}

func (s *Service) findReusableBindSession(ctx context.Context, clientID, fingerprint string) (bindSessionRow, error) {
	row := bindSessionRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id, bind_token, client_id, fingerprint, app_version, status,
			wechat_open_id, wechat_union_id, wechat_nickname, license_id,
			ad_unlock_days, expire_at, scanned_at, granted_at
		FROM license_bind_sessions
		WHERE client_id = ? AND fingerprint = ? AND status IN ('pending', 'scanned') AND expire_at > NOW()
		ORDER BY id DESC
		LIMIT 1
	`, clientID, fingerprint).Scan(
		&row.ID,
		&row.BindToken,
		&row.ClientID,
		&row.Fingerprint,
		&row.AppVersion,
		&row.Status,
		&row.WechatOpenID,
		&row.WechatUnionID,
		&row.WechatNickname,
		&row.LicenseID,
		&row.AdUnlockDays,
		&row.ExpireAt,
		&row.ScannedAt,
		&row.GrantedAt,
	)
	return row, err
}

func (s *Service) findBindSessionByToken(ctx context.Context, bindToken string) (bindSessionRow, error) {
	row := bindSessionRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id, bind_token, client_id, fingerprint, app_version, status,
			wechat_open_id, wechat_union_id, wechat_nickname, license_id,
			ad_unlock_days, expire_at, scanned_at, granted_at
		FROM license_bind_sessions
		WHERE bind_token = ?
		LIMIT 1
	`, strings.TrimSpace(bindToken)).Scan(
		&row.ID,
		&row.BindToken,
		&row.ClientID,
		&row.Fingerprint,
		&row.AppVersion,
		&row.Status,
		&row.WechatOpenID,
		&row.WechatUnionID,
		&row.WechatNickname,
		&row.LicenseID,
		&row.AdUnlockDays,
		&row.ExpireAt,
		&row.ScannedAt,
		&row.GrantedAt,
	)
	return row, err
}

func (s *Service) findBindSessionByTokenTx(ctx context.Context, tx *sql.Tx, bindToken string) (bindSessionRow, error) {
	row := bindSessionRow{}
	err := tx.QueryRowContext(ctx, `
		SELECT
			id, bind_token, client_id, fingerprint, app_version, status,
			wechat_open_id, wechat_union_id, wechat_nickname, license_id,
			ad_unlock_days, expire_at, scanned_at, granted_at
		FROM license_bind_sessions
		WHERE bind_token = ?
		LIMIT 1
		FOR UPDATE
	`, strings.TrimSpace(bindToken)).Scan(
		&row.ID,
		&row.BindToken,
		&row.ClientID,
		&row.Fingerprint,
		&row.AppVersion,
		&row.Status,
		&row.WechatOpenID,
		&row.WechatUnionID,
		&row.WechatNickname,
		&row.LicenseID,
		&row.AdUnlockDays,
		&row.ExpireAt,
		&row.ScannedAt,
		&row.GrantedAt,
	)
	return row, err
}

func (s *Service) buildBindSession(ctx context.Context, row bindSessionRow, now time.Time) (BindSession, error) {
	session := BindSession{
		BindToken:      strings.TrimSpace(row.BindToken),
		SceneCode:      s.buildBindSceneCode(row.ID, row.BindToken),
		Status:         strings.TrimSpace(row.Status),
		ClientID:       strings.TrimSpace(row.ClientID),
		Fingerprint:    strings.TrimSpace(row.Fingerprint),
		AppVersion:     strings.TrimSpace(row.AppVersion),
		WechatOpenID:   strings.TrimSpace(row.WechatOpenID),
		WechatUnionID:  strings.TrimSpace(row.WechatUnionID),
		WechatNickname: strings.TrimSpace(row.WechatNickname),
		AdUnlockDays:   normalizeAdUnlockDays(row.AdUnlockDays),
		ExpireAtMS:     row.ExpireAt.UnixMilli(),
		RemainingSec:   maxInt64(0, row.ExpireAt.Unix()-now.Unix()),
	}
	if row.LicenseID.Valid {
		session.LicenseID = row.LicenseID.Int64
	}
	if row.ScannedAt.Valid {
		session.ScannedAtMS = row.ScannedAt.Time.UnixMilli()
	}
	if row.GrantedAt.Valid {
		session.GrantedAtMS = row.GrantedAt.Time.UnixMilli()
	}

	if signedToday, err := s.hasMiniAppSigninToday(ctx, row.ClientID, row.Fingerprint, row.WechatOpenID, now); err == nil {
		session.SignedToday = signedToday
	}

	if isBindSessionExpired(row, now) && !row.GrantedAt.Valid {
		session.Status = "expired"
		session.Message = "小程序码已过期，请刷新后重试"
		return session, nil
	}
	switch session.Status {
	case "granted":
		session.SignedToday = true
		session.Message = "今日签到已完成，等待客户端同步"
	case "scanned":
		session.Message = "已绑定当前设备，可执行今日签到"
	case "authorized":
		session.Message = "当前客户端已授权"
	default:
		session.Status = "pending"
		session.Message = "请使用微信直接扫描小程序码，进入小程序后完成每日签到"
	}

	licenseStatus, err := s.Status(ctx, session.ClientID, session.Fingerprint)
	if err == nil {
		session.Authorized = licenseStatus.Authorized
		if licenseStatus.Enabled {
			licenseCopy := licenseStatus
			session.License = &licenseCopy
		}
		// 绑定会话状态用于驱动扫码流程（pending/scanned/granted/expired），
		// 即使当前设备已在试用/授权中，也不应覆盖为 authorized，
		// 否则前后端都会误判为“无需绑定”，导致无法生成二维码或继续扫码。
		if session.Status == "authorized" && licenseStatus.Authorized {
			session.Message = "客户端已获得完整授权"
		}
	}
	return session, nil
}

func (s *Service) hasMiniAppSigninToday(ctx context.Context, clientID, fingerprint, openID string, now time.Time) (bool, error) {
	if strings.TrimSpace(clientID) == "" || strings.TrimSpace(fingerprint) == "" {
		return false, nil
	}
	signDate := now.Format("2006-01-02")
	openID = strings.TrimSpace(openID)
	if openID != "" {
		var hit int
		err := s.db.QueryRowContext(ctx, `
			SELECT 1
			FROM miniapp_signin_records
			WHERE sign_date = ?
			  AND (wechat_open_id = ? OR (client_id = ? AND fingerprint = ?))
			LIMIT 1
		`, signDate, openID, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint)).Scan(&hit)
		if err == nil {
			return true, nil
		}
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	var hit int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1
		FROM miniapp_signin_records
		WHERE sign_date = ?
		  AND client_id = ? AND fingerprint = ?
		LIMIT 1
	`, signDate, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint)).Scan(&hit)
	if err == nil {
		return true, nil
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	return false, err
}

func (s *Service) buildBindSceneCode(id int64, bindToken string) string {
	if id <= 0 {
		return ""
	}
	idPart := strings.ToLower(strconv.FormatInt(id, 36))
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(s.cfg.MiniAppSessionSecret)+"|bind-scene"))
	_, _ = mac.Write([]byte(fmt.Sprintf("%d:%s", id, strings.TrimSpace(bindToken))))
	sign := hex.EncodeToString(mac.Sum(nil))
	if len(sign) > 8 {
		sign = sign[:8]
	}
	return "b" + idPart + "-" + sign
}

func (s *Service) resolveBindTokenBySceneCode(ctx context.Context, sceneCode string) (string, error) {
	scene := strings.TrimSpace(sceneCode)
	if scene == "" {
		return "", fmt.Errorf("bind_scene_required")
	}
	if !strings.HasPrefix(scene, "b") || !strings.Contains(scene, "-") {
		return "", fmt.Errorf("bind_scene_invalid")
	}
	parts := strings.SplitN(strings.TrimPrefix(scene, "b"), "-", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("bind_scene_invalid")
	}
	id, err := strconv.ParseInt(parts[0], 36, 64)
	if err != nil || id <= 0 {
		return "", fmt.Errorf("bind_scene_invalid")
	}
	row, err := s.findBindSessionByID(ctx, id)
	if err != nil {
		return "", err
	}
	expected := s.buildBindSceneCode(row.ID, row.BindToken)
	if !hmac.Equal([]byte(expected), []byte(scene)) {
		return "", fmt.Errorf("bind_scene_invalid")
	}
	return strings.TrimSpace(row.BindToken), nil
}

func (s *Service) findBindSessionByID(ctx context.Context, id int64) (bindSessionRow, error) {
	row := bindSessionRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id, bind_token, client_id, fingerprint, app_version, status,
			wechat_open_id, wechat_union_id, wechat_nickname, license_id,
			ad_unlock_days, expire_at, scanned_at, granted_at
		FROM license_bind_sessions
		WHERE id = ?
		LIMIT 1
	`, id).Scan(
		&row.ID,
		&row.BindToken,
		&row.ClientID,
		&row.Fingerprint,
		&row.AppVersion,
		&row.Status,
		&row.WechatOpenID,
		&row.WechatUnionID,
		&row.WechatNickname,
		&row.LicenseID,
		&row.AdUnlockDays,
		&row.ExpireAt,
		&row.ScannedAt,
		&row.GrantedAt,
	)
	return row, err
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
