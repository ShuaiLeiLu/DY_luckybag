package license

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Config 描述授权模块的 MySQL 配置。
type Config struct {
	Enabled              bool
	DefaultUnrestricted  bool
	DSN                  string
	Host                 string
	Port                 int
	User                 string
	Password             string
	Database             string
	Params               string
	MaxOpenConns         int
	MaxIdleConns         int
	ConnMaxLifetimeMin   int
	MiniAppEnabled       bool
	MiniAppAppID         string
	MiniAppAppSecret     string
	MiniAppSessionSecret string
	MiniAppSessionTTLMin int
	MiniAppPagePath      string
	MiniAppEnvVersion    string
}

// ActivateRequest 描述授权激活请求。
type ActivateRequest struct {
	LicenseKey   string
	ClientID     string
	Fingerprint  string
	AppVersion   string
	CurrentAccts int
}

// Status 描述授权状态返回。
type Status struct {
	Enabled      bool           `json:"enabled"`
	Available    bool           `json:"available"`
	Authorized   bool           `json:"authorized"`
	Unrestricted bool           `json:"unrestricted"`
	State        string         `json:"state"`
	Message      string         `json:"message"`
	LicenseID    int64          `json:"licenseId"`
	LicenseKey   string         `json:"licenseKey"`
	CustomerName string         `json:"customerName"`
	Plan         string         `json:"plan"`
	ExpireAtMS   int64          `json:"expireAt"`
	MaxClients   int            `json:"maxClients"`
	MaxAccounts  int            `json:"maxAccounts"`
	Features     map[string]any `json:"features"`
	BoundClient  string         `json:"boundClientId"`
	CheckedAtMS  int64          `json:"checkedAt"`
}

// AdminListQuery 描述授权管理后台分页查询参数。
type AdminListQuery struct {
	Keyword  string
	Status   string
	Page     int
	PageSize int
}

// AdminLicense 描述授权管理后台的单条授权记录。
type AdminLicense struct {
	ID              int64          `json:"id"`
	LicenseKey      string         `json:"licenseKey"`
	CustomerName    string         `json:"customerName"`
	PlanName        string         `json:"planName"`
	Status          string         `json:"status"`
	ExpireAtMS      int64          `json:"expireAt"`
	MaxClients      int            `json:"maxClients"`
	MaxAccounts     int            `json:"maxAccounts"`
	Features        map[string]any `json:"features"`
	BindClientID    string         `json:"bindClientId"`
	BindFingerprint string         `json:"bindFingerprint"`
	ActivationCount int            `json:"activationCount"`
	LastSeenAtMS    int64          `json:"lastSeenAt"`
	CreatedAtMS     int64          `json:"createdAt"`
	UpdatedAtMS     int64          `json:"updatedAt"`
}

// AdminListResult 描述授权管理后台分页结果。
type AdminListResult struct {
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Items    []AdminLicense `json:"items"`
}

// AdminCreateRequest 描述授权管理后台创建授权请求。
type AdminCreateRequest struct {
	LicenseKey   string
	CustomerName string
	PlanName     string
	Status       string
	ExpireAtMS   int64
	MaxClients   int
	MaxAccounts  int
	Features     map[string]any
}

// AdminCreateBatchRequest 描述授权管理后台批量创建授权请求。
type AdminCreateBatchRequest struct {
	Days     int
	Quantity int
}

// AdminGlobalSettings 描述全局授权设置。
type AdminGlobalSettings struct {
	Unrestricted bool `json:"unrestricted"`
}

type Service struct {
	cfg                  Config
	db                   *sql.DB
	initErr              error
	settingsMu           sync.RWMutex
	cachedUnrestricted   bool
	cachedUnrestrictedAt time.Time
	miniAppTokenMu       sync.Mutex
	miniAppAccessToken   string
	miniAppAccessTokenAt time.Time
}

type licenseRow struct {
	ID              int64
	LicenseKey      string
	CustomerName    string
	PlanName        string
	Status          string
	ExpireAt        time.Time
	MaxClients      int
	MaxAccounts     int
	FeaturesJSON    sql.NullString
	BindClientID    sql.NullString
	BindFingerprint sql.NullString
}

