package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
)

type serverConfig struct {
	Host         string
	Port         int
	MaxBodyBytes int64
}

type fileConfig struct {
	Server struct {
		Host         string `json:"host"`
		Port         int    `json:"port"`
		MaxBodyBytes int64  `json:"maxBodyBytes"`
	} `json:"server"`
	License struct {
		Enabled              bool   `json:"enabled"`
		Unrestricted         bool   `json:"unrestricted"`
		AdminToken           string `json:"adminToken"`
		AdminUsername        string `json:"adminUsername"`
		AdminPassword        string `json:"adminPassword"`
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
}

type adminSessionClaims struct {
	Username   string `json:"username"`
	IssuedAtMS int64  `json:"issuedAt"`
	ExpireAtMS int64  `json:"expireAt"`
}

//go:embed web/admin.html
var adminHTML []byte

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

func getenvStr(name, fallback string) string {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	return v
}

func getenvBool(name string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

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
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, false, err
	}
	return cfg, true, nil
}

func resolveConfigPath() string {
	if p := strings.TrimSpace(os.Getenv("POOL_CONFIG_FILE")); p != "" {
		return p
	}
	candidates := []string{"config.json", "../../config.json"}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return "config.json"
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "content-type,x-admin-token,authorization")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func parseBody(r *http.Request, limit int64, dst any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return err
	}
	if int64(len(body)) > limit {
		return io.ErrShortBuffer
	}
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()
	return dec.Decode(dst)
}

func writeBodyErr(w http.ResponseWriter, err error) {
	if errors.Is(err, io.ErrShortBuffer) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"ok": false, "error": "request body too large"})
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid json body"})
}

func parsePositiveIntQuery(v string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func extractAdminToken(r *http.Request) string {
	bearer := ""
	auth := strings.TrimSpace(r.Header.Get("authorization"))
	if len(auth) > 7 && strings.EqualFold(auth[:7], "bearer ") {
		bearer = strings.TrimSpace(auth[7:])
	}
	return firstNonEmpty(r.Header.Get("x-admin-token"), bearer)
}

func signAdminSession(secret string, claims adminSessionClaims) (string, error) {
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	_, _ = mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))
	return payload + "." + signature, nil
}

func parseAdminSession(secret, sessionToken string) (adminSessionClaims, error) {
	token := strings.TrimSpace(sessionToken)
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return adminSessionClaims{}, fmt.Errorf("admin_session_invalid")
	}
	payload := parts[0]
	signature := parts[1]
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	_, _ = mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return adminSessionClaims{}, fmt.Errorf("admin_session_invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return adminSessionClaims{}, fmt.Errorf("admin_session_invalid")
	}
	claims := adminSessionClaims{}
	if err := json.Unmarshal(raw, &claims); err != nil {
		return adminSessionClaims{}, fmt.Errorf("admin_session_invalid")
	}
	if claims.ExpireAtMS > 0 && time.Now().UnixMilli() >= claims.ExpireAtMS {
		return adminSessionClaims{}, fmt.Errorf("admin_session_expired")
	}
	return claims, nil
}

func ensureAdminAuthorized(w http.ResponseWriter, r *http.Request, sessionSecret string) bool {
	if strings.TrimSpace(sessionSecret) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "admin_session_secret_missing"})
		return false
	}
	token := strings.TrimSpace(extractAdminToken(r))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "admin_unauthorized"})
		return false
	}
	if _, err := parseAdminSession(sessionSecret, token); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": err.Error()})
		return false
	}
	return true
}

