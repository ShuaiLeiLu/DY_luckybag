package license

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	bindSessionTTL = 60 * time.Second
)

// BindSession 描述扫码绑定授权会话。
type BindSession struct {
	BindToken      string  `json:"bindToken"`
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

// BindSessionGrantRequest 描述广告观看完成后的授权发放请求。
type BindSessionGrantRequest struct {
	BindToken string
	Days      int
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

// CreateBindSession 为客户端创建一个 60 秒有效的扫码绑定会话。
func (s *Service) CreateBindSession(ctx context.Context, req CreateBindSessionRequest) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	clientID := strings.TrimSpace(req.ClientID)
	fingerprint := strings.TrimSpace(req.Fingerprint)
	if clientID == "" || fingerprint == "" {
		return BindSession{}, fmt.Errorf("clientId and fingerprint required")
	}

	currentStatus, err := s.Status(ctx, clientID, fingerprint)
	if err == nil && currentStatus.Authorized {
		return BindSession{
			Status:       "authorized",
			Message:      "当前客户端已授权",
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

// GrantBindSession 在广告观看完成后直接为当前客户端写入授权并标记已激活。
func (s *Service) GrantBindSession(ctx context.Context, req BindSessionGrantRequest) (BindSession, error) {
	if err := s.ensureAdminReady(); err != nil {
		return BindSession{}, err
	}
	token := strings.TrimSpace(req.BindToken)
	if token == "" {
		return BindSession{}, fmt.Errorf("bindToken required")
	}
	days := normalizeAdUnlockDays(req.Days)

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
	if row.GrantedAt.Valid && row.LicenseID.Valid {
		if err := tx.Commit(); err != nil {
			return BindSession{}, err
		}
		updated, getErr := s.findBindSessionByToken(ctx, token)
		if getErr != nil {
			return BindSession{}, getErr
		}
		return s.buildBindSession(ctx, updated, now)
	}
	if strings.TrimSpace(row.WechatOpenID) == "" {
		return BindSession{}, fmt.Errorf("bind_session_not_scanned")
	}

	licenseKey, err := generateLicenseKey()
	if err != nil {
		return BindSession{}, err
	}
	featuresJSON := "{}"
	features := defaultFullFeatures(days)
	features["source"] = "rewarded_ad"
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
	`, licenseKey, strings.TrimSpace(row.WechatNickname), "rewarded_ad", now.Add(time.Duration(days)*24*time.Hour), 1, 999, featuresJSON, row.ClientID, row.Fingerprint)
	if err != nil {
		return BindSession{}, err
	}
	licenseID, err := res.LastInsertId()
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

func normalizeAdUnlockDays(days int) int {
	if days <= 0 {
		return 30
	}
	if days > 3650 {
		return 3650
	}
	return days
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

	if isBindSessionExpired(row, now) && !row.GrantedAt.Valid {
		session.Status = "expired"
		session.Message = "二维码已过期，请刷新后重试"
		return session, nil
	}
	switch session.Status {
	case "granted":
		session.Message = "广告授权已发放，等待客户端同步"
	case "scanned":
		session.Message = "已扫码登录，等待广告观看完成"
	case "authorized":
		session.Message = "当前客户端已授权"
	default:
		session.Status = "pending"
		session.Message = "请使用微信小程序扫码并完成激励视频"
	}

	licenseStatus, err := s.Status(ctx, session.ClientID, session.Fingerprint)
	if err == nil {
		session.Authorized = licenseStatus.Authorized
		if licenseStatus.Enabled {
			licenseCopy := licenseStatus
			session.License = &licenseCopy
		}
		if licenseStatus.Authorized {
			session.Status = "authorized"
			session.Message = "客户端已获得完整授权"
		}
	}
	return session, nil
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