type adminLicenseRow struct {
	ID              int64
	LicenseKey      string
	CustomerName    string
	PlanName        string
	Status          string
	ExpireAt        time.Time
	MaxClients      int
	MaxAccounts     int
	FeaturesJSON    sql.NullString
	BindClientID    string
	BindFingerprint string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ActivationCount int
	LastSeenAt      sql.NullTime
}

// NewService 初始化授权服务。初始化失败时仍返回可读状态服务，便于前端展示异常。
func NewService(cfg Config) (*Service, error) {
	svc := &Service{cfg: cfg}
	if !cfg.Enabled {
		return svc, nil
	}

	dsn := strings.TrimSpace(cfg.DSN)
	if dsn == "" {
		host := strings.TrimSpace(cfg.Host)
		user := strings.TrimSpace(cfg.User)
		dbName := strings.TrimSpace(cfg.Database)
		if host == "" || user == "" || dbName == "" {
			svc.initErr = fmt.Errorf("license mysql config incomplete")
			return svc, svc.initErr
		}
		port := cfg.Port
		if port <= 0 {
			port = 3306
		}
		params := strings.TrimSpace(cfg.Params)
		if params == "" {
			params = "charset=utf8mb4&parseTime=true&loc=Local"
		}
		dsn = fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?%s",
			user,
			cfg.Password,
			host,
			port,
			dbName,
			params,
		)
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		svc.initErr = err
		return svc, err
	}
	if cfg.MaxOpenConns > 0 {
		db.SetMaxOpenConns(cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns > 0 {
		db.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetimeMin > 0 {
		db.SetConnMaxLifetime(time.Duration(cfg.ConnMaxLifetimeMin) * time.Minute)
	}
	pingCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		svc.initErr = err
		return svc, err
	}
	svc.db = db
	if err := svc.ensureSettingsSchema(context.Background()); err != nil {
		_ = db.Close()
		svc.db = nil
		svc.initErr = err
		return svc, err
	}
	return svc, nil
}

// Close 关闭底层数据库连接。
func (s *Service) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Service) ensureAdminReady() error {
	if s == nil || !s.cfg.Enabled {
		return fmt.Errorf("license service disabled")
	}
	if s.initErr != nil {
		return fmt.Errorf("license service unavailable: %w", s.initErr)
	}
	if s.db == nil {
		return fmt.Errorf("license service unavailable: db is nil")
	}
	return nil
}

