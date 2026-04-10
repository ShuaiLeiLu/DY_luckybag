package main

import (
	"bytes"
	"crypto/subtle"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	licensepkg "dy_fudai/pool-server-go/internal/license"
	"dy_fudai/pool-server-go/internal/pool"
)

type serverConfig struct {
	Host         string
	Port         int
	MaxBodyBytes int64
}

type taskOwnerRequest struct {
	ClientID  string `json:"clientId"`
	AccountID string `json:"accountId"`
}

type fileConfig struct {
	Server struct {
		Host         string `json:"host"`
		Port         int    `json:"port"`
		MaxBodyBytes int64  `json:"maxBodyBytes"`
	} `json:"server"`
	Pool struct {
		TopCacheMax        int     `json:"topCacheMax"`
		TTLGraceSec        int64   `json:"ttlGraceSec"`
		MaxBatchSize       int     `json:"maxBatchSize"`
		TopRefreshMS       int64   `json:"topRefreshMS"`
		ExpireSweepMS      int64   `json:"expireSweepMS"`
		Shards             int     `json:"shards"`
		LearningJoinWeight float64 `json:"learningJoinWeight"`
		LearningWinWeight  float64 `json:"learningWinWeight"`
		FeedbackLogPath    string  `json:"feedbackLogPath"`
	} `json:"pool"`
	License struct {
		Enabled              bool   `json:"enabled"`
		Unrestricted         bool   `json:"unrestricted"`
		AdminToken           string `json:"adminToken"`
		AdUnlockDays         int    `json:"adUnlockDays"`
		MiniAppEnabled       bool   `json:"miniAppEnabled"`
		MiniAppAppID         string `json:"miniAppAppId"`
		MiniAppAppSecret     string `json:"miniAppAppSecret"`
		MiniAppSessionSecret string `json:"miniAppSessionSecret"`
		MiniAppSessionTTLMin int    `json:"miniAppSessionTTLMin"`
		MiniAppPagePath      string `json:"miniAppPagePath"`
		MiniAppEnvVersion    string `json:"miniAppEnvVersion"`
		DSN                  string `json:"dsn"`
		Host                 string `json:"host"`
		Port                 int    `json:"port"`
		User                 string `json:"user"`
		Password             string `json:"password"`
		Database             string `json:"database"`
		Params               string `json:"params"`
		MaxOpenConns         int    `json:"maxOpenConns"`
		MaxIdleConns         int    `json:"maxIdleConns"`
		ConnMaxLifetimeMin   int    `json:"connMaxLifetimeMin"`
	} `json:"license"`
	Redis struct {
		Enabled        bool   `json:"enabled"`
		Addr           string `json:"addr"`
		Password       string `json:"password"`
		DB             int    `json:"db"`
		Prefix         string `json:"prefix"`
		PoolSize       int    `json:"poolSize"`
		MinIdleConns   int    `json:"minIdleConns"`
		DialTimeoutMS  int64  `json:"dialTimeoutMS"`
		ReadTimeoutMS  int64  `json:"readTimeoutMS"`
		WriteTimeoutMS int64  `json:"writeTimeoutMS"`
	} `json:"redis"`
}

//go:embed web/license-admin.html
var adminLicenseHTML []byte

// getenvInt 方法：处理整数。
func getenvInt(name string, fallback int) int {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

// getenvInt64 方法：处理64位整数。
func getenvInt64(name string, fallback int64) int64 {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

// getenvStr 方法：处理字符串。
func getenvStr(name, fallback string) string {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	return v
}

// getenvBool 方法：处理布尔值。
func getenvBool(name string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

// loadConfigFile 方法：加载配置文件。
func loadConfigFile(path string) (fileConfig, bool, error) {
	var cfg fileConfig
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, false, nil
		}
		return cfg, false, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, false, nil
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		return cfg, false, err
	}
	if len(root) == 0 {
		return cfg, false, nil
	}

	if rawPoolServer, ok := root["poolServer"]; ok && len(rawPoolServer) > 0 {
		if err := json.Unmarshal(rawPoolServer, &cfg); err != nil {
			return cfg, false, err
		}
		return cfg, true, nil
	}

	// 兼容旧配置：直接使用 server/pool/license/redis 作为根结构。
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, false, err
	}
	return cfg, true, nil
}

// resolveConfigPath 方法：解析并返回配置路径。
func resolveConfigPath() string {
	if p := strings.TrimSpace(os.Getenv("POOL_CONFIG_FILE")); p != "" {
		return p
	}
	candidates := []string{
		"config.json",
		"../../config.json",
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return "config.json"
}

func resolveDesktopStaticDir() (string, bool) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("POOL_DESKTOP_STATIC_DIR")),
		"/app/static/desktop",
		"static/desktop",
		filepath.Join("cmd", "poolserver", "web", "desktop"),
	}
	for _, c := range candidates {
		dir := strings.TrimSpace(c)
		if dir == "" {
			continue
		}
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir, true
		}
	}
	return "", false
}

// writeJSON 方法：写入JSON数据。
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "content-type,x-pool-client-id,x-license-fingerprint,x-client-id,x-current-accounts,x-admin-token,authorization")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func extractLicenseIdentity(r *http.Request) (string, string) {
	clientID := firstNonEmpty(
		r.URL.Query().Get("clientId"),
		r.Header.Get("x-pool-client-id"),
		r.Header.Get("x-client-id"),
	)
	fingerprint := firstNonEmpty(
		r.URL.Query().Get("fingerprint"),
		r.Header.Get("x-license-fingerprint"),
	)
	return clientID, fingerprint
}

func extractCurrentAccountsHint(r *http.Request) (int, bool) {
	raw := firstNonEmpty(
		r.URL.Query().Get("currentAccounts"),
		r.Header.Get("x-current-accounts"),
	)
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func writeLicenseGuardErr(w http.ResponseWriter, httpStatus int, errCode, msg string, status map[string]any) {
	payload := map[string]any{
		"ok":    false,
		"error": errCode,
	}
	if msg != "" {
		payload["message"] = msg
	}
	if status != nil {
		payload["license"] = status
	}
	writeJSON(w, httpStatus, payload)
}

func ensureLicenseAuthorized(w http.ResponseWriter, r *http.Request, licenseSvc *licensepkg.Service) bool {
	if licenseSvc == nil {
		return true
	}
	if unrestricted, err := licenseSvc.IsUnrestricted(r.Context()); err == nil && unrestricted {
		return true
	} else if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "license_backend_unavailable",
			"license": map[string]any{
				"enabled":      true,
				"available":    false,
				"authorized":   false,
				"unrestricted": false,
				"state":        "backend_unavailable",
				"message":      "授权服务不可用",
				"checkedAt":    time.Now().UnixMilli(),
			},
		})
		return false
	}

	clientID, fingerprint := extractLicenseIdentity(r)
	if clientID == "" {
		writeLicenseGuardErr(w, http.StatusUnauthorized, "license_client_id_required", "缺少 clientId", map[string]any{
			"enabled":      true,
			"available":    true,
			"authorized":   false,
			"unrestricted": false,
			"state":        "invalid_client",
			"message":      "缺少 clientId",
			"checkedAt":    time.Now().UnixMilli(),
		})
		return false
	}
	if fingerprint == "" {
		writeLicenseGuardErr(w, http.StatusUnauthorized, "license_fingerprint_required", "缺少 fingerprint", map[string]any{
			"enabled":      true,
			"available":    true,
			"authorized":   false,
			"unrestricted": false,
			"state":        "invalid_fingerprint",
			"message":      "缺少设备指纹",
			"checkedAt":    time.Now().UnixMilli(),
		})
		return false
	}

	status, err := licenseSvc.Status(r.Context(), clientID, fingerprint)
	if err != nil && status.Available == false {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":      false,
			"error":   "license_backend_unavailable",
			"license": status,
		})
		return false
	}
	if status.Enabled != true {
		return true
	}
	if status.Authorized != true {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"ok":      false,
			"error":   "license_not_authorized",
			"license": status,
		})
		return false
	}
	return true
}

