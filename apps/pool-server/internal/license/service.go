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
	"golang.org/x/crypto/bcrypt"
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

// TrialRequest 描述试用激活请求。
type TrialRequest struct {
	ClientID    string
	Fingerprint string
	AppVersion  string
}

// Status 描述授权状态返回。
type Status struct {
	Enabled            bool            `json:"enabled"`
	Available          bool            `json:"available"`
	Authorized         bool            `json:"authorized"`
	Unrestricted       bool            `json:"unrestricted"`
	State              string          `json:"state"`
	Message            string          `json:"message"`
	LicenseID          int64           `json:"licenseId"`
	LicenseKey         string          `json:"licenseKey"`
	CustomerName       string          `json:"customerName"`
	Plan               string          `json:"plan"`
	ExpireAtMS         int64           `json:"expireAt"`
	MaxClients         int             `json:"maxClients"`
	MaxAccounts        int             `json:"maxAccounts"`
	Features           map[string]any  `json:"features"`
	FeatureFlags       map[string]bool `json:"featureFlags"`
	AccessMode         string          `json:"accessMode"`
	TrialState         string          `json:"trialState"`
	TrialExpireAtMS    int64           `json:"trialExpireAt"`
	TrialRemainingSec  int64           `json:"trialRemainingSec"`
	RequiresActivation bool            `json:"requiresActivation"`
	LicensePlan        string          `json:"licensePlan"`
	BoundClient        string          `json:"boundClientId"`
	CheckedAtMS        int64           `json:"checkedAt"`
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
	WechatOpenID    string         `json:"wechatOpenId"`
	WechatNickname  string         `json:"wechatNickname"`
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

// AdminRuntimeClient 描述后台可见的运行中客户端记录。
type AdminRuntimeClient struct {
	ClientID     string `json:"clientId"`
	Fingerprint  string `json:"fingerprint"`
	AppVersion   string `json:"appVersion"`
	AccessMode   string `json:"accessMode"`
	LicenseID    int64  `json:"licenseId"`
	LicensePlan  string `json:"licensePlan"`
	Authorized   bool   `json:"authorized"`
	Unrestricted bool   `json:"unrestricted"`
	FirstSeenAt  int64  `json:"firstSeenAt"`
	LastSeenAt   int64  `json:"lastSeenAt"`
}

// AdminRuntimeClientListResult 描述后台客户端列表分页结果。
type AdminRuntimeClientListResult struct {
	Total    int                  `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
	Items    []AdminRuntimeClient `json:"items"`
}

type AdminUser struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	LastLoginAt int64  `json:"lastLoginAt"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type LotteryParticipationRecord struct {
	LocalHistoryID       int64          `json:"localHistoryId"`
	RecordType           string         `json:"recordType"`
	ClientID             string         `json:"clientId"`
	Fingerprint          string         `json:"fingerprint"`
	AppVersion           string         `json:"appVersion"`
	AccountID            string         `json:"accountId"`
	AccountNickname      string         `json:"accountNickname"`
	RoomID               string         `json:"roomId"`
	WebRid               string         `json:"webRid"`
	LotteryID            string         `json:"lotteryId"`
	AuthorNickname       string         `json:"authorNickname"`
	LotteryName          string         `json:"lotteryName"`
	PredictedProbability float64        `json:"predictedProbability"`
	PredictedJoinTotal   float64        `json:"predictedJoinTotal"`
	JoinTotal            float64        `json:"joinTotal"`
	LuckyCount           float64        `json:"luckyCount"`
	OnlineTotal          float64        `json:"onlineTotal"`
	TotalAmount          float64        `json:"totalAmount"`
	PrizeType            any            `json:"prizeType"`
	PrizeInfo            map[string]any `json:"prizeInfo"`
	Conditions           []any          `json:"conditions"`
	RemainingSec         float64        `json:"remainingSec"`
	ServerScore          float64        `json:"serverScore"`
	StartTimeMS          int64          `json:"startTime"`
	JoinMode             string         `json:"joinMode"`
	JoinStatus           string         `json:"joinStatus"`
	ResultStatus         string         `json:"resultStatus"`
	ResultReason         string         `json:"resultReason"`
	JoinedAtMS           int64          `json:"joinedAt"`
	EndTimeMS            int64          `json:"endTime"`
	RewardAmount         float64        `json:"rewardAmount"`
	CreatedAtMS          int64          `json:"createdAt"`
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
const (
	settingKeyUnrestricted   = "license_unrestricted"
	settingKeyNoticeMarkdown = "desktop_notice_markdown"
)

type AdminGlobalSettings struct {
	Unrestricted   bool   `json:"unrestricted"`
	NoticeMarkdown string `json:"noticeMarkdown"`
}

type Service struct {
	cfg                  Config
	db                   *sql.DB
	initErr              error
	dbMu                 sync.Mutex
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
	WechatOpenID    string
	WechatNickname  string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ActivationCount int
	LastSeenAt      sql.NullTime
}

type runtimeClientRow struct {
	ClientID     string
	Fingerprint  string
	AppVersion   string
	AccessMode   string
	LicenseID    sql.NullInt64
	LicensePlan  string
	Authorized   bool
	Unrestricted bool
	FirstSeenAt  time.Time
	LastSeenAt   time.Time
}

type adminUserRow struct {
	ID           int64
	Username     string
	PasswordHash string
	DisplayName  string
	Status       string
	LastLoginAt  sql.NullTime
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewService 初始化授权服务。初始化失败时仍返回可读状态服务，便于前端展示异常。
func NewService(cfg Config) (*Service, error) {
	svc := &Service{cfg: cfg}
	if !cfg.Enabled {
		return svc, nil
	}
	if err := svc.ensureRuntimeReady(context.Background()); err != nil {
		return svc, err
	}
	return svc, nil
}

// Close 关闭底层数据库连接。
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.dbMu.Lock()
	defer s.dbMu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *Service) resolveDSN() (string, error) {
	if s == nil {
		return "", fmt.Errorf("license service is nil")
	}
	dsn := strings.TrimSpace(s.cfg.DSN)
	if dsn != "" {
		return dsn, nil
	}
	host := strings.TrimSpace(s.cfg.Host)
	user := strings.TrimSpace(s.cfg.User)
	dbName := strings.TrimSpace(s.cfg.Database)
	if host == "" || user == "" || dbName == "" {
		return "", fmt.Errorf("license mysql config incomplete")
	}
	port := s.cfg.Port
	if port <= 0 {
		port = 3306
	}
	params := strings.TrimSpace(s.cfg.Params)
	if params == "" {
		params = "charset=utf8mb4&parseTime=true&loc=Local"
	}
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?%s",
		user,
		s.cfg.Password,
		host,
		port,
		dbName,
		params,
	), nil
}

func (s *Service) openDBWithConfig(ctx context.Context) (*sql.DB, error) {
	dsn, err := s.resolveDSN()
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	if s.cfg.MaxOpenConns > 0 {
		db.SetMaxOpenConns(s.cfg.MaxOpenConns)
	}
	if s.cfg.MaxIdleConns > 0 {
		db.SetMaxIdleConns(s.cfg.MaxIdleConns)
	}
	if s.cfg.ConnMaxLifetimeMin > 0 {
		db.SetConnMaxLifetime(time.Duration(s.cfg.ConnMaxLifetimeMin) * time.Minute)
	}
	baseCtx := ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	pingCtx, cancel := context.WithTimeout(baseCtx, 3*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func (s *Service) ensureRuntimeReady(ctx context.Context) error {
	if s == nil || !s.cfg.Enabled {
		return fmt.Errorf("license service disabled")
	}
	if s.initErr == nil && s.db != nil {
		return nil
	}
	s.dbMu.Lock()
	defer s.dbMu.Unlock()

	if s.initErr == nil && s.db != nil {
		return nil
	}
	if s.db != nil {
		_ = s.db.Close()
		s.db = nil
	}

	db, err := s.openDBWithConfig(ctx)
	if err != nil {
		s.initErr = err
		return err
	}
	s.db = db
	if err := s.ensureSettingsSchema(context.Background()); err != nil {
		_ = db.Close()
		s.db = nil
		s.initErr = err
		return err
	}
	s.initErr = nil
	return nil
}

func (s *Service) ensureAdminReady() error {
	if s == nil || !s.cfg.Enabled {
		return fmt.Errorf("license service disabled")
	}
	if err := s.ensureRuntimeReady(context.Background()); err != nil {
		return fmt.Errorf("license service unavailable: %w", err)
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
			setting_value TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	if err := s.ensureSettingsValueColumnType(schemaCtx); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS miniapp_signin_records (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			client_id VARCHAR(128) NOT NULL,
			fingerprint VARCHAR(128) NOT NULL DEFAULT '',
			wechat_open_id VARCHAR(128) NOT NULL DEFAULT '',
			sign_date DATE NOT NULL,
			gain_days INT NOT NULL DEFAULT 1,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_miniapp_signin_device_day (client_id, fingerprint, sign_date),
			KEY idx_miniapp_signin_openid_day (wechat_open_id, sign_date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS license_trials (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			fingerprint VARCHAR(128) NOT NULL,
			client_id VARCHAR(128) NOT NULL DEFAULT '',
			app_version VARCHAR(32) NOT NULL DEFAULT '',
			status VARCHAR(24) NOT NULL DEFAULT 'active',
			started_at DATETIME NOT NULL,
			expire_at DATETIME NOT NULL,
			activated_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_trial_fingerprint (fingerprint),
			KEY idx_trial_client_id (client_id),
			KEY idx_trial_expire_at (expire_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS license_admin_users (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			username VARCHAR(64) NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			display_name VARCHAR(128) NOT NULL DEFAULT '',
			status VARCHAR(24) NOT NULL DEFAULT 'active',
			last_login_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_admin_username (username)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS license_runtime_clients (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			client_id VARCHAR(128) NOT NULL,
			fingerprint VARCHAR(128) NOT NULL DEFAULT '',
			app_version VARCHAR(32) NOT NULL DEFAULT '',
			access_mode VARCHAR(24) NOT NULL DEFAULT '',
			license_id BIGINT UNSIGNED NULL,
			license_plan VARCHAR(64) NOT NULL DEFAULT '',
			authorized TINYINT(1) NOT NULL DEFAULT 0,
			unrestricted TINYINT(1) NOT NULL DEFAULT 0,
			first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_runtime_client (client_id),
			KEY idx_runtime_fingerprint (fingerprint),
			KEY idx_runtime_last_seen (last_seen_at),
			CONSTRAINT fk_runtime_client_license
				FOREIGN KEY (license_id) REFERENCES licenses(id)
				ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		CREATE TABLE IF NOT EXISTS lottery_participation_records (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			local_history_id BIGINT NOT NULL,
			record_type VARCHAR(24) NOT NULL DEFAULT 'join',
			client_id VARCHAR(128) NOT NULL,
			fingerprint VARCHAR(128) NOT NULL DEFAULT '',
			app_version VARCHAR(32) NOT NULL DEFAULT '',
			account_id VARCHAR(128) NOT NULL DEFAULT '',
			account_nickname VARCHAR(128) NOT NULL DEFAULT '',
			room_id VARCHAR(128) NOT NULL DEFAULT '',
			web_rid VARCHAR(128) NOT NULL DEFAULT '',
			lottery_id VARCHAR(128) NOT NULL DEFAULT '',
			author_nickname VARCHAR(128) NOT NULL DEFAULT '',
			lottery_name VARCHAR(255) NOT NULL DEFAULT '',
			predicted_probability DOUBLE NOT NULL DEFAULT 0,
			predicted_join_total DOUBLE NOT NULL DEFAULT 0,
			join_total DOUBLE NOT NULL DEFAULT 0,
			lucky_count DOUBLE NOT NULL DEFAULT 0,
			online_total DOUBLE NOT NULL DEFAULT 0,
			total_amount DOUBLE NOT NULL DEFAULT 0,
			prize_type_json JSON NULL,
			prize_info_json JSON NULL,
			conditions_json JSON NULL,
			remaining_sec DOUBLE NOT NULL DEFAULT 0,
			server_score DOUBLE NOT NULL DEFAULT 0,
			start_time_ms BIGINT NOT NULL DEFAULT 0,
			join_mode VARCHAR(32) NOT NULL DEFAULT '',
			join_status VARCHAR(32) NOT NULL DEFAULT '',
			result_status VARCHAR(32) NOT NULL DEFAULT '',
			result_reason VARCHAR(255) NOT NULL DEFAULT '',
			joined_at_ms BIGINT NOT NULL DEFAULT 0,
			end_time_ms BIGINT NOT NULL DEFAULT 0,
			reward_amount DOUBLE NOT NULL DEFAULT 0,
			created_at_ms BIGINT NOT NULL DEFAULT 0,
			uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_participation_client_record (client_id, local_history_id),
			KEY idx_participation_fingerprint (fingerprint),
			KEY idx_participation_lottery (lottery_id),
			KEY idx_participation_account (account_id),
			KEY idx_participation_joined_at (joined_at_ms)
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
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE setting_key = setting_key
	`, settingKeyUnrestricted, defaultValue); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(schemaCtx, `
		INSERT INTO license_settings (setting_key, setting_value)
		VALUES (?, '')
		ON DUPLICATE KEY UPDATE setting_key = setting_key
	`, settingKeyNoticeMarkdown); err != nil {
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

func isMachineFingerprint(raw string) bool {
	fp := strings.TrimSpace(strings.ToLower(raw))
	if !strings.HasPrefix(fp, "machine_") {
		return false
	}
	body := strings.TrimPrefix(fp, "machine_")
	if len(body) != 32 {
		return false
	}
	for _, ch := range body {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}

func normalizeMachineFingerprint(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !isMachineFingerprint(trimmed) {
		return ""
	}
	return trimmed
}

func normalizeDesktopNotice(raw string) string {
	return strings.ReplaceAll(raw, "\r\n", "\n")
}

func (s *Service) ensureSettingsValueColumnType(ctx context.Context) error {
	if s == nil || s.db == nil {
		return nil
	}
	var dataType string
	err := s.db.QueryRowContext(ctx, `
		SELECT DATA_TYPE
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = 'license_settings'
		  AND COLUMN_NAME = 'setting_value'
		LIMIT 1
	`).Scan(&dataType)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	switch strings.TrimSpace(strings.ToLower(dataType)) {
	case "text", "mediumtext", "longtext":
		return nil
	default:
		_, err = s.db.ExecContext(ctx, `
			ALTER TABLE license_settings
			MODIFY COLUMN setting_value TEXT NOT NULL
		`)
		return err
	}
}

func (s *Service) loadSettingValue(ctx context.Context, key string) (string, error) {
	if s == nil || s.db == nil {
		return "", nil
	}
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT setting_value
		FROM license_settings
		WHERE setting_key = ?
		LIMIT 1
	`, key).Scan(&raw)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return raw, nil
}

func (s *Service) upsertSettingValue(ctx context.Context, key string, value string) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO license_settings (setting_key, setting_value)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()
	`, key, value)
	return err
}

func (s *Service) loadUnrestrictedSetting(ctx context.Context) (bool, error) {
	raw, err := s.loadSettingValue(ctx, settingKeyUnrestricted)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(raw) == "" {
		return s.cfg.DefaultUnrestricted, nil
	}
	return normalizeSettingBool(raw), nil
}

func (s *Service) loadDesktopNoticeSetting(ctx context.Context) (string, error) {
	return s.loadSettingValue(ctx, settingKeyNoticeMarkdown)
}

// IsUnrestricted 查询当前服务端是否已开启全局免授权。
func (s *Service) IsUnrestricted(ctx context.Context) (bool, error) {
	if s == nil || !s.cfg.Enabled {
		return false, nil
	}
	if enabled, ok := s.cachedUnrestrictedState(); ok {
		return enabled, nil
	}
	if err := s.ensureRuntimeReady(ctx); err != nil {
		return false, err
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
		"dashboard":          true,
		"dispatch":           true,
		"multiAccount":       true,
		"scanner":            true,
		"executor":           true,
	}
}

func (s *Service) buildUnrestrictedStatus(now time.Time) Status {
	features := unrestrictedFeatures()
	return Status{
		Enabled:            true,
		Available:          true,
		Authorized:         true,
		Unrestricted:       true,
		State:              "unrestricted",
		Message:            "服务端已开启免授权",
		Features:           features,
		FeatureFlags:       normalizeFeatureFlags(features),
		AccessMode:         "unrestricted",
		RequiresActivation: false,
		LicensePlan:        "server-unrestricted",
		CheckedAtMS:        now.UnixMilli(),
	}
}

// RecordRuntimeClient 记录客户端最近一次访问，用于后台展示实际连接过的机器。
func (s *Service) RecordRuntimeClient(ctx context.Context, clientID, fingerprint, appVersion string, status Status) error {
	if s == nil || !s.cfg.Enabled {
		return nil
	}
	if err := s.ensureRuntimeReady(ctx); err != nil {
		return err
	}
	clientID = strings.TrimSpace(clientID)
	fingerprint = normalizeMachineFingerprint(fingerprint)
	if clientID == "" || fingerprint == "" {
		return nil
	}
	accessMode := strings.TrimSpace(status.AccessMode)
	if accessMode == "" {
		accessMode = "unknown"
	}
	licensePlan := strings.TrimSpace(status.LicensePlan)
	if licensePlan == "" {
		licensePlan = strings.TrimSpace(status.Plan)
	}
	var licenseID any
	if status.LicenseID > 0 {
		licenseID = status.LicenseID
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO license_runtime_clients (
			client_id,
			fingerprint,
			app_version,
			access_mode,
			license_id,
			license_plan,
			authorized,
			unrestricted,
			first_seen_at,
			last_seen_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
		ON DUPLICATE KEY UPDATE
			fingerprint = VALUES(fingerprint),
			app_version = VALUES(app_version),
			access_mode = VALUES(access_mode),
			license_id = VALUES(license_id),
			license_plan = VALUES(license_plan),
			authorized = VALUES(authorized),
			unrestricted = VALUES(unrestricted),
			last_seen_at = NOW(),
			updated_at = NOW()
	`, clientID, fingerprint, strings.TrimSpace(appVersion), accessMode, licenseID, licensePlan, status.Authorized, status.Unrestricted)
	return err
}

// Status 查询当前客户端的授权状态。
func (s *Service) Status(ctx context.Context, clientID, fingerprint string) (Status, error) {
	now := time.Now()
	base := Status{
		Enabled:            s != nil && s.cfg.Enabled,
		Available:          s != nil && s.db != nil,
		Authorized:         false,
		Unrestricted:       false,
		State:              "disabled",
		Message:            "未启用授权",
		CheckedAtMS:        now.UnixMilli(),
		Features:           map[string]any{},
		FeatureFlags:       map[string]bool{},
		AccessMode:         "disabled",
		TrialState:         "none",
		RequiresActivation: false,
	}
	if s == nil || !s.cfg.Enabled {
		return base, nil
	}
	if err := s.ensureRuntimeReady(ctx); err != nil {
		base.State = "backend_unavailable"
		base.Message = "授权服务不可用"
		base.Available = false
		return base, err
	}
	base.Available = true
	if unrestricted, err := s.IsUnrestricted(ctx); err == nil && unrestricted {
		status := s.buildUnrestrictedStatus(now)
		_ = s.RecordRuntimeClient(ctx, clientID, fingerprint, "", status)
		return status, nil
	} else if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}
	trimmedClientID := strings.TrimSpace(clientID)
	trimmedFingerprint := normalizeMachineFingerprint(fingerprint)
	if trimmedClientID == "" && trimmedFingerprint == "" {
		base.State = "invalid_client"
		base.Message = "clientId 或 fingerprint 不能为空"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, nil
	}

	row, err := s.findByClient(ctx, trimmedClientID)
	if err == sql.ErrNoRows {
		if trimmedFingerprint != "" {
			trial, trialErr := s.findTrialByFingerprint(ctx, trimmedFingerprint)
			if trialErr == nil {
				return s.buildTrialStatus(trial, now), nil
			}
			if trialErr != sql.ErrNoRows {
				base.State = "query_failed"
				base.Message = "授权查询失败"
				base.AccessMode = "locked"
				base.RequiresActivation = true
				return base, trialErr
			}
		}
		base.State = "unlicensed"
		base.Message = "当前设备未授权，请开始试用或激活授权"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, nil
	}
	if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	status := s.buildStatus(row, trimmedClientID, trimmedFingerprint, now)
	if status.Authorized {
		_ = s.touchActivation(ctx, row.ID, trimmedClientID, trimmedFingerprint, 0, "")
	}
	_ = s.RecordRuntimeClient(ctx, trimmedClientID, trimmedFingerprint, "", status)
	return status, nil
}

// Activate 通过授权码绑定当前客户端，并返回最新授权状态。
func (s *Service) Activate(ctx context.Context, req ActivateRequest) (Status, error) {
	now := time.Now()
	base := Status{
		Enabled:            s != nil && s.cfg.Enabled,
		Available:          s != nil && s.db != nil,
		Authorized:         false,
		Unrestricted:       false,
		State:              "disabled",
		Message:            "未启用授权",
		CheckedAtMS:        now.UnixMilli(),
		Features:           map[string]any{},
		FeatureFlags:       map[string]bool{},
		AccessMode:         "disabled",
		TrialState:         "none",
		RequiresActivation: false,
	}
	if s == nil || !s.cfg.Enabled {
		return base, nil
	}
	if err := s.ensureRuntimeReady(ctx); err != nil {
		base.State = "backend_unavailable"
		base.Message = "授权服务不可用"
		base.Available = false
		return base, err
	}
	base.Available = true
	if unrestricted, err := s.IsUnrestricted(ctx); err == nil && unrestricted {
		return s.buildUnrestrictedStatus(now), nil
	} else if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}
	clientID := strings.TrimSpace(req.ClientID)
	licenseKey := strings.TrimSpace(req.LicenseKey)
	fingerprint := normalizeMachineFingerprint(req.Fingerprint)
	if clientID == "" || licenseKey == "" {
		base.State = "invalid_request"
		base.Message = "licenseKey 和 clientId 不能为空"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, nil
	}
	if fingerprint == "" {
		base.State = "invalid_fingerprint"
		base.Message = "设备指纹无效，请重启客户端后重试"
		base.AccessMode = "locked"
		base.RequiresActivation = true
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

	row, err := s.findByLicenseKey(ctx, tx, licenseKey)
	if err == sql.ErrNoRows {
		base.State = "invalid_license"
		base.Message = "授权码不存在"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, nil
	}
	if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	bindClient := strings.TrimSpace(row.BindClientID.String)
	bindFingerprint := strings.TrimSpace(row.BindFingerprint.String)
	status := s.buildStatus(row, clientID, fingerprint, now)

	stateLower := strings.TrimSpace(strings.ToLower(row.Status))
	if stateLower == "used" || bindClient != "" || (bindFingerprint != "" && fingerprint != "" && bindFingerprint != fingerprint) {
		status.Authorized = false
		status.State = "license_used"
		status.Message = "授权码已使用（一次性）"
		status.RequiresActivation = true
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
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	if err := s.touchActivationTx(ctx, tx, row.ID, clientID, fingerprint, req.CurrentAccts, req.AppVersion); err != nil {
		base.State = "activation_failed"
		base.Message = "授权激活失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}
	if err := s.markTrialActivatedTx(ctx, tx, fingerprint); err != nil {
		base.State = "activation_failed"
		base.Message = "试用状态更新失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	if err := tx.Commit(); err != nil {
		base.State = "commit_failed"
		base.Message = "授权提交失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
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
	noticeMarkdown, err := s.loadDesktopNoticeSetting(ctx)
	if err != nil {
		return AdminGlobalSettings{}, err
	}
	return AdminGlobalSettings{
		Unrestricted:   enabled,
		NoticeMarkdown: noticeMarkdown,
	}, nil
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
	if err := s.upsertSettingValue(ctx, settingKeyUnrestricted, value); err != nil {
		return AdminGlobalSettings{}, err
	}
	s.updateUnrestrictedCache(enabled)
	return s.AdminGetGlobalSettings(ctx)
}

// AdminSetDesktopNoticeMarkdown 更新桌面端公告 Markdown。
func (s *Service) AdminSetDesktopNoticeMarkdown(ctx context.Context, markdown string) error {
	if err := s.ensureAdminReady(); err != nil {
		return err
	}
	return s.upsertSettingValue(ctx, settingKeyNoticeMarkdown, normalizeDesktopNotice(markdown))
}

// AdminSetGlobalSettings 更新全局免授权和桌面端公告。
func (s *Service) AdminSetGlobalSettings(ctx context.Context, unrestricted bool, noticeMarkdown *string) (AdminGlobalSettings, error) {
	if _, err := s.AdminSetUnrestricted(ctx, unrestricted); err != nil {
		return AdminGlobalSettings{}, err
	}
	if noticeMarkdown != nil {
		if err := s.AdminSetDesktopNoticeMarkdown(ctx, *noticeMarkdown); err != nil {
			return AdminGlobalSettings{}, err
		}
	}
	return s.AdminGetGlobalSettings(ctx)
}

// GetDesktopNoticeMarkdown 返回桌面端公告内容。
func (s *Service) GetDesktopNoticeMarkdown(ctx context.Context) (string, error) {
	if err := s.ensureAdminReady(); err != nil {
		return "", err
	}
	return s.loadDesktopNoticeSetting(ctx)
}

// EnsureAdminBootstrapUser 仅在管理员表为空时创建首个管理员账号。
func (s *Service) EnsureAdminBootstrapUser(ctx context.Context, username, password string) error {
	if err := s.ensureAdminReady(); err != nil {
		return err
	}
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	if username == "" || password == "" {
		return nil
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM license_admin_users`).Scan(&total); err != nil {
		return err
	}
	if total > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO license_admin_users (
			username,
			password_hash,
			display_name,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, 'active', NOW(), NOW())
	`, username, string(hash), username)
	return err
}

// AuthenticateAdminUser 使用数据库中的管理员用户完成登录认证。
func (s *Service) AuthenticateAdminUser(ctx context.Context, username, password string) (AdminUser, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminUser{}, err
	}
	row, err := s.findAdminUserByUsername(ctx, username)
	if err != nil {
		return AdminUser{}, err
	}
	if strings.TrimSpace(strings.ToLower(row.Status)) != "active" {
		return AdminUser{}, fmt.Errorf("admin_user_disabled")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(row.PasswordHash), []byte(strings.TrimSpace(password))); err != nil {
		return AdminUser{}, fmt.Errorf("invalid_credentials")
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE license_admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?`, row.ID); err != nil {
		return AdminUser{}, err
	}
	row.LastLoginAt = sql.NullTime{Time: time.Now(), Valid: true}
	return adminUserFromRow(row), nil
}

func (s *Service) findAdminUserByUsername(ctx context.Context, username string) (adminUserRow, error) {
	row := adminUserRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id,
			username,
			password_hash,
			display_name,
			status,
			last_login_at,
			created_at,
			updated_at
		FROM license_admin_users
		WHERE username = ?
		LIMIT 1
	`, strings.TrimSpace(username)).Scan(
		&row.ID,
		&row.Username,
		&row.PasswordHash,
		&row.DisplayName,
		&row.Status,
		&row.LastLoginAt,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func adminUserFromRow(row adminUserRow) AdminUser {
	item := AdminUser{
		ID:          row.ID,
		Username:    strings.TrimSpace(row.Username),
		DisplayName: strings.TrimSpace(row.DisplayName),
		Status:      strings.TrimSpace(row.Status),
		CreatedAt:   row.CreatedAt.UnixMilli(),
		UpdatedAt:   row.UpdatedAt.UnixMilli(),
	}
	if row.LastLoginAt.Valid {
		item.LastLoginAt = row.LastLoginAt.Time.UnixMilli()
	}
	return item
}

// SaveLotteryParticipationRecord 持久化桌面端上传的福袋参与历史。
func (s *Service) SaveLotteryParticipationRecord(ctx context.Context, record LotteryParticipationRecord) error {
	if err := s.ensureAdminReady(); err != nil {
		return err
	}
	clientID := strings.TrimSpace(record.ClientID)
	fingerprint := normalizeMachineFingerprint(record.Fingerprint)
	if clientID == "" || fingerprint == "" {
		return fmt.Errorf("clientId and fingerprint required")
	}
	if record.LocalHistoryID <= 0 {
		return fmt.Errorf("localHistoryId required")
	}
	recordType := strings.TrimSpace(strings.ToLower(record.RecordType))
	if recordType != "win" {
		recordType = "join"
	}
	prizeTypeJSON, err := json.Marshal(record.PrizeType)
	if err != nil {
		prizeTypeJSON = []byte("null")
	}
	prizeInfoJSON, err := json.Marshal(record.PrizeInfo)
	if err != nil {
		prizeInfoJSON = []byte("{}")
	}
	conditionsJSON, err := json.Marshal(record.Conditions)
	if err != nil {
		conditionsJSON = []byte("[]")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO lottery_participation_records (
			local_history_id,
			record_type,
			client_id,
			fingerprint,
			app_version,
			account_id,
			account_nickname,
			room_id,
			web_rid,
			lottery_id,
			author_nickname,
			lottery_name,
			predicted_probability,
			predicted_join_total,
			join_total,
			lucky_count,
			online_total,
			total_amount,
			prize_type_json,
			prize_info_json,
			conditions_json,
			remaining_sec,
			server_score,
			start_time_ms,
			join_mode,
			join_status,
			result_status,
			result_reason,
			joined_at_ms,
			end_time_ms,
			reward_amount,
			created_at_ms,
			uploaded_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON DUPLICATE KEY UPDATE
			record_type = VALUES(record_type),
			fingerprint = VALUES(fingerprint),
			app_version = VALUES(app_version),
			account_id = VALUES(account_id),
			account_nickname = VALUES(account_nickname),
			room_id = VALUES(room_id),
			web_rid = VALUES(web_rid),
			lottery_id = VALUES(lottery_id),
			author_nickname = VALUES(author_nickname),
			lottery_name = VALUES(lottery_name),
			predicted_probability = VALUES(predicted_probability),
			predicted_join_total = VALUES(predicted_join_total),
			join_total = VALUES(join_total),
			lucky_count = VALUES(lucky_count),
			online_total = VALUES(online_total),
			total_amount = VALUES(total_amount),
			prize_type_json = VALUES(prize_type_json),
			prize_info_json = VALUES(prize_info_json),
			conditions_json = VALUES(conditions_json),
			remaining_sec = VALUES(remaining_sec),
			server_score = VALUES(server_score),
			start_time_ms = VALUES(start_time_ms),
			join_mode = VALUES(join_mode),
			join_status = VALUES(join_status),
			result_status = VALUES(result_status),
			result_reason = VALUES(result_reason),
			joined_at_ms = VALUES(joined_at_ms),
			end_time_ms = VALUES(end_time_ms),
			reward_amount = VALUES(reward_amount),
			created_at_ms = VALUES(created_at_ms),
			updated_at = NOW()
	`,
		record.LocalHistoryID,
		recordType,
		clientID,
		fingerprint,
		strings.TrimSpace(record.AppVersion),
		strings.TrimSpace(record.AccountID),
		strings.TrimSpace(record.AccountNickname),
		strings.TrimSpace(record.RoomID),
		strings.TrimSpace(record.WebRid),
		strings.TrimSpace(record.LotteryID),
		strings.TrimSpace(record.AuthorNickname),
		strings.TrimSpace(record.LotteryName),
		record.PredictedProbability,
		record.PredictedJoinTotal,
		record.JoinTotal,
		record.LuckyCount,
		record.OnlineTotal,
		record.TotalAmount,
		string(prizeTypeJSON),
		string(prizeInfoJSON),
		string(conditionsJSON),
		record.RemainingSec,
		record.ServerScore,
		record.StartTimeMS,
		strings.TrimSpace(record.JoinMode),
		strings.TrimSpace(record.JoinStatus),
		strings.TrimSpace(record.ResultStatus),
		strings.TrimSpace(record.ResultReason),
		record.JoinedAtMS,
		record.EndTimeMS,
		record.RewardAmount,
		record.CreatedAtMS,
	)
	return err
}

// ListAdminRuntimeClients 返回后台记录到的运行客户端列表。
func (s *Service) ListAdminRuntimeClients(ctx context.Context, page, pageSize int) (AdminRuntimeClientListResult, error) {
	if err := s.ensureAdminReady(); err != nil {
		return AdminRuntimeClientListResult{}, err
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM license_runtime_clients`).Scan(&total); err != nil {
		return AdminRuntimeClientListResult{}, err
	}

	offset := (page - 1) * pageSize
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			client_id,
			fingerprint,
			app_version,
			access_mode,
			license_id,
			license_plan,
			authorized,
			unrestricted,
			first_seen_at,
			last_seen_at
		FROM license_runtime_clients
		ORDER BY last_seen_at DESC, client_id DESC
		LIMIT ? OFFSET ?
	`, pageSize, offset)
	if err != nil {
		return AdminRuntimeClientListResult{}, err
	}
	defer rows.Close()

	items := make([]AdminRuntimeClient, 0, pageSize)
	for rows.Next() {
		var row runtimeClientRow
		if err := rows.Scan(
			&row.ClientID,
			&row.Fingerprint,
			&row.AppVersion,
			&row.AccessMode,
			&row.LicenseID,
			&row.LicensePlan,
			&row.Authorized,
			&row.Unrestricted,
			&row.FirstSeenAt,
			&row.LastSeenAt,
		); err != nil {
			return AdminRuntimeClientListResult{}, err
		}
		item := AdminRuntimeClient{
			ClientID:     strings.TrimSpace(row.ClientID),
			Fingerprint:  strings.TrimSpace(row.Fingerprint),
			AppVersion:   strings.TrimSpace(row.AppVersion),
			AccessMode:   strings.TrimSpace(row.AccessMode),
			LicensePlan:  strings.TrimSpace(row.LicensePlan),
			Authorized:   row.Authorized,
			Unrestricted: row.Unrestricted,
			FirstSeenAt:  row.FirstSeenAt.UnixMilli(),
			LastSeenAt:   row.LastSeenAt.UnixMilli(),
		}
		if row.LicenseID.Valid {
			item.LicenseID = row.LicenseID.Int64
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminRuntimeClientListResult{}, err
	}

	return AdminRuntimeClientListResult{
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Items:    items,
	}, nil
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
			COALESCE(MAX(bs.wechat_open_id), '') AS wechat_open_id,
			COALESCE(MAX(bs.wechat_nickname), '') AS wechat_nickname,
			l.created_at,
			l.updated_at,
			COUNT(DISTINCT a.client_id) AS activation_count,
			MAX(a.last_seen_at) AS last_seen_at
		FROM licenses l
		LEFT JOIN license_activations a ON a.license_id = l.id
		LEFT JOIN (
			SELECT b1.license_id, b1.wechat_open_id, b1.wechat_nickname
			FROM license_bind_sessions b1
			INNER JOIN (
				SELECT license_id, MAX(updated_at) AS max_updated
				FROM license_bind_sessions
				WHERE license_id IS NOT NULL
				GROUP BY license_id
			) b2 ON b1.license_id = b2.license_id AND b1.updated_at = b2.max_updated
		) bs ON bs.license_id = l.id
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
			&row.WechatOpenID,
			&row.WechatNickname,
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

// AdminDeleteLicense 删除授权记录（含激活记录）。
func (s *Service) AdminDeleteLicense(ctx context.Context, id int64) error {
	if err := s.ensureAdminReady(); err != nil {
		return err
	}
	if id <= 0 {
		return fmt.Errorf("id required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.ExecContext(ctx, `DELETE FROM license_activations WHERE license_id = ?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE license_bind_sessions SET license_id = NULL WHERE license_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM licenses WHERE id = ?`, id)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
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
			COALESCE(MAX(bs.wechat_open_id), '') AS wechat_open_id,
			COALESCE(MAX(bs.wechat_nickname), '') AS wechat_nickname,
			l.created_at,
			l.updated_at,
			COUNT(DISTINCT a.client_id) AS activation_count,
			MAX(a.last_seen_at) AS last_seen_at
		FROM licenses l
		LEFT JOIN license_activations a ON a.license_id = l.id
		LEFT JOIN (
			SELECT b1.license_id, b1.wechat_open_id, b1.wechat_nickname
			FROM license_bind_sessions b1
			INNER JOIN (
				SELECT license_id, MAX(updated_at) AS max_updated
				FROM license_bind_sessions
				WHERE license_id IS NOT NULL
				GROUP BY license_id
			) b2 ON b1.license_id = b2.license_id AND b1.updated_at = b2.max_updated
		) bs ON bs.license_id = l.id
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
		&row.WechatOpenID,
		&row.WechatNickname,
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
		WechatOpenID:    strings.TrimSpace(row.WechatOpenID),
		WechatNickname:  strings.TrimSpace(row.WechatNickname),
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
	if bindClient != "" && trimmedClientID == "" {
		authorized = false
		state = "invalid_client"
		message = "缺少客户端标识"
	}
	if bindFingerprint != "" && trimmedFingerprint == "" {
		authorized = false
		state = "invalid_fingerprint"
		message = "缺少有效设备指纹"
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

	features := parseFeatures(row.FeaturesJSON.String)
	return Status{
		Enabled:            true,
		Available:          true,
		Authorized:         authorized,
		Unrestricted:       false,
		State:              state,
		Message:            message,
		LicenseID:          row.ID,
		LicenseKey:         maskLicenseKey(row.LicenseKey),
		CustomerName:       row.CustomerName,
		Plan:               row.PlanName,
		LicensePlan:        row.PlanName,
		ExpireAtMS:         row.ExpireAt.UnixMilli(),
		MaxClients:         row.MaxClients,
		MaxAccounts:        row.MaxAccounts,
		Features:           features,
		FeatureFlags:       normalizeFeatureFlags(features),
		AccessMode:         "licensed",
		TrialState:         "none",
		RequiresActivation: !authorized,
		BoundClient:        strings.TrimSpace(row.BindClientID.String),
		CheckedAtMS:        now.UnixMilli(),
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