func (s *Service) ensureSettingsSchema(ctx context.Context) error {
	if s == nil || s.db == nil {
		return nil
	}
	schemaCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS license_settings (
			setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
			setting_value VARCHAR(255) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	defaultValue := "0"
	if s.cfg.DefaultUnrestricted {
		defaultValue = "1"
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		INSERT INTO license_settings (setting_key, setting_value)
		VALUES ('license_unrestricted', ?)
		ON DUPLICATE KEY UPDATE setting_key = setting_key
	`, defaultValue); err != nil {
		return err
	}
	s.updateUnrestrictedCache(s.cfg.DefaultUnrestricted)
	if value, err := s.loadUnrestrictedSetting(schemaCtx); err == nil {
		s.updateUnrestrictedCache(value)
	}
	return nil
}

func (s *Service) updateUnrestrictedCache(enabled bool) {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	s.cachedUnrestricted = enabled
	s.cachedUnrestrictedAt = time.Now()
}

func (s *Service) cachedUnrestrictedState() (bool, bool) {
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	if s.cachedUnrestrictedAt.IsZero() {
		return false, false
	}
	if time.Since(s.cachedUnrestrictedAt) > 2*time.Second {
		return false, false
	}
	return s.cachedUnrestricted, true
}

func normalizeSettingBool(raw string) bool {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "1", "true", "on", "yes", "enabled", "active":
		return true
	default:
		return false
	}
}

func (s *Service) loadUnrestrictedSetting(ctx context.Context) (bool, error) {
	if s == nil || s.db == nil {
		return false, nil
	}
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT setting_value
		FROM license_settings
		WHERE setting_key = 'license_unrestricted'
		LIMIT 1
	`).Scan(&raw)
	if err == sql.ErrNoRows {
		return s.cfg.DefaultUnrestricted, nil
	}
	if err != nil {
		return false, err
	}
	return normalizeSettingBool(raw), nil
}

// IsUnrestricted 查询当前服务端是否已开启全局免授权。
func (s *Service) IsUnrestricted(ctx context.Context) (bool, error) {
	if s == nil || !s.cfg.Enabled {
		return false, nil
	}
	if enabled, ok := s.cachedUnrestrictedState(); ok {
		return enabled, nil
	}
	if s.initErr != nil || s.db == nil {
		return false, s.initErr
	}
	enabled, err := s.loadUnrestrictedSetting(ctx)
	if err != nil {
		return false, err
	}
	s.updateUnrestrictedCache(enabled)
	return enabled, nil
}

func unrestrictedFeatures() map[string]any {
	return map[string]any{
		"fullAccess":         true,
		"all":                true,
		"serverUnrestricted": true,
	}
}

func (s *Service) buildUnrestrictedStatus(now time.Time) Status {
	return Status{
		Enabled:      true,
		Available:    true,
		Authorized:   true,
		Unrestricted: true,
		State:        "unrestricted",
		Message:      "服务端已开启免授权",
		Features:     unrestrictedFeatures(),
		CheckedAtMS:  now.UnixMilli(),
	}
}

// Status 查询当前客户端的授权状态。
func (s *Service) Status(ctx context.Context, clientID, fingerprint string) (Status, error) {
	now := time.Now()
	base := Status{
		Enabled:      s != nil && s.cfg.Enabled,
		Available:    s != nil && s.db != nil,
		Authorized:   false,
		Unrestricted: false,
		State:        "disabled",
		Message:      "未启用授权",
		CheckedAtMS:  now.UnixMilli(),
		Features:     map[string]any{},
	}
	if s == nil || !s.cfg.Enabled {
		return base, nil
	}
	if s.initErr != nil || s.db == nil {
		base.State = "backend_unavailable"
		base.Message = "授权服务不可用"
		return base, s.initErr
	}
	if unrestricted, err := s.IsUnrestricted(ctx); err == nil && unrestricted {
		return s.buildUnrestrictedStatus(now), nil
	} else if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		return base, err
	}
	if strings.TrimSpace(clientID) == "" {
		base.State = "invalid_client"
		base.Message = "clientId 不能为空"
		return base, nil
	}

	row, err := s.findByClient(ctx, clientID)
	if err == sql.ErrNoRows {
		base.State = "unlicensed"
		base.Message = "当前客户端未授权"
		return base, nil
	}
	if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		return base, err
	}

	status := s.buildStatus(row, clientID, fingerprint, now)
	if status.Authorized {
		_ = s.touchActivation(ctx, row.ID, clientID, fingerprint, 0, "")
	}
	return status, nil
}