func extractAdminToken(r *http.Request) string {
	bearer := ""
	auth := strings.TrimSpace(r.Header.Get("authorization"))
	if len(auth) > 7 && strings.EqualFold(auth[:7], "bearer ") {
		bearer = strings.TrimSpace(auth[7:])
	}
	return firstNonEmpty(
		r.URL.Query().Get("token"),
		r.Header.Get("x-admin-token"),
		bearer,
	)
}

func ensureAdminAuthorized(w http.ResponseWriter, r *http.Request, expectedToken string) bool {
	adminToken := strings.TrimSpace(expectedToken)
	if adminToken == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "admin_not_configured",
		})
		return false
	}
	gotToken := strings.TrimSpace(extractAdminToken(r))
	if gotToken == "" || subtle.ConstantTimeCompare([]byte(gotToken), []byte(adminToken)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "admin_unauthorized",
		})
		return false
	}
	return true
}

// parseBody 方法：解析请求体。
func parseBody(r *http.Request, limit int64, dst any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return err
	}
	if int64(len(body)) > limit {
		return io.ErrShortBuffer
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	return dec.Decode(dst)
}

// writeBodyErr 方法：写入请求体。
func writeBodyErr(w http.ResponseWriter, err error) {
	if errors.Is(err, io.ErrShortBuffer) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"ok": false, "error": "request body too large"})
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid json body"})
}