func main() {
	configPath := resolveConfigPath()
	fileCfg, hasFileCfg, err := loadConfigFile(configPath)
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	sc := serverConfig{
		Host:         "127.0.0.1",
		Port:         9091,
		MaxBodyBytes: 2 << 20,
	}
	if hasFileCfg {
		if strings.TrimSpace(fileCfg.Server.Host) != "" {
			sc.Host = strings.TrimSpace(fileCfg.Server.Host)
		}
		if fileCfg.Server.Port > 0 {
			sc.Port = fileCfg.Server.Port + 1
		}
		if fileCfg.Server.MaxBodyBytes > 0 {
			sc.MaxBodyBytes = fileCfg.Server.MaxBodyBytes
		}
	}
	sc.Host = strings.TrimSpace(getenvStr("POOL_ADMIN_HOST", sc.Host))
	sc.Port = getenvInt("POOL_ADMIN_PORT", sc.Port)
	sc.MaxBodyBytes = getenvInt64("POOL_ADMIN_MAX_BODY_BYTES", sc.MaxBodyBytes)
	if sc.Port <= 0 {
		sc.Port = 9091
	}
	if sc.MaxBodyBytes <= 0 {
		sc.MaxBodyBytes = 2 << 20
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
	adminUsername := ""
	adminPassword := ""
	if hasFileCfg {
		lc.Enabled = fileCfg.License.Enabled
		lc.DefaultUnrestricted = fileCfg.License.Unrestricted
		adminToken = strings.TrimSpace(fileCfg.License.AdminToken)
		adminUsername = strings.TrimSpace(fileCfg.License.AdminUsername)
		adminPassword = strings.TrimSpace(fileCfg.License.AdminPassword)
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
	adminUsername = strings.TrimSpace(getenvStr("POOL_LICENSE_ADMIN_USERNAME", getenvStr("LICENSE_ADMIN_USERNAME", adminUsername)))
	adminPassword = strings.TrimSpace(getenvStr("POOL_LICENSE_ADMIN_PASSWORD", getenvStr("LICENSE_ADMIN_PASSWORD", adminPassword)))
	if adminUsername == "" {
		log.Fatalf("admin username missing (set POOL_LICENSE_ADMIN_USERNAME)")
	}
	if adminPassword == "" {
		log.Fatalf("admin password missing (set POOL_LICENSE_ADMIN_PASSWORD)")
	}

	sessionSecret := strings.TrimSpace(getenvStr("POOL_ADMIN_SESSION_SECRET", adminToken))
	sessionHours := getenvInt("POOL_ADMIN_SESSION_TTL_HOURS", 12)
	if sessionHours <= 0 {
		sessionHours = 12
	}
	sessionTTL := time.Duration(sessionHours) * time.Hour

	if strings.TrimSpace(sessionSecret) == "" {
		log.Fatalf("admin session secret missing (set POOL_ADMIN_SESSION_SECRET or POOL_LICENSE_ADMIN_TOKEN)")
	}

	licenseSvc, licenseErr := licensepkg.NewService(lc)
	if licenseErr != nil {
		log.Printf("[license-admin] license init warning: %v", licenseErr)
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
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"pid":       os.Getpid(),
			"goVersion": runtime.Version(),
			"now":       time.Now().UnixMilli(),
		})
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not_found"})
			return
		}
		http.Redirect(w, r, "/admin", http.StatusTemporaryRedirect)
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
		_, _ = w.Write(adminHTML)
	})

	mux.HandleFunc("/admin/api/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := parseBody(r, sc.MaxBodyBytes, &payload); err != nil {
			writeBodyErr(w, err)
			return
		}
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(payload.Username)), []byte(strings.TrimSpace(adminUsername))) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "invalid_credentials"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(payload.Password)), []byte(strings.TrimSpace(adminPassword))) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "invalid_credentials"})
			return
		}
		now := time.Now()
		expireAt := now.Add(sessionTTL)
		username := strings.TrimSpace(adminUsername)
		token, err := signAdminSession(sessionSecret, adminSessionClaims{
			Username:   username,
			IssuedAtMS: now.UnixMilli(),
			ExpireAtMS: expireAt.UnixMilli(),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "admin_session_issue_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"token":    token,
			"expireAt": expireAt.UnixMilli(),
			"username": username,
		})
	})

	mux.HandleFunc("/admin/api/license-settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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

	mux.HandleFunc("/admin/api/licenses", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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

	mux.HandleFunc("/admin/api/runtime-clients", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		if !ensureAdminAuthorized(w, r, sessionSecret) {
			return
		}
		if licenseSvc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "license_service_unavailable"})
			return
		}
		page := parsePositiveIntQuery(r.URL.Query().Get("page"), 1)
		pageSize := parsePositiveIntQuery(r.URL.Query().Get("pageSize"), 100)
		result, err := licenseSvc.ListAdminRuntimeClients(r.Context(), page, pageSize)
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
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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
		if !ensureAdminAuthorized(w, r, sessionSecret) {
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

	addr := fmt.Sprintf("%s:%d", sc.Host, sc.Port)
	log.Printf("[license-admin] config=%s", filepath.Clean(configPath))
	log.Printf("[license-admin] listen=%s", addr)
	log.Printf("[license-admin] legacy token exposure disabled, using signed admin sessions")

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}