// Activate 通过授权码绑定当前客户端，并返回最新授权状态。
func (s *Service) Activate(ctx context.Context, req ActivateRequest) (Status, error) {
	now := time.Now()
	base := Status{
		Enabled:      s != nil && s.cfg.Enabled,
		Available:    s != nil && s.db != nil,
		Authorized:   false,
		Unrestricted: false,
		State:        "disabled",
		Message:      "未启用授权",
		CheckedAtMS:  now.UnixMilli(),
		Features:     map[string]any{},
	}
	if s == nil || !s.cfg.Enabled {
		return base, nil
	}
	if s.initErr != nil || s.db == nil {
		base.State = "backend_unavailable"
		base.Message = "授权服务不可用"
		return base, s.initErr
	}
	if unrestricted, err := s.IsUnrestricted(ctx); err == nil && unrestricted {
		return s.buildUnrestrictedStatus(now), nil
	} else if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		return base, err
	}
	if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.LicenseKey) == "" {
		base.State = "invalid_request"
		base.Message = "licenseKey 和 clientId 不能为空"
		return base, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		base.State = "tx_failed"
		base.Message = "授权事务启动失败"
		return base, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	row, err := s.findByLicenseKey(ctx, tx, req.LicenseKey)
	if err == sql.ErrNoRows {
		base.State = "invalid_license"
		base.Message = "授权码不存在"
		return base, nil
	}
	if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		return base, err
	}

	clientID := strings.TrimSpace(req.ClientID)
	fingerprint := strings.TrimSpace(req.Fingerprint)
	bindClient := strings.TrimSpace(row.BindClientID.String)
	bindFingerprint := strings.TrimSpace(row.BindFingerprint.String)
	status := s.buildStatus(row, clientID, fingerprint, now)

	stateLower := strings.TrimSpace(strings.ToLower(row.Status))
	if stateLower == "used" || bindClient != "" || (bindFingerprint != "" && fingerprint != "" && bindFingerprint != fingerprint) {
		status.Authorized = false
		status.State = "license_used"
		status.Message = "授权码已使用（一次性）"
		return status, nil
	}
	if stateLower != "active" {
		return status, nil
	}
	if !row.ExpireAt.IsZero() && !row.ExpireAt.After(now) {
		return status, nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE licenses
		SET bind_client_id = ?,
		    bind_fingerprint = ?,
		    status = 'used',
		    updated_at = NOW()
		WHERE id = ?
	`, clientID, fingerprint, row.ID); err != nil {
		base.State = "bind_failed"
		base.Message = "授权绑定失败"
		return base, err
	}

	if err := s.touchActivationTx(ctx, tx, row.ID, clientID, fingerprint, req.CurrentAccts, req.AppVersion); err != nil {
		base.State = "activation_failed"
		base.Message = "授权激活失败"
		return base, err
	}

	if err := tx.Commit(); err != nil {
		base.State = "commit_failed"
		base.Message = "授权提交失败"
		return base, err
	}
	return s.Status(ctx, clientID, fingerprint)
}

// AdminGetGlobalSettings 返回授权全局设置。
func (s *Service) AdminGetGlobalSettings(ctx context.Context) (AdminGlobalSettings, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminGlobalSettings{}, err
	}
	enabled, err := s.IsUnrestricted(ctx)
	if err != nil {
		return AdminGlobalSettings{}, err
	}
	return AdminGlobalSettings{Unrestricted: enabled}, nil
}

// AdminSetUnrestricted 更新全局免授权开关。
func (s *Service) AdminSetUnrestricted(ctx context.Context, enabled bool) (AdminGlobalSettings, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminGlobalSettings{}, err
	}
	value := "0"
	if enabled {
		value = "1"
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO license_settings (setting_key, setting_value)
		VALUES ('license_unrestricted', ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()
	`, value); err != nil {
		return AdminGlobalSettings{}, err
	}
	s.updateUnrestrictedCache(enabled)
	return AdminGlobalSettings{Unrestricted: enabled}, nil
}

// ListAdminLicenses 返回授权管理后台分页列表。
func (s *Service) ListAdminLicenses(ctx context.Context, q AdminListQuery) (AdminListResult, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminListResult{}, err
	}

	page := q.Page
	if page <= 0 {
		page = 1
	}
	pageSize := q.PageSize
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	keyword := strings.TrimSpace(q.Keyword)
	status := normalizeAdminLicenseStatus(q.Status)

	whereParts := []string{"1=1"}
	args := make([]any, 0, 6)
	if keyword != "" {
		whereParts = append(whereParts, "(l.license_key LIKE ? OR l.customer_name LIKE ? OR l.plan_name LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like)
	}
	if status != "" {
		whereParts = append(whereParts, "l.status = ?")
		args = append(args, status)
	}
	whereSQL := strings.Join(whereParts, " AND ")

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM licenses l WHERE %s", whereSQL)
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return AdminListResult{}, err
	}

	offset := (page - 1) * pageSize
	listQuery := fmt.Sprintf(`
		SELECT
			l.id,
			l.license_key,
			l.customer_name,
			l.plan_name,
			l.status,
			l.expire_at,
			l.max_clients,
			l.max_accounts,
			l.features_json,
			l.bind_client_id,
			l.bind_fingerprint,
			l.created_at,
			l.updated_at,
			COUNT(DISTINCT a.client_id) AS activation_count,
			MAX(a.last_seen_at) AS last_seen_at
		FROM licenses l
		LEFT JOIN license_activations a ON a.license_id = l.id
		WHERE %s
		GROUP BY l.id
		ORDER BY l.updated_at DESC, l.id DESC
		LIMIT ? OFFSET ?
	`, whereSQL)
	listArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := s.db.QueryContext(ctx, listQuery, listArgs...)
	if err != nil {
		return AdminListResult{}, err
	}
	defer rows.Close()

	items := make([]AdminLicense, 0, pageSize)
	for rows.Next() {
		var row adminLicenseRow
		if err := rows.Scan(
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
			&row.CreatedAt,
			&row.UpdatedAt,
			&row.ActivationCount,
			&row.LastSeenAt,
		); err != nil {
			return AdminListResult{}, err
		}
		items = append(items, adminLicenseFromRow(row))
	}
	if err := rows.Err(); err != nil {
		return AdminListResult{}, err
	}

	return AdminListResult{
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Items:    items,
	}, nil
}