// parseBoolQuery 方法：解析布尔值查询参数。
func parseBoolQuery(v string) (bool, bool) {
	s := strings.TrimSpace(strings.ToLower(v))
	switch s {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

// parseInt64Query 方法：解析64位整数查询参数。
func parseInt64Query(v string) (int64, bool) {
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	return n, err == nil
}

// parseFloatQuery 方法：解析浮点数查询参数。
func parseFloatQuery(v string) (float64, bool) {
	n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return n, err == nil
}

// parsePositiveIntQuery 方法：解析正整数查询参数。
func parsePositiveIntQuery(v string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

// parseCSVQuery 方法：解析逗号分隔查询参数列表。
func parseCSVQuery(v string) []string {
	parts := strings.Split(strings.TrimSpace(v), ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

// parseTopFilterPatch 方法：解析优选结果过滤条件。
func parseTopFilterPatch(r *http.Request) map[string]any {
	q := r.URL.Query()
	patch := map[string]any{}

	if v := strings.TrimSpace(q.Get("requireType3And6")); v != "" {
		if b, ok := parseBoolQuery(v); ok {
			patch["requireType3And6"] = b
		}
	}
	if v := strings.TrimSpace(q.Get("filterFanClub")); v != "" {
		if b, ok := parseBoolQuery(v); ok {
			patch["filterFanClub"] = b
		}
	}
	if v := strings.TrimSpace(q.Get("onlyPhysicalPrize")); v != "" {
		if b, ok := parseBoolQuery(v); ok {
			patch["onlyPhysicalPrize"] = b
		}
	}
	if v := strings.TrimSpace(q.Get("preferBigRedPacket")); v != "" {
		if b, ok := parseBoolQuery(v); ok {
			patch["preferBigRedPacket"] = b
		}
	}
	if v := strings.TrimSpace(q.Get("bigRedPacketThreshold")); v != "" {
		if x, ok := parseFloatQuery(v); ok {
			patch["bigRedPacketThreshold"] = x
		}
	}
	if v := strings.TrimSpace(q.Get("minRemainingSec")); v != "" {
		if n, ok := parseInt64Query(v); ok {
			patch["minRemainingSec"] = n
		}
	}
	if v := strings.TrimSpace(q.Get("maxRemainingSec")); v != "" {
		if n, ok := parseInt64Query(v); ok {
			patch["maxRemainingSec"] = n
		}
	}
	if v := strings.TrimSpace(q.Get("minProbability")); v != "" {
		if x, ok := parseFloatQuery(v); ok {
			patch["minProbability"] = x
		}
	}
	if v := strings.TrimSpace(q.Get("maxOnlineTotal")); v != "" {
		if x, ok := parseFloatQuery(v); ok {
			patch["maxOnlineTotal"] = x
		}
	}

	return patch
}

func parseClaimOwnerFromQuery(r *http.Request) pool.ClaimOwner {
	q := r.URL.Query()
	return pool.ClaimOwner{
		ClientID:  strings.TrimSpace(q.Get("clientId")),
		AccountID: strings.TrimSpace(q.Get("accountId")),
	}
}

func parseScanTelemetryFromQuery(r *http.Request) pool.ScanTelemetry {
	q := r.URL.Query()
	telemetry := pool.ScanTelemetry{}
	if v := strings.TrimSpace(q.Get("riskLevel")); v != "" {
		telemetry.RiskLevel = parsePositiveIntQuery(v, 0)
	}
	if v := strings.TrimSpace(q.Get("cooldownRemainMs")); v != "" {
		if n, ok := parseInt64Query(v); ok {
			telemetry.CooldownRemainMS = n
		}
	}
	if v := strings.TrimSpace(q.Get("hardRiskCount")); v != "" {
		telemetry.HardRiskCount = parsePositiveIntQuery(v, 0)
	}
	if v := strings.TrimSpace(q.Get("busyAccounts")); v != "" {
		telemetry.BusyAccounts = parsePositiveIntQuery(v, 0)
	}
	if v := strings.TrimSpace(q.Get("idleAccounts")); v != "" {
		telemetry.IdleAccounts = parsePositiveIntQuery(v, 0)
	}
	if v := strings.TrimSpace(q.Get("activeScanners")); v != "" {
		telemetry.ActiveScanners = parsePositiveIntQuery(v, 0)
	}
	return telemetry
}

// main 方法：初始化服务配置并启动 HTTP 接口与后台维护任务。
func main() {
	configFilePath := resolveConfigPath()
	fileCfg, hasFileCfg, err := loadConfigFile(configFilePath)
	if err != nil {
		log.Fatalf("load config file failed (%s): %v", configFilePath, err)
	}

	sc := serverConfig{
		Host:         "0.0.0.0",
		Port:         9090,
		MaxBodyBytes: 6 * 1024 * 1024,
	}
	if hasFileCfg {
		if fileCfg.Server.Host != "" {
			sc.Host = fileCfg.Server.Host
		}
		if fileCfg.Server.Port > 0 {
			sc.Port = fileCfg.Server.Port
		}
		if fileCfg.Server.MaxBodyBytes > 0 {
			sc.MaxBodyBytes = fileCfg.Server.MaxBodyBytes
		}
	}
	sc.Host = getenvStr("POOL_SERVER_HOST", sc.Host)
	sc.Port = getenvInt("POOL_SERVER_PORT", sc.Port)
	sc.MaxBodyBytes = getenvInt64("POOL_SERVER_MAX_BODY_BYTES", sc.MaxBodyBytes)

	pc := pool.DefaultConfig()
	if hasFileCfg {
		if fileCfg.Pool.TopCacheMax > 0 {
			pc.TopCacheMax = fileCfg.Pool.TopCacheMax
		}
		if fileCfg.Pool.TTLGraceSec > 0 {
			pc.TTLGraceSec = fileCfg.Pool.TTLGraceSec
		}
		if fileCfg.Pool.MaxBatchSize > 0 {
			pc.MaxBatchSize = fileCfg.Pool.MaxBatchSize
		}
		if fileCfg.Pool.TopRefreshMS > 0 {
			pc.TopRefreshMS = fileCfg.Pool.TopRefreshMS
		}
		if fileCfg.Pool.ExpireSweepMS > 0 {
			pc.ExpireSweepMS = fileCfg.Pool.ExpireSweepMS
		}
		if fileCfg.Pool.Shards > 0 {
			pc.MinHeapShards = fileCfg.Pool.Shards
		}
		if fileCfg.Pool.LearningJoinWeight > 0 {
			pc.LearningJoinWeight = fileCfg.Pool.LearningJoinWeight
		}
		if fileCfg.Pool.LearningWinWeight > 0 {
			pc.LearningWinWeight = fileCfg.Pool.LearningWinWeight
		}
		if strings.TrimSpace(fileCfg.Pool.FeedbackLogPath) != "" {
			pc.FeedbackLogPath = strings.TrimSpace(fileCfg.Pool.FeedbackLogPath)
		}
	}
	pc.TopCacheMax = getenvInt("POOL_SERVER_TOP_CACHE_MAX", pc.TopCacheMax)
	pc.TTLGraceSec = getenvInt64("POOL_SERVER_TTL_GRACE_SEC", pc.TTLGraceSec)
	pc.MaxBatchSize = getenvInt("POOL_SERVER_MAX_BATCH_SIZE", pc.MaxBatchSize)
	pc.TopRefreshMS = getenvInt64("POOL_SERVER_TOP_CACHE_REFRESH_MS", pc.TopRefreshMS)
	pc.ExpireSweepMS = getenvInt64("POOL_SERVER_EXPIRE_SWEEP_MS", pc.ExpireSweepMS)
	pc.MinHeapShards = getenvInt("POOL_SERVER_SHARDS", pc.MinHeapShards)
	if v := strings.TrimSpace(os.Getenv("POOL_SERVER_LEARNING_JOIN_WEIGHT")); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
			pc.LearningJoinWeight = parsed
		}
	}
	if v := strings.TrimSpace(os.Getenv("POOL_SERVER_LEARNING_WIN_WEIGHT")); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
			pc.LearningWinWeight = parsed
		}
	}
	if v := strings.TrimSpace(os.Getenv("POOL_SERVER_FEEDBACK_LOG")); v != "" {
		pc.FeedbackLogPath = v
	}

	lc := licensepkg.Config{
		Enabled:              false,
		DefaultUnrestricted:  false,
		Host:                 "127.0.0.1",
		Port:                 3306,
		User:                 "root",
		Database:             "dy_fudai",
		Params:               "charset=utf8mb4&parseTime=true&loc=Local",
		MaxOpenConns:         8,
		MaxIdleConns:         4,
		ConnMaxLifetimeMin:   30,
		MiniAppEnabled:       false,
		MiniAppSessionTTLMin: 1440,
		MiniAppPagePath:      "pages/index/index",
		MiniAppEnvVersion:    "release",
	}
	adminToken := ""
	licenseAdUnlockDays := 1
	if hasFileCfg {
		lc.Enabled = fileCfg.License.Enabled
		lc.DefaultUnrestricted = fileCfg.License.Unrestricted
		adminToken = strings.TrimSpace(fileCfg.License.AdminToken)
		if fileCfg.License.AdUnlockDays > 0 {
			licenseAdUnlockDays = fileCfg.License.AdUnlockDays
		}
		lc.MiniAppEnabled = fileCfg.License.MiniAppEnabled
		lc.MiniAppAppID = strings.TrimSpace(fileCfg.License.MiniAppAppID)
		lc.MiniAppAppSecret = strings.TrimSpace(fileCfg.License.MiniAppAppSecret)
		lc.MiniAppSessionSecret = strings.TrimSpace(fileCfg.License.MiniAppSessionSecret)
		if fileCfg.License.MiniAppSessionTTLMin > 0 {
			lc.MiniAppSessionTTLMin = fileCfg.License.MiniAppSessionTTLMin
		}
		if strings.TrimSpace(fileCfg.License.MiniAppPagePath) != "" {
			lc.MiniAppPagePath = strings.TrimSpace(fileCfg.License.MiniAppPagePath)
		}
		if strings.TrimSpace(fileCfg.License.MiniAppEnvVersion) != "" {
			lc.MiniAppEnvVersion = strings.TrimSpace(fileCfg.License.MiniAppEnvVersion)
		}
		if strings.TrimSpace(fileCfg.License.DSN) != "" {
			lc.DSN = strings.TrimSpace(fileCfg.License.DSN)
		}
		if strings.TrimSpace(fileCfg.License.Host) != "" {
			lc.Host = strings.TrimSpace(fileCfg.License.Host)
		}
		if fileCfg.License.Port > 0 {
			lc.Port = fileCfg.License.Port
		}
		if strings.TrimSpace(fileCfg.License.User) != "" {
			lc.User = strings.TrimSpace(fileCfg.License.User)
		}
		if strings.TrimSpace(fileCfg.License.Password) != "" {
			lc.Password = fileCfg.License.Password
		}
		if strings.TrimSpace(fileCfg.License.Database) != "" {
			lc.Database = strings.TrimSpace(fileCfg.License.Database)
		}
		if strings.TrimSpace(fileCfg.License.Params) != "" {
			lc.Params = strings.TrimSpace(fileCfg.License.Params)
		}
		if fileCfg.License.MaxOpenConns > 0 {
			lc.MaxOpenConns = fileCfg.License.MaxOpenConns
		}
		if fileCfg.License.MaxIdleConns > 0 {
			lc.MaxIdleConns = fileCfg.License.MaxIdleConns
		}
		if fileCfg.License.ConnMaxLifetimeMin > 0 {
			lc.ConnMaxLifetimeMin = fileCfg.License.ConnMaxLifetimeMin
		}
	}
	lc.Enabled = getenvBool("POOL_LICENSE_ENABLED", lc.Enabled)
	lc.DefaultUnrestricted = getenvBool("POOL_LICENSE_UNRESTRICTED", lc.DefaultUnrestricted)
	lc.MiniAppEnabled = getenvBool("POOL_LICENSE_MINIAPP_ENABLED", lc.MiniAppEnabled)
	lc.MiniAppAppID = getenvStr("POOL_LICENSE_MINIAPP_APP_ID", lc.MiniAppAppID)
	lc.MiniAppAppSecret = getenvStr("POOL_LICENSE_MINIAPP_APP_SECRET", lc.MiniAppAppSecret)
	lc.MiniAppSessionSecret = getenvStr("POOL_LICENSE_MINIAPP_SESSION_SECRET", lc.MiniAppSessionSecret)
	lc.MiniAppSessionTTLMin = getenvInt("POOL_LICENSE_MINIAPP_SESSION_TTL_MIN", lc.MiniAppSessionTTLMin)
	lc.MiniAppPagePath = getenvStr("POOL_LICENSE_MINIAPP_PAGE_PATH", lc.MiniAppPagePath)
	lc.MiniAppEnvVersion = getenvStr("POOL_LICENSE_MINIAPP_ENV_VERSION", lc.MiniAppEnvVersion)
	lc.DSN = getenvStr("POOL_LICENSE_DSN", lc.DSN)
	lc.Host = getenvStr("POOL_LICENSE_MYSQL_HOST", lc.Host)
	lc.Port = getenvInt("POOL_LICENSE_MYSQL_PORT", lc.Port)
	lc.User = getenvStr("POOL_LICENSE_MYSQL_USER", lc.User)
	lc.Password = getenvStr("POOL_LICENSE_MYSQL_PASSWORD", lc.Password)
	lc.Database = getenvStr("POOL_LICENSE_MYSQL_DATABASE", lc.Database)
	lc.Params = getenvStr("POOL_LICENSE_MYSQL_PARAMS", lc.Params)
	lc.MaxOpenConns = getenvInt("POOL_LICENSE_MYSQL_MAX_OPEN_CONNS", lc.MaxOpenConns)
	lc.MaxIdleConns = getenvInt("POOL_LICENSE_MYSQL_MAX_IDLE_CONNS", lc.MaxIdleConns)
	lc.ConnMaxLifetimeMin = getenvInt("POOL_LICENSE_MYSQL_CONN_MAX_LIFETIME_MIN", lc.ConnMaxLifetimeMin)
	adminToken = strings.TrimSpace(getenvStr("POOL_LICENSE_ADMIN_TOKEN", getenvStr("LICENSE_ADMIN_TOKEN", adminToken)))
	licenseAdUnlockDays = getenvInt("POOL_LICENSE_AD_UNLOCK_DAYS", licenseAdUnlockDays)
	if licenseAdUnlockDays <= 0 {
		licenseAdUnlockDays = 1
	}

	rc := pool.DefaultRedisConfig()
	redisEnabled := false
	if hasFileCfg {
		redisEnabled = fileCfg.Redis.Enabled
		if fileCfg.Redis.Addr != "" {
			rc.Addr = fileCfg.Redis.Addr
		}
		rc.Password = fileCfg.Redis.Password
		rc.DB = fileCfg.Redis.DB
		if fileCfg.Redis.Prefix != "" {
			rc.Prefix = fileCfg.Redis.Prefix
		}
		if fileCfg.Redis.PoolSize > 0 {
			rc.PoolSize = fileCfg.Redis.PoolSize
		}
		if fileCfg.Redis.MinIdleConns >= 0 {
			rc.MinIdleConns = fileCfg.Redis.MinIdleConns
		}
		if fileCfg.Redis.DialTimeoutMS > 0 {
			rc.DialTimeoutMS = fileCfg.Redis.DialTimeoutMS
		}
		if fileCfg.Redis.ReadTimeoutMS > 0 {
			rc.ReadTimeoutMS = fileCfg.Redis.ReadTimeoutMS
		}
		if fileCfg.Redis.WriteTimeoutMS > 0 {
			rc.WriteTimeoutMS = fileCfg.Redis.WriteTimeoutMS
		}
	}
	if v := strings.TrimSpace(os.Getenv("REDIS_ADDR")); v != "" {
		rc.Addr = v
		redisEnabled = true
	}
	if v := strings.TrimSpace(os.Getenv("POOL_REDIS_ADDR")); v != "" {
		rc.Addr = v
		redisEnabled = true
	}
	redisEnabled = getenvBool("POOL_REDIS_ENABLED", redisEnabled)
	rc.Password = getenvStr("REDIS_PASSWORD", getenvStr("POOL_REDIS_PASSWORD", rc.Password))
	rc.DB = getenvInt("REDIS_DB", getenvInt("POOL_REDIS_DB", rc.DB))
	rc.Prefix = getenvStr("POOL_REDIS_PREFIX", rc.Prefix)
	rc.PoolSize = getenvInt("POOL_REDIS_POOL_SIZE", rc.PoolSize)
	rc.MinIdleConns = getenvInt("POOL_REDIS_MIN_IDLE_CONNS", rc.MinIdleConns)
	rc.DialTimeoutMS = getenvInt64("POOL_REDIS_DIAL_TIMEOUT_MS", rc.DialTimeoutMS)
	rc.ReadTimeoutMS = getenvInt64("POOL_REDIS_READ_TIMEOUT_MS", rc.ReadTimeoutMS)
	rc.WriteTimeoutMS = getenvInt64("POOL_REDIS_WRITE_TIMEOUT_MS", rc.WriteTimeoutMS)

	var svc pool.Engine
	if redisEnabled && strings.TrimSpace(rc.Addr) != "" {
		rs, err := pool.NewRedisService(pc, rc)
		if err != nil {
			log.Fatalf("init redis service failed: %v", err)
		}
		svc = rs
		log.Printf("[pool-server-go] mode=redis addr=%s db=%d prefix=%s", rc.Addr, rc.DB, rc.Prefix)
	} else {
		svc = pool.NewService(pc)
		log.Printf("[pool-server-go] mode=memory (set POOL_REDIS_ENABLED=1 and REDIS_ADDR to enable shared pool)")
	}
	defer func() {
		_ = svc.Close()
	}()

	licenseSvc, licenseErr := licensepkg.NewService(lc)
	if licenseErr != nil {
		log.Printf("[pool-server-go] license init failed: %v", licenseErr)
	} else if lc.Enabled {
		log.Printf("[pool-server-go] license=mysql host=%s port=%d db=%s unrestrictedDefault=%v", lc.Host, lc.Port, lc.Database, lc.DefaultUnrestricted)
	} else {
		log.Printf("[pool-server-go] license=disabled")
	}
	if strings.TrimSpace(adminToken) != "" {
		log.Printf("[pool-server-go] license-admin=enabled")
	} else {
		log.Printf("[pool-server-go] license-admin=disabled (set POOL_LICENSE_ADMIN_TOKEN)")
	}
	defer func() {
		if licenseSvc != nil {
			_ = licenseSvc.Close()
		}
	}()
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		svc.SweepExpired(time.Now().UnixMilli())
		_, profileVersion := svc.Profile()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"now":            time.Now().UnixMilli(),
			"pid":            os.Getpid(),
			"goVersion":      runtime.Version(),
			"cpuCount":       runtime.NumCPU(),
			"profileVersion": profileVersion,
		})
	})

	if desktopStaticDir, ok := resolveDesktopStaticDir(); ok {
		desktopFS := http.FileServer(http.Dir(desktopStaticDir))
		mux.HandleFunc("/desktop", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				writeJSON(w, http.StatusNoContent, map[string]any{})
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
				return
			}
			http.Redirect(w, r, "/desktop/", http.StatusMovedPermanently)
		})
		mux.Handle("/desktop/", http.StripPrefix("/desktop/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(strings.TrimSpace(r.URL.Path), "hot-manifest.json") {
				w.Header().Set("Cache-Control", "no-store")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			desktopFS.ServeHTTP(w, r)
		})))
		log.Printf("[pool-server-go] desktop-static=enabled dir=%s", desktopStaticDir)
	} else {
		log.Printf("[pool-server-go] desktop-static=disabled (set POOL_DESKTOP_STATIC_DIR or package static files)")
	}

	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		st, meta, pv := svc.Stats()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"stats":          st,
			"topMeta":        meta,
			"profileVersion": pv,
		})
	})

	mux.HandleFunc("/license/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": true,
				"license": map[string]any{
					"enabled":    false,
					"available":  false,
					"authorized": false,
					"state":      "disabled",
					"message":    "未启用授权",
					"checkedAt":  time.Now().UnixMilli(),
					"features":   map[string]any{},
				},
			})
			return
		}

		clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
		fingerprint := strings.TrimSpace(r.URL.Query().Get("fingerprint"))
		status, err := licenseSvc.Status(r.Context(), clientID, fingerprint)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "license": status})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "license": status})
	})

	mux.HandleFunc("/license/activate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "license_disabled",
				"license": map[string]any{
					"enabled":    false,
					"available":  false,
					"authorized": false,
					"state":      "disabled",
					"message":    "未启用授权",
					"checkedAt":  time.Now().UnixMilli(),
					"features":   map[string]any{},
				},
			})
			return
		}

		var req struct {
			LicenseKey   string `json:"licenseKey"`
			ClientID     string `json:"clientId"`
			Fingerprint  string `json:"fingerprint"`
			AppVersion   string `json:"appVersion"`
			CurrentAccts int    `json:"currentAccounts"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}

		status, err := licenseSvc.Activate(r.Context(), licensepkg.ActivateRequest{
			LicenseKey:   req.LicenseKey,
			ClientID:     req.ClientID,
			Fingerprint:  req.Fingerprint,
			AppVersion:   req.AppVersion,
			CurrentAccts: req.CurrentAccts,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "license": status})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "license": status})
	})

	mux.HandleFunc("/license/trial/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "license_disabled",
				"license": map[string]any{
					"enabled":            false,
					"available":          false,
					"authorized":         false,
					"state":              "disabled",
					"message":            "未启用授权",
					"checkedAt":          time.Now().UnixMilli(),
					"features":           map[string]any{},
					"featureFlags":       map[string]bool{},
					"accessMode":         "disabled",
					"trialState":         "none",
					"trialExpireAt":      int64(0),
					"trialRemainingSec":  int64(0),
					"requiresActivation": false,
					"licensePlan":        "",
				},
			})
			return
		}

		var req struct {
			ClientID    string `json:"clientId"`
			Fingerprint string `json:"fingerprint"`
			AppVersion  string `json:"appVersion"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}

		status, err := licenseSvc.StartTrial(r.Context(), licensepkg.TrialRequest{
			ClientID:    req.ClientID,
			Fingerprint: req.Fingerprint,
			AppVersion:  req.AppVersion,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "license": status})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "license": status})
	})

	mux.HandleFunc("/admin/api/license-settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			result, err := licenseSvc.AdminGetGlobalSettings(r.Context())
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_settings_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
		case http.MethodPost:
			var req struct {
				Unrestricted   *bool   `json:"unrestricted"`
				NoticeMarkdown *string `json:"noticeMarkdown"`
			}
			if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
				writeBodyErr(w, err)
				return
			}
			nextUnrestricted := false
			if req.Unrestricted != nil {
				nextUnrestricted = *req.Unrestricted
			} else {
				current, err := licenseSvc.AdminGetGlobalSettings(r.Context())
				if err != nil {
					writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_settings_update_failed"})
					return
				}
				nextUnrestricted = current.Unrestricted
			}
			result, err := licenseSvc.AdminSetGlobalSettings(r.Context(), nextUnrestricted, req.NoticeMarkdown)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_settings_update_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		}
	})

	mux.HandleFunc("/desktop/notice", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "markdown": ""})
			return
		}
		markdown, err := licenseSvc.GetDesktopNoticeMarkdown(r.Context())
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "desktop_notice_unavailable", "markdown": ""})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "markdown": markdown})
	})

	mux.HandleFunc("/license/bind-session/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		var req struct {
			ClientID     string `json:"clientId"`
			Fingerprint  string `json:"fingerprint"`
			AppVersion   string `json:"appVersion"`
			AdUnlockDays int    `json:"adUnlockDays"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if req.AdUnlockDays <= 0 {
			req.AdUnlockDays = licenseAdUnlockDays
		}
		session, err := licenseSvc.CreateBindSession(r.Context(), licensepkg.CreateBindSessionRequest{
			ClientID:     req.ClientID,
			Fingerprint:  req.Fingerprint,
			AppVersion:   req.AppVersion,
			AdUnlockDays: req.AdUnlockDays,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"session": session,
			"qrText":  strings.TrimSpace(session.BindToken),
		})
	})

	mux.HandleFunc("/license/bind-session/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		bindToken := strings.TrimSpace(r.URL.Query().Get("bindToken"))
		session, err := licenseSvc.GetBindSession(r.Context(), bindToken)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"session": session,
			"qrText":  strings.TrimSpace(session.BindToken),
		})
	})

	mux.HandleFunc("/license/bind-session/miniapp-code", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		bindRef := firstNonEmpty(
			strings.TrimSpace(r.URL.Query().Get("sceneCode")),
			strings.TrimSpace(r.URL.Query().Get("scene")),
			strings.TrimSpace(r.URL.Query().Get("bindToken")),
		)
		imageBytes, contentType, err := licenseSvc.GetMiniAppCodeImage(r.Context(), bindRef)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(imageBytes)
	})

	mux.HandleFunc("/license/bind-session/scan-code", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		bindRef := firstNonEmpty(
			strings.TrimSpace(r.URL.Query().Get("sceneCode")),
			strings.TrimSpace(r.URL.Query().Get("scene")),
			strings.TrimSpace(r.URL.Query().Get("bindToken")),
		)
		imageBytes, contentType, err := licenseSvc.GetMiniAppScanCodeImage(r.Context(), bindRef)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(imageBytes)
	})

	mux.HandleFunc("/license/bind-session/scan", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		var req struct {
			BindToken string `json:"bindToken"`
			OpenID    string `json:"openId"`
			UnionID   string `json:"unionId"`
			Nickname  string `json:"nickname"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		session, err := licenseSvc.MarkBindSessionScanned(r.Context(), licensepkg.BindSessionScanRequest{
			BindToken: req.BindToken,
			OpenID:    req.OpenID,
			UnionID:   req.UnionID,
			Nickname:  req.Nickname,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/license/bind-session/grant", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}

		var req struct {
			BindToken string `json:"bindToken"`
			Days      int    `json:"days"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if req.Days <= 0 {
			req.Days = licenseAdUnlockDays
		}
		session, err := licenseSvc.GrantBindSession(r.Context(), licensepkg.BindSessionGrantRequest{
			BindToken: req.BindToken,
			Days:      req.Days,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/miniapp/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			Code string `json:"code"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		session, err := licenseSvc.MiniAppLogin(r.Context(), req.Code)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/miniapp/bootstrap", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		unrestricted := false
		if licenseSvc != nil {
			if value, err := licenseSvc.IsUnrestricted(r.Context()); err == nil {
				unrestricted = value
			}
		}
		reason := ""
		message := "ok"
		ready := false
		switch {
		case !lc.Enabled:
			reason = "license_disabled"
			message = "授权服务未启用"
		case licenseErr != nil:
			reason = "license_service_init_failed"
			message = "授权服务初始化失败"
		case unrestricted:
			reason = "license_unrestricted"
			message = "服务端免授权已开启"
			ready = true
		case !lc.MiniAppEnabled:
			reason = "miniapp_disabled"
			message = "小程序授权未启用"
		case strings.TrimSpace(lc.MiniAppAppID) == "" || strings.TrimSpace(lc.MiniAppAppSecret) == "":
			reason = "miniapp_config_incomplete"
			message = "服务端未配置小程序参数"
		case strings.TrimSpace(lc.MiniAppSessionSecret) == "":
			reason = "miniapp_session_secret_required"
			message = "服务端缺少会话密钥"
		default:
			ready = true
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"bootstrap": map[string]any{
				"licenseEnabled": lc.Enabled,
				"unrestricted":   unrestricted,
				"miniAppEnabled": lc.MiniAppEnabled,
				"ready":          ready,
				"reason":         reason,
				"message":        message,
				"adUnlockDays":   licenseAdUnlockDays,
				"pagePath":       lc.MiniAppPagePath,
				"envVersion":     lc.MiniAppEnvVersion,
				"serverTime":     time.Now().UnixMilli(),
			},
		})
	})

	mux.HandleFunc("/miniapp/bind-session/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		bindRef := firstNonEmpty(
			strings.TrimSpace(r.URL.Query().Get("scene")),
			strings.TrimSpace(r.URL.Query().Get("sceneCode")),
			strings.TrimSpace(r.URL.Query().Get("bindToken")),
		)
		session, err := licenseSvc.MiniAppGetBindSession(r.Context(), bindRef)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/miniapp/bind-session/scan", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			BindToken    string `json:"bindToken"`
			Scene        string `json:"scene"`
			SceneCode    string `json:"sceneCode"`
			SessionToken string `json:"sessionToken"`
			Nickname     string `json:"nickname"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		bindRef := firstNonEmpty(req.Scene, req.SceneCode, req.BindToken)
		session, err := licenseSvc.MiniAppScanBindSession(r.Context(), bindRef, req.SessionToken, req.Nickname)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/miniapp/bind-session/grant", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			BindToken    string `json:"bindToken"`
			Scene        string `json:"scene"`
			SceneCode    string `json:"sceneCode"`
			SessionToken string `json:"sessionToken"`
			Days         int    `json:"days"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if req.Days <= 0 {
			req.Days = licenseAdUnlockDays
		}
		bindRef := firstNonEmpty(req.Scene, req.SceneCode, req.BindToken)
		session, err := licenseSvc.MiniAppGrantBindSession(r.Context(), bindRef, req.SessionToken, req.Days)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
	})

	mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(adminLicenseHTML)
	})

	mux.HandleFunc("/admin/api/licenses", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		query := licensepkg.AdminListQuery{
			Keyword:  strings.TrimSpace(r.URL.Query().Get("keyword")),
			Status:   strings.TrimSpace(r.URL.Query().Get("status")),
			Page:     parsePositiveIntQuery(r.URL.Query().Get("page"), 1),
			PageSize: parsePositiveIntQuery(r.URL.Query().Get("pageSize"), 30),
		}
		result, err := licenseSvc.ListAdminLicenses(r.Context(), query)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
	})

	mux.HandleFunc("/admin/api/licenses/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			LicenseKey   string         `json:"licenseKey"`
			CustomerName string         `json:"customerName"`
			PlanName     string         `json:"planName"`
			Status       string         `json:"status"`
			ExpireAtMS   int64          `json:"expireAt"`
			MaxClients   int            `json:"maxClients"`
			MaxAccounts  int            `json:"maxAccounts"`
			Features     map[string]any `json:"features"`
			Days         int            `json:"days"`
			Quantity     int            `json:"quantity"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.LicenseKey) == "" {
			effectiveDays := req.Days
			if effectiveDays <= 0 {
				effectiveDays = 30
			}
			if effectiveDays > 3650 {
				effectiveDays = 3650
			}
			items, err := licenseSvc.AdminCreateLicensesBatch(r.Context(), licensepkg.AdminCreateBatchRequest{
				Days:     req.Days,
				Quantity: req.Quantity,
			})
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			keys := make([]string, 0, len(items))
			for _, item := range items {
				key := strings.TrimSpace(item.LicenseKey)
				if key == "" {
					continue
				}
				keys = append(keys, key)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": true,
				"result": map[string]any{
					"count": len(items),
					"days":  effectiveDays,
					"keys":  keys,
					"items": items,
				},
			})
			return
		}
		item, err := licenseSvc.AdminCreateLicense(r.Context(), licensepkg.AdminCreateRequest{
			LicenseKey:   req.LicenseKey,
			CustomerName: req.CustomerName,
			PlanName:     req.PlanName,
			Status:       req.Status,
			ExpireAtMS:   req.ExpireAtMS,
			MaxClients:   req.MaxClients,
			MaxAccounts:  req.MaxAccounts,
			Features:     req.Features,
		})
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": item})
	})

	mux.HandleFunc("/admin/api/licenses/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			ID     int64  `json:"id"`
			Status string `json:"status"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		item, err := licenseSvc.AdminSetLicenseStatus(r.Context(), req.ID, req.Status)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "license_not_found"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": item})
	})

	mux.HandleFunc("/admin/api/licenses/extend", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			ID   int64 `json:"id"`
			Days int   `json:"days"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		item, err := licenseSvc.AdminExtendLicense(r.Context(), req.ID, req.Days)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "license_not_found"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": item})
	})

	mux.HandleFunc("/admin/api/licenses/unbind", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			ID int64 `json:"id"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		item, err := licenseSvc.AdminUnbindLicense(r.Context(), req.ID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "license_not_found"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": item})
	})

	mux.HandleFunc("/admin/api/licenses/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, adminToken) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		var req struct {
			ID int64 `json:"id"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if err := licenseSvc.AdminDeleteLicense(r.Context(), req.ID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "license_not_found"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("/filter/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}
		switch r.Method {
		case http.MethodGet:
			p, pv := svc.Profile()
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "profile": p, "profileVersion": pv})
		case http.MethodPost:
			var patch map[string]any
			if err := parseBody(r, sc.MaxBodyBytes, &patch); err != nil {
				writeBodyErr(w, err)
				return
			}
			p, pv := svc.UpdateProfile(patch)
			svc.RefreshTop(true)
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "profile": p, "profileVersion": pv})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		}
	})

	mux.HandleFunc("/candidate/batch-upsert", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			SourceID    string           `json:"sourceId"`
			Candidates  []map[string]any `json:"candidates"`
			Filters     map[string]any   `json:"filters"`
			TopLimit    int              `json:"topLimit"`
			ClaimTask   bool             `json:"claimTask"`
			ClientID    string           `json:"clientId"`
			AccountID   string           `json:"accountId"`
			LeaseSec    int64            `json:"leaseSec"`
			PreferKeys  []string         `json:"preferKeys"`
			ExcludeKeys []string         `json:"excludeKeys"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if len(req.Candidates) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "candidates is required and must be array"})
			return
		}

		res := svc.UpsertBatch(req.SourceID, req.Candidates)
		svc.RefreshTop(false)
		if !req.ClaimTask {
			nowMS := time.Now().UnixMilli()
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":                  true,
				"generatedAt":         nowMS,
				"received":            res.Received,
				"accepted":            res.Accepted,
				"inserted":            res.Inserted,
				"updated":             res.Updated,
				"ignoredExpired":      res.IgnoredExpired,
				"ignoredOlder":        res.IgnoredOlder,
				"invalid":             res.Invalid,
				"activeCandidates":    res.ActiveCandidates,
				"validCandidates":     res.ActiveCandidates,
				"availableCandidates": 0,
				"profileVersion":      res.ProfileVersion,
				"claim": map[string]any{
					"claimed": false,
					"reason":  "not_requested",
				},
			})
			return
		}

		baseProfile, _ := svc.Profile()
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, req.Filters)
		owner := pool.ClaimOwner{
			ClientID:  strings.TrimSpace(req.ClientID),
			AccountID: strings.TrimSpace(req.AccountID),
		}
		if owner.ClientID == "" {
			owner.ClientID = strings.TrimSpace(r.Header.Get("x-pool-client-id"))
		}
		if owner.AccountID == "" {
			owner.AccountID = strings.TrimSpace(req.SourceID)
		}
		topLimit := req.TopLimit
		if topLimit <= 0 {
			topLimit = 5
		}
		if topLimit > 20 {
			topLimit = 20
		}
		claimPayload := map[string]any{
			"claimed": false,
			"reason":  "",
		}
		if req.ClaimTask && owner.ClientID != "" && owner.AccountID != "" {
			claimResult, err := svc.ClaimTask(pool.ClaimOptions{
				Owner:       owner,
				LeaseSec:    req.LeaseSec,
				Profile:     effectiveProfile,
				PreferKeys:  req.PreferKeys,
				ExcludeKeys: req.ExcludeKeys,
			})
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			claimPayload = map[string]any{
				"claimed":        claimResult.Claimed,
				"reason":         claimResult.Reason,
				"item":           claimResult.Item,
				"lease":          claimResult.Lease,
				"profileVersion": claimResult.ProfileVersion,
				"generatedAt":    claimResult.GeneratedAtMS,
			}
		}
		eligibleItems, eligibleMeta, _ := svc.TopAvailable(topLimit, effectiveProfile, owner, true)
		debugSnapshot, _ := svc.TaskDebug(effectiveProfile, owner, 1)
		summary := debugSnapshot.Summary
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                  true,
			"generatedAt":         summary.GeneratedAtMS,
			"received":            res.Received,
			"accepted":            res.Accepted,
			"inserted":            res.Inserted,
			"updated":             res.Updated,
			"ignoredExpired":      res.IgnoredExpired,
			"ignoredOlder":        res.IgnoredOlder,
			"invalid":             res.Invalid,
			"activeCandidates":    summary.ActiveCandidates,
			"validCandidates":     summary.ValidCandidates,
			"availableCandidates": summary.AvailableCandidates,
			"profileVersion":      res.ProfileVersion,
			"appliedFilters":      effectiveProfile,
			"eligibleItems":       eligibleItems,
			"eligibleMeta":        eligibleMeta,
			"claim":               claimPayload,
		})
	})

	mux.HandleFunc("/pool/top", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}
		limit := 50
		if s := r.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 {
				limit = n
			}
		}
		baseProfile, _ := svc.Profile()
		filterPatch := parseTopFilterPatch(r)
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, filterPatch)
		owner := parseClaimOwnerFromQuery(r)
		includeClaimedSelf := false
		if v := strings.TrimSpace(r.URL.Query().Get("includeClaimedSelf")); v != "" {
			if b, ok := parseBoolQuery(v); ok {
				includeClaimedSelf = b
			}
		}

		var (
			items []pool.ScoredCandidate
			meta  pool.TopMeta
			pv    int64
		)
		if owner.ClientID != "" && owner.AccountID != "" {
			items, meta, pv = svc.TopAvailable(limit, effectiveProfile, owner, includeClaimedSelf)
		} else if len(filterPatch) > 0 {
			items, meta, pv = svc.TopWithProfile(limit, effectiveProfile)
		} else {
			items, meta, pv = svc.Top(limit)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":               true,
			"profileVersion":   pv,
			"generatedAt":      meta.BuiltAtMS,
			"activeCandidates": meta.ActiveCount,
			"validCandidates":  meta.ValidCount,
			"appliedFilters":   effectiveProfile,
			"items":            items,
		})
	})

	mux.HandleFunc("/scan/assignment", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
		if clientID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId is required"})
			return
		}

		categoryIDs := parseCSVQuery(r.URL.Query().Get("categories"))
		assignment, err := svc.ScanAssignment(clientID, categoryIDs, parseScanTelemetryFromQuery(r))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"assignment": assignment,
		})
	})

	mux.HandleFunc("/scan/permit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID  string `json:"clientId"`
			AccountID string `json:"accountId"`
			Kind      string `json:"kind"`
			Cost      int    `json:"cost"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.ClientID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId is required"})
			return
		}
		result, err := svc.ScanPermit(pool.ScanPermitOptions{
			ClientID:  req.ClientID,
			AccountID: req.AccountID,
			Kind:      req.Kind,
			Cost:      req.Cost,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "permit": result})
	})

	mux.HandleFunc("/scan/all/claim", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID   string `json:"clientId"`
			AccountID  string `json:"accountId"`
			LeaseTTLMS int64  `json:"leaseTtlMs"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.AccountID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId and accountId are required"})
			return
		}
		result, err := svc.ClaimAllScanCursor(pool.AllScanClaimOptions{
			ClientID:   req.ClientID,
			AccountID:  req.AccountID,
			LeaseTTLMS: req.LeaseTTLMS,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cursor": result})
	})

	mux.HandleFunc("/scan/all/report", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID          string `json:"clientId"`
			AccountID         string `json:"accountId"`
			SlotID            string `json:"slotId"`
			UsedCursorMaxTime int64  `json:"usedCursorMaxTime"`
			NextCursorMaxTime int64  `json:"nextCursorMaxTime"`
			HasMore           bool   `json:"hasMore"`
			RawRooms          int    `json:"rawRooms"`
			HintedRooms       int    `json:"hintedRooms"`
			QualifiedRooms    int    `json:"qualifiedRooms"`
			Error             string `json:"error"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.AccountID) == "" || strings.TrimSpace(req.SlotID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId, accountId and slotId are required"})
			return
		}
		result, err := svc.ReportAllScanCursor(pool.AllScanReportOptions{
			ClientID:          req.ClientID,
			AccountID:         req.AccountID,
			SlotID:            req.SlotID,
			UsedCursorMaxTime: req.UsedCursorMaxTime,
			NextCursorMaxTime: req.NextCursorMaxTime,
			HasMore:           req.HasMore,
			RawRooms:          req.RawRooms,
			HintedRooms:       req.HintedRooms,
			QualifiedRooms:    req.QualifiedRooms,
			Error:             req.Error,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
	})

	mux.HandleFunc("/task/claim", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID    string         `json:"clientId"`
			AccountID   string         `json:"accountId"`
			LeaseSec    int64          `json:"leaseSec"`
			Filters     map[string]any `json:"filters"`
			PreferKeys  []string       `json:"preferKeys"`
			ExcludeKeys []string       `json:"excludeKeys"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.AccountID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId and accountId are required"})
			return
		}

		baseProfile, _ := svc.Profile()
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, req.Filters)
		result, err := svc.ClaimTask(pool.ClaimOptions{
			Owner: pool.ClaimOwner{
				ClientID:  req.ClientID,
				AccountID: req.AccountID,
			},
			LeaseSec:    req.LeaseSec,
			Profile:     effectiveProfile,
			PreferKeys:  req.PreferKeys,
			ExcludeKeys: req.ExcludeKeys,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"claimed":        result.Claimed,
			"reason":         result.Reason,
			"item":           result.Item,
			"lease":          result.Lease,
			"profileVersion": result.ProfileVersion,
			"generatedAt":    result.GeneratedAtMS,
			"appliedFilters": effectiveProfile,
		})
	})

	mux.HandleFunc("/task/review", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID            string         `json:"clientId"`
			AccountID           string         `json:"accountId"`
			CurrentCandidateKey string         `json:"currentCandidateKey"`
			CurrentRoomID       string         `json:"currentRoomId"`
			Filters             map[string]any `json:"filters"`
			ExcludeKeys         []string       `json:"excludeKeys"`
			Stage               string         `json:"stage"`
			Limit               int            `json:"limit"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.AccountID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "clientId and accountId are required"})
			return
		}

		baseProfile, _ := svc.Profile()
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, req.Filters)
		result, err := svc.ReviewTask(pool.ReviewOptions{
			Owner: pool.ClaimOwner{
				ClientID:  req.ClientID,
				AccountID: req.AccountID,
			},
			Profile:             effectiveProfile,
			CurrentCandidateKey: req.CurrentCandidateKey,
			CurrentRoomID:       req.CurrentRoomID,
			ExcludeKeys:         req.ExcludeKeys,
			Stage:               req.Stage,
			Limit:               req.Limit,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"reviewed":       result.Reviewed,
			"stage":          result.Stage,
			"decision":       result.Decision,
			"reason":         result.Reason,
			"item":           result.Item,
			"current":        result.Current,
			"alternatives":   result.Alternatives,
			"profileVersion": result.ProfileVersion,
			"generatedAt":    result.GeneratedAtMS,
			"appliedFilters": effectiveProfile,
		})
	})

	mux.HandleFunc("/task/renew", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID  string `json:"clientId"`
			AccountID string `json:"accountId"`
			LeaseID   string `json:"leaseId"`
			LeaseSec  int64  `json:"leaseSec"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		lease, renewed, err := svc.RenewTaskLease(pool.ClaimOwner{
			ClientID:  req.ClientID,
			AccountID: req.AccountID,
		}, req.LeaseID, req.LeaseSec)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "renewed": renewed, "lease": lease})
	})

	mux.HandleFunc("/task/release", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID  string `json:"clientId"`
			AccountID string `json:"accountId"`
			LeaseID   string `json:"leaseId"`
			Reason    string `json:"reason"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		released, err := svc.ReleaseTaskLease(pool.ClaimOwner{
			ClientID:  req.ClientID,
			AccountID: req.AccountID,
		}, req.LeaseID, req.Reason)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "released": released})
	})

	mux.HandleFunc("/task/finish", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID        string `json:"clientId"`
			AccountID       string `json:"accountId"`
			LeaseID         string `json:"leaseId"`
			Result          string `json:"result"`
			RemoveCandidate bool   `json:"removeCandidate"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		finished, err := svc.FinishTaskLease(pool.ClaimOwner{
			ClientID:  req.ClientID,
			AccountID: req.AccountID,
		}, req.LeaseID, req.Result, req.RemoveCandidate)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "finished": finished})
	})

	mux.HandleFunc("/task/feedback", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		var req struct {
			ClientID             string            `json:"clientId"`
			AccountID            string            `json:"accountId"`
			Event                string            `json:"event"`
			CandidateKey         string            `json:"candidateKey"`
			RoomID               string            `json:"roomId"`
			LotteryID            string            `json:"lotteryId"`
			LotteryName          string            `json:"lotteryName"`
			AuthorNickname       string            `json:"authorNickname"`
			Conditions           []pool.Condition  `json:"conditions"`
			JoinTotal            float64           `json:"joinTotal"`
			LuckyCount           float64           `json:"luckyCount"`
			OnlineTotal          float64           `json:"onlineTotal"`
			TotalAmount          float64           `json:"totalAmount"`
			PrizeType            any               `json:"prizeType"`
			PrizeInfo            map[string]any    `json:"prizeInfo"`
			PredictedProbability float64           `json:"predictedProbability"`
			PredictedJoinTotal   float64           `json:"predictedJoinTotal"`
			RemainingSec         int64             `json:"remainingSec"`
			EndTime              int64             `json:"endTime"`
			StartTime            int64             `json:"startTime"`
			JoinedAt             int64             `json:"joinedAt"`
			RewardAmount         float64           `json:"rewardAmount"`
			JoinMode             string            `json:"joinMode"`
			Reason               string            `json:"reason"`
			Extra                map[string]string `json:"extra"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &req); err != nil {
			writeBodyErr(w, err)
			return
		}
		if strings.TrimSpace(req.Event) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "event is required"})
			return
		}

		err := svc.RecordTaskFeedback(pool.TaskFeedback{
			Owner: pool.ClaimOwner{
				ClientID:  req.ClientID,
				AccountID: req.AccountID,
			},
			Event:                req.Event,
			CandidateKey:         req.CandidateKey,
			RoomID:               req.RoomID,
			LotteryID:            req.LotteryID,
			LotteryName:          req.LotteryName,
			AuthorNickname:       req.AuthorNickname,
			Conditions:           req.Conditions,
			JoinTotal:            req.JoinTotal,
			LuckyCount:           req.LuckyCount,
			OnlineTotal:          req.OnlineTotal,
			TotalAmount:          req.TotalAmount,
			PrizeType:            req.PrizeType,
			PrizeInfo:            req.PrizeInfo,
			PredictedProbability: req.PredictedProbability,
			PredictedJoinTotal:   req.PredictedJoinTotal,
			RemainingSec:         req.RemainingSec,
			EndTimeMS:            req.EndTime,
			StartTimeMS:          req.StartTime,
			JoinedAtMS:           req.JoinedAt,
			RewardAmount:         req.RewardAmount,
			JoinMode:             req.JoinMode,
			Reason:               req.Reason,
			Extra:                req.Extra,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "recorded": true})
	})

	mux.HandleFunc("/task/debug", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		baseProfile, _ := svc.Profile()
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, parseTopFilterPatch(r))
		owner := parseClaimOwnerFromQuery(r)
		leaseLimit := parsePositiveIntQuery(r.URL.Query().Get("limit"), 50)
		snapshot, pv := svc.TaskDebug(effectiveProfile, owner, leaseLimit)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"profileVersion": pv,
			"appliedFilters": effectiveProfile,
			"summary":        snapshot.Summary,
			"leases":         snapshot.Leases,
		})
	})

	mux.HandleFunc("/task/leases", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		baseProfile, _ := svc.Profile()
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, parseTopFilterPatch(r))
		owner := parseClaimOwnerFromQuery(r)
		leaseLimit := parsePositiveIntQuery(r.URL.Query().Get("limit"), 200)
		snapshot, pv := svc.TaskDebug(effectiveProfile, owner, leaseLimit)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"profileVersion": pv,
			"appliedFilters": effectiveProfile,
			"summary":        snapshot.Summary,
			"items":          snapshot.Leases,
		})
	})

	mux.HandleFunc("/learning/debug", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureLicenseAuthorized(w, r, licenseSvc) {
			return
		}

		limit := parsePositiveIntQuery(r.URL.Query().Get("limit"), 120)
		snapshot, err := svc.LearningDebug(limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "summary": snapshot.Summary, "items": snapshot.Items})
	})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// quick CORS preflight support for all paths
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		mux.ServeHTTP(w, r)
	})

	addr := sc.Host + ":" + strconv.Itoa(sc.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       65 * time.Second,
	}

	go func() {
		t := time.NewTicker(time.Duration(pc.ExpireSweepMS) * time.Millisecond)
		defer t.Stop()
		for range t.C {
			svc.SweepExpired(time.Now().UnixMilli())
		}
	}()

	go func() {
		t := time.NewTicker(time.Duration(pc.TopRefreshMS) * time.Millisecond)
		defer t.Stop()
		for range t.C {
			svc.RefreshTop(false)
		}
	}()

	log.Printf("[pool-server-go] listening on http://%s pid=%d go=%s cpu=%d", addr, os.Getpid(), runtime.Version(), runtime.NumCPU())
	log.Printf("[pool-server-go] config=%+v", pc)
	log.Printf("[pool-server-go] configFile=%s loaded=%v", configFilePath, hasFileCfg)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen failed: %v", err)
	}
}
