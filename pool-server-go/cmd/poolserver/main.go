package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"dy_fudai/pool-server-go/internal/pool"
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
	Pool struct {
		TopCacheMax   int   `json:"topCacheMax"`
		TTLGraceSec   int64 `json:"ttlGraceSec"`
		MaxBatchSize  int   `json:"maxBatchSize"`
		TopRefreshMS  int64 `json:"topRefreshMS"`
		ExpireSweepMS int64 `json:"expireSweepMS"`
		Shards        int   `json:"shards"`
	} `json:"pool"`
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
		"pool-server-go/config.json",
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return "config.json"
}

// writeJSON 方法：写入JSON数据。
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "content-type")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
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
	dec := json.NewDecoder(strings.NewReader(string(body)))
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
	}
	pc.TopCacheMax = getenvInt("POOL_SERVER_TOP_CACHE_MAX", pc.TopCacheMax)
	pc.TTLGraceSec = getenvInt64("POOL_SERVER_TTL_GRACE_SEC", pc.TTLGraceSec)
	pc.MaxBatchSize = getenvInt("POOL_SERVER_MAX_BATCH_SIZE", pc.MaxBatchSize)
	pc.TopRefreshMS = getenvInt64("POOL_SERVER_TOP_CACHE_REFRESH_MS", pc.TopRefreshMS)
	pc.ExpireSweepMS = getenvInt64("POOL_SERVER_EXPIRE_SWEEP_MS", pc.ExpireSweepMS)
	pc.MinHeapShards = getenvInt("POOL_SERVER_SHARDS", pc.MinHeapShards)

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

	mux.HandleFunc("/filter/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, http.StatusNoContent, map[string]any{})
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

		var req struct {
			SourceID   string           `json:"sourceId"`
			Candidates []map[string]any `json:"candidates"`
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
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":               true,
			"received":         res.Received,
			"accepted":         res.Accepted,
			"inserted":         res.Inserted,
			"updated":          res.Updated,
			"ignoredExpired":   res.IgnoredExpired,
			"ignoredOlder":     res.IgnoredOlder,
			"invalid":          res.Invalid,
			"activeCandidates": res.ActiveCandidates,
			"profileVersion":   res.ProfileVersion,
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
		limit := 50
		if s := r.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 {
				limit = n
			}
		}
		baseProfile, _ := svc.Profile()
		filterPatch := parseTopFilterPatch(r)
		effectiveProfile := pool.ApplyProfilePatch(baseProfile, filterPatch)

		var (
			items []pool.ScoredCandidate
			meta  pool.TopMeta
			pv    int64
		)
		if len(filterPatch) > 0 {
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