// AdminCreateLicense 创建授权码记录。
func (s *Service) AdminCreateLicense(ctx context.Context, req AdminCreateRequest) (AdminLicense, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminLicense{}, err
	}
	licenseKey := strings.TrimSpace(req.LicenseKey)
	if licenseKey == "" {
		var err error
		licenseKey, err = generateLicenseKey()
		if err != nil {
			return AdminLicense{}, err
		}
	}
	customerName := strings.TrimSpace(req.CustomerName)
	planName := strings.TrimSpace(req.PlanName)
	if planName == "" {
		planName = "full"
	}
	status := normalizeAdminLicenseStatus(req.Status)
	if status == "" {
		status = "active"
	}
	maxClients := req.MaxClients
	if maxClients <= 0 {
		maxClients = 1
	}
	maxAccounts := req.MaxAccounts
	if maxAccounts <= 0 {
		maxAccounts = 999
	}
	expireAt := time.Now().Add(30 * 24 * time.Hour)
	if req.ExpireAtMS > 0 {
		expireAt = time.UnixMilli(req.ExpireAtMS)
	}
	featuresJSON := "{}"
	features := req.Features
	if len(features) == 0 {
		defaultDays := 30
		if req.ExpireAtMS > 0 {
			remainingDays := int(time.Until(expireAt).Hours() / 24)
			if remainingDays > 0 {
				defaultDays = remainingDays
			}
		}
		features = defaultFullFeatures(defaultDays)
	}
	if len(features) > 0 {
		if b, err := json.Marshal(features); err == nil {
			featuresJSON = string(b)
		}
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO licenses (
			license_key, customer_name, plan_name, status, expire_at, max_clients, max_accounts, features_json, bind_client_id, bind_fingerprint
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '')
	`, licenseKey, customerName, planName, status, expireAt, maxClients, maxAccounts, featuresJSON)
	if err != nil {
		return AdminLicense{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return AdminLicense{}, err
	}
	return s.adminGetLicenseByID(ctx, id)
}

// AdminCreateLicensesBatch 根据授权天数和数量批量生成授权码（默认全功能授权）。
func (s *Service) AdminCreateLicensesBatch(ctx context.Context, req AdminCreateBatchRequest) ([]AdminLicense, error) {
	if err := s.ensureAdminReady(); err != nil {
		return nil, err
	}
	quantity := req.Quantity
	if quantity <= 0 {
		quantity = 1
	}
	if quantity > 500 {
		quantity = 500
	}
	days := req.Days
	if days <= 0 {
		days = 30
	}
	if days > 3650 {
		days = 3650
	}

	expireAt := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	featuresJSON := "{}"
	if b, err := json.Marshal(defaultFullFeatures(days)); err == nil {
		featuresJSON = string(b)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	ids := make([]int64, 0, quantity)
	for i := 0; i < quantity; i++ {
		inserted := false
		for retry := 0; retry < 8; retry++ {
			key, keyErr := generateLicenseKey()
			if keyErr != nil {
				return nil, keyErr
			}
			res, execErr := tx.ExecContext(ctx, `
				INSERT INTO licenses (
					license_key, customer_name, plan_name, status, expire_at, max_clients, max_accounts, features_json, bind_client_id, bind_fingerprint
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '')
			`, key, "", "full", "active", expireAt, 1, 999, featuresJSON)
			if execErr != nil {
				if isDuplicateLicenseKeyErr(execErr) {
					continue
				}
				return nil, execErr
			}
			id, idErr := res.LastInsertId()
			if idErr != nil {
				return nil, idErr
			}
			ids = append(ids, id)
			inserted = true
			break
		}
		if !inserted {
			return nil, fmt.Errorf("generate license key failed after retries")
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	items := make([]AdminLicense, 0, len(ids))
	for _, id := range ids {
		item, getErr := s.adminGetLicenseByID(ctx, id)
		if getErr != nil {
			return nil, getErr
		}
		items = append(items, item)
	}
	return items, nil
}

// AdminSetLicenseStatus 设置授权状态（active/disabled）。
func (s *Service) AdminSetLicenseStatus(ctx context.Context, id int64, status string) (AdminLicense, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminLicense{}, err
	}
	if id <= 0 {
		return AdminLicense{}, fmt.Errorf("id required")
	}
	nextStatus := normalizeAdminLicenseStatus(status)
	if nextStatus == "" {
		nextStatus = "disabled"
	}
	res, err := s.db.ExecContext(ctx, `UPDATE licenses SET status = ?, updated_at = NOW() WHERE id = ?`, nextStatus, id)
	if err != nil {
		return AdminLicense{}, err
	}
	if n, _ := res.RowsAffected(); n <= 0 {
		return AdminLicense{}, sql.ErrNoRows
	}
	return s.adminGetLicenseByID(ctx, id)
}

// AdminExtendLicense 续期授权（按天数向后延长）。
func (s *Service) AdminExtendLicense(ctx context.Context, id int64, days int) (AdminLicense, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminLicense{}, err
	}
	if id <= 0 {
		return AdminLicense{}, fmt.Errorf("id required")
	}
	if days <= 0 {
		days = 30
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE licenses
		SET expire_at = DATE_ADD(CASE WHEN expire_at > NOW() THEN expire_at ELSE NOW() END, INTERVAL ? DAY),
		    updated_at = NOW()
		WHERE id = ?
	`, days, id)
	if err != nil {
		return AdminLicense{}, err
	}
	if n, _ := res.RowsAffected(); n <= 0 {
		return AdminLicense{}, sql.ErrNoRows
	}
	return s.adminGetLicenseByID(ctx, id)
}

// AdminUnbindLicense 解绑授权并清空历史激活记录。
func (s *Service) AdminUnbindLicense(ctx context.Context, id int64) (AdminLicense, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminLicense{}, err
	}
	if id <= 0 {
		return AdminLicense{}, fmt.Errorf("id required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AdminLicense{}, err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
		UPDATE licenses
		SET bind_client_id = '', bind_fingerprint = '', updated_at = NOW()
		WHERE id = ?
	`, id)
	if err != nil {
		return AdminLicense{}, err
	}
	if n, _ := res.RowsAffected(); n <= 0 {
		return AdminLicense{}, sql.ErrNoRows
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM license_activations WHERE license_id = ?`, id); err != nil {
		return AdminLicense{}, err
	}
	if err := tx.Commit(); err != nil {
		return AdminLicense{}, err
	}
	return s.adminGetLicenseByID(ctx, id)
}

func (s *Service) adminGetLicenseByID(ctx context.Context, id int64) (AdminLicense, error) {
	query := `
		SELECT
			l.id,
			l.license_key,
			l.customer_name,
			l.plan_name,
			l.status,
			l.expire_at,
			l.max_clients,
			l.max_accounts,
			l.features_json,
			l.bind_client_id,
			l.bind_fingerprint,
			l.created_at,
			l.updated_at,
			COUNT(DISTINCT a.client_id) AS activation_count,
			MAX(a.last_seen_at) AS last_seen_at
		FROM licenses l
		LEFT JOIN license_activations a ON a.license_id = l.id
		WHERE l.id = ?
		GROUP BY l.id
		LIMIT 1
	`
	var row adminLicenseRow
	err := s.db.QueryRowContext(ctx, query, id).Scan(
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
		&row.CreatedAt,
		&row.UpdatedAt,
		&row.ActivationCount,
		&row.LastSeenAt,
	)
	if err != nil {
		return AdminLicense{}, err
	}
	return adminLicenseFromRow(row), nil
}

func adminLicenseFromRow(row adminLicenseRow) AdminLicense {
	item := AdminLicense{
		ID:              row.ID,
		LicenseKey:      row.LicenseKey,
		CustomerName:    row.CustomerName,
		PlanName:        row.PlanName,
		Status:          strings.TrimSpace(strings.ToLower(row.Status)),
		ExpireAtMS:      row.ExpireAt.UnixMilli(),
		MaxClients:      row.MaxClients,
		MaxAccounts:     row.MaxAccounts,
		Features:        parseFeatures(row.FeaturesJSON.String),
		BindClientID:    strings.TrimSpace(row.BindClientID),
		BindFingerprint: strings.TrimSpace(row.BindFingerprint),
		ActivationCount: row.ActivationCount,
		CreatedAtMS:     row.CreatedAt.UnixMilli(),
		UpdatedAtMS:     row.UpdatedAt.UnixMilli(),
	}
	if row.LastSeenAt.Valid {
		item.LastSeenAtMS = row.LastSeenAt.Time.UnixMilli()
	}
	return item
}

func normalizeAdminLicenseStatus(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "active", "enabled", "on", "1", "true":
		return "active"
	case "disabled", "inactive", "off", "0", "false":
		return "disabled"
	default:
		return ""
	}
}

func defaultFullFeatures(days int) map[string]any {
	if days <= 0 {
		days = 30
	}
	return map[string]any{
		"fullAccess":  true,
		"all":         true,
		"licenseDays": days,
	}
}

func generateLicenseKey() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return fmt.Sprintf("DY-%s-%s", time.Now().Format("20060102"), strings.ToUpper(hex.EncodeToString(buf))), nil
}

func isDuplicateLicenseKeyErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "duplicate entry")
}

func (s *Service) findByClient(ctx context.Context, clientID string) (licenseRow, error) {
	row := licenseRow{}
	query := `
		SELECT
			l.id,
			l.license_key,
			l.customer_name,
			l.plan_name,
			l.status,
			l.expire_at,
			l.max_clients,
			l.max_accounts,
			l.features_json,
			l.bind_client_id,
			l.bind_fingerprint
		FROM licenses l
		LEFT JOIN license_activations a
			ON a.license_id = l.id AND a.client_id = ?
		WHERE l.bind_client_id = ? OR a.client_id = ?
		ORDER BY
			CASE WHEN l.bind_client_id = ? THEN 0 ELSE 1 END,
			a.last_seen_at DESC,
			l.id DESC
		LIMIT 1
	`
	err := s.db.QueryRowContext(ctx, query, clientID, clientID, clientID, clientID).Scan(
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

func (s *Service) findByLicenseKey(ctx context.Context, tx *sql.Tx, licenseKey string) (licenseRow, error) {
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
		WHERE license_key = ?
		LIMIT 1
	`, strings.TrimSpace(licenseKey)).Scan(
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

func (s *Service) buildStatus(row licenseRow, clientID, fingerprint string, now time.Time) Status {
	state := strings.TrimSpace(strings.ToLower(row.Status))
	if state == "" {
		state = "active"
	}
	trimmedClientID := strings.TrimSpace(clientID)
	trimmedFingerprint := strings.TrimSpace(fingerprint)
	bindClient := strings.TrimSpace(row.BindClientID.String)
	bindFingerprint := strings.TrimSpace(row.BindFingerprint.String)

	message := "授权有效"
	authorized := true
	if state != "active" && state != "used" {
		authorized = false
		message = "授权已停用"
	}
	if state == "used" {
		if bindClient != "" && trimmedClientID != "" && bindClient == trimmedClientID &&
			(bindFingerprint == "" || trimmedFingerprint == "" || bindFingerprint == trimmedFingerprint) {
			authorized = true
			message = "授权有效（一次性授权）"
		} else {
			authorized = false
			state = "license_used"
			message = "授权码已使用（一次性）"
		}
	}
	if !row.ExpireAt.IsZero() && !row.ExpireAt.After(now) {
		state = "expired"
		authorized = false
		message = "授权已过期"
	}
	if bindClient != "" && trimmedClientID != "" && bindClient != trimmedClientID {
		authorized = false
		if state == "used" || state == "license_used" {
			state = "license_used"
			message = "授权码已使用（一次性）"
		} else {
			state = "bound_elsewhere"
			message = "授权已绑定其他客户端"
		}
	}
	if bindFingerprint != "" && trimmedFingerprint != "" && bindFingerprint != trimmedFingerprint {
		authorized = false
		if state == "used" || state == "license_used" {
			state = "license_used"
			message = "授权码已使用（一次性）"
		} else {
			state = "bound_elsewhere"
			message = "授权已绑定其他设备"
		}
	}

	return Status{
		Enabled:      true,
		Available:    true,
		Authorized:   authorized,
		Unrestricted: false,
		State:        state,
		Message:      message,
		LicenseID:    row.ID,
		LicenseKey:   maskLicenseKey(row.LicenseKey),
		CustomerName: row.CustomerName,
		Plan:         row.PlanName,
		ExpireAtMS:   row.ExpireAt.UnixMilli(),
		MaxClients:   row.MaxClients,
		MaxAccounts:  row.MaxAccounts,
		Features:     parseFeatures(row.FeaturesJSON.String),
		BoundClient:  strings.TrimSpace(row.BindClientID.String),
		CheckedAtMS:  now.UnixMilli(),
	}
}

func (s *Service) touchActivation(ctx context.Context, licenseID int64, clientID, fingerprint string, accountCount int, appVersion string) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO license_activations (
			license_id,
			client_id,
			fingerprint,
			account_count,
			app_version,
			last_seen_at,
			created_at
		) VALUES (?, ?, ?, ?, ?, NOW(), NOW())
		ON DUPLICATE KEY UPDATE
			fingerprint = VALUES(fingerprint),
			account_count = VALUES(account_count),
			app_version = VALUES(app_version),
			last_seen_at = NOW()
	`, licenseID, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint), accountCount, strings.TrimSpace(appVersion))
	return err
}

func (s *Service) touchActivationTx(ctx context.Context, tx *sql.Tx, licenseID int64, clientID, fingerprint string, accountCount int, appVersion string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO license_activations (
			license_id,
			client_id,
			fingerprint,
			account_count,
			app_version,
			last_seen_at,
			created_at
		) VALUES (?, ?, ?, ?, ?, NOW(), NOW())
		ON DUPLICATE KEY UPDATE
			fingerprint = VALUES(fingerprint),
			account_count = VALUES(account_count),
			app_version = VALUES(app_version),
			last_seen_at = NOW()
	`, licenseID, strings.TrimSpace(clientID), strings.TrimSpace(fingerprint), accountCount, strings.TrimSpace(appVersion))
	return err
}

func parseFeatures(raw string) map[string]any {
	text := strings.TrimSpace(raw)
	if text == "" {
		return map[string]any{}
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(text), &obj); err == nil && obj != nil {
		return obj
	}
	var list []string
	if err := json.Unmarshal([]byte(text), &list); err == nil {
		out := make(map[string]any, len(list))
		for _, item := range list {
			key := strings.TrimSpace(item)
			if key == "" {
				continue
			}
			out[key] = true
		}
		return out
	}
	return map[string]any{}
}

func maskLicenseKey(raw string) string {
	key := strings.TrimSpace(raw)
	if len(key) <= 8 {
		return key
	}
	return fmt.Sprintf("%s****%s", key[:4], key[len(key)-4:])
}
