package pool

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisConfig struct {
	Addr           string
	Password       string
	DB             int
	Prefix         string
	PoolSize       int
	MinIdleConns   int
	DialTimeoutMS  int64
	ReadTimeoutMS  int64
	WriteTimeoutMS int64
}

// DefaultRedisConfig 方法：返回默认Redis配置。
func DefaultRedisConfig() RedisConfig {
	return RedisConfig{
		Addr:           "127.0.0.1:6379",
		Password:       "",
		DB:             0,
		Prefix:         "lottery_pool",
		PoolSize:       120,
		MinIdleConns:   16,
		DialTimeoutMS:  2000,
		ReadTimeoutMS:  3000,
		WriteTimeoutMS: 3000,
	}
}

type redisProfilePayload struct {
	Profile   FilterProfile `json:"profile"`
	Version   int64         `json:"version"`
	UpdatedAt int64         `json:"updatedAt"`
}

type RedisService struct {
	cfg  Config
	rcfg RedisConfig
	rdb  *redis.Client

	profileMu      sync.RWMutex
	profile        FilterProfile
	profileVersion int64

	seq   atomic.Int64
	dirty atomic.Bool

	topMu    sync.RWMutex
	topCache []ScoredCandidate
	topMeta  TopMeta

	stats   Stats
	statsMu sync.Mutex

	upsertScript *redis.Script
}

// NewRedisService 方法：创建Redis服务。
func NewRedisService(cfg Config, rcfg RedisConfig) (*RedisService, error) {
	if stringsTrim(rcfg.Addr) == "" {
		return nil, errors.New("redis addr is empty")
	}
	if stringsTrim(rcfg.Prefix) == "" {
		rcfg.Prefix = "lottery_pool"
	}
	if rcfg.PoolSize <= 0 {
		rcfg.PoolSize = 120
	}
	if rcfg.MinIdleConns < 0 {
		rcfg.MinIdleConns = 0
	}
	if rcfg.DialTimeoutMS <= 0 {
		rcfg.DialTimeoutMS = 2000
	}
	if rcfg.ReadTimeoutMS <= 0 {
		rcfg.ReadTimeoutMS = 3000
	}
	if rcfg.WriteTimeoutMS <= 0 {
		rcfg.WriteTimeoutMS = 3000
	}

	client := redis.NewClient(&redis.Options{
		Addr:         rcfg.Addr,
		Password:     rcfg.Password,
		DB:           rcfg.DB,
		PoolSize:     rcfg.PoolSize,
		MinIdleConns: rcfg.MinIdleConns,
		DialTimeout:  time.Duration(rcfg.DialTimeoutMS) * time.Millisecond,
		ReadTimeout:  time.Duration(rcfg.ReadTimeoutMS) * time.Millisecond,
		WriteTimeout: time.Duration(rcfg.WriteTimeoutMS) * time.Millisecond,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	s := &RedisService{
		cfg:            cfg,
		rcfg:           rcfg,
		rdb:            client,
		profile:        DefaultFilterProfile(),
		profileVersion: 1,
		upsertScript: redis.NewScript(`
local hkey = KEYS[1]
local zkey = KEYS[2]
local field = ARGV[1]
local fetched = tonumber(ARGV[2])
local expire = tonumber(ARGV[3])
local payload = ARGV[4]
local prev = redis.call('HGET', hkey, field)
if prev then
  local ok, obj = pcall(cjson.decode, prev)
  if ok and obj and obj.fetchedAtMs and tonumber(obj.fetchedAtMs) > fetched then
    return 0
  end
  redis.call('HSET', hkey, field, payload)
  redis.call('ZADD', zkey, expire, field)
  return 2
end
redis.call('HSET', hkey, field, payload)
redis.call('ZADD', zkey, expire, field)
return 1
`),
	}
	s.dirty.Store(true)

	_ = s.syncProfileFromRedis(ctx)
	return s, nil
}

// Profile 方法：处理策略。
func (s *RedisService) Profile() (FilterProfile, int64) {
	s.profileMu.RLock()
	defer s.profileMu.RUnlock()
	return s.profile, s.profileVersion
}

// UpdateProfile 方法：更新策略。
func (s *RedisService) UpdateProfile(patch map[string]any) (FilterProfile, int64) {
	s.profileMu.Lock()
	p := applyProfilePatch(s.profile, patch)

	s.profile = p
	s.profileVersion++
	version := s.profileVersion
	s.profileMu.Unlock()
	s.dirty.Store(true)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.saveProfileToRedis(ctx, p, version)
	return p, version
}

// UpsertBatch 方法：批量写入候选福袋数据，并返回新增/更新统计。
func (s *RedisService) UpsertBatch(sourceID string, raws []map[string]any) BatchResult {
	received := len(raws)
	if received > s.cfg.MaxBatchSize {
		raws = raws[:s.cfg.MaxBatchSize]
		received = len(raws)
	}
	now := time.Now().UnixMilli()
	result := BatchResult{Received: received}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)

	for _, raw := range raws {
		c, err := normalizeCandidate(raw, sourceID, now)
		if err != nil {
			result.Invalid++
			continue
		}
		result.Accepted++
		status := s.upsertOne(ctx, c, now)
		switch status {
		case "inserted":
			result.Inserted++
		case "updated":
			result.Updated++
		case "expired":
			result.IgnoredExpired++
		case "older":
			result.IgnoredOlder++
		default:
			result.Invalid++
		}
	}

	activeCount, err := s.rdb.HLen(ctx, s.keyCandidates()).Result()
	if err == nil {
		result.ActiveCandidates = int(activeCount)
	}
	_, pv := s.Profile()
	result.ProfileVersion = pv

	s.statsMu.Lock()
	s.stats.TotalBatches++
	s.stats.TotalReceived += int64(result.Received)
	s.stats.TotalAccepted += int64(result.Accepted)
	s.stats.TotalInserted += int64(result.Inserted)
	s.stats.TotalUpdated += int64(result.Updated)
	s.stats.TotalIgnoredExpired += int64(result.IgnoredExpired)
	s.stats.TotalIgnoredOlder += int64(result.IgnoredOlder)
	s.stats.TotalInvalid += int64(result.Invalid)
	s.statsMu.Unlock()

	return result
}

// upsertOne 方法：写入单条候选福袋并维护过期与索引状态。
func (s *RedisService) upsertOne(ctx context.Context, c Candidate, nowMS int64) string {
	expireAt := c.EndTimeMS + s.cfg.TTLGraceSec*1000
	if expireAt <= nowMS {
		return "expired"
	}
	c.ExpireAtMS = expireAt
	c.Version = s.seq.Add(1)
	payload, err := json.Marshal(c)
	if err != nil {
		return "invalid"
	}
	r, err := s.upsertScript.Run(ctx, s.rdb, []string{s.keyCandidates(), s.keyExpire()}, c.Key, c.FetchedAtMS, expireAt, string(payload)).Int()
	if err != nil {
		return "invalid"
	}
	if r == 0 {
		return "older"
	}
	s.dirty.Store(true)
	if r == 2 {
		return "updated"
	}
	return "inserted"
}

// SweepExpired 方法：清理已过期候选福袋并同步索引。
func (s *RedisService) SweepExpired(nowMS int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	max := strconv.FormatInt(nowMS, 10)
	for {
		keys, err := s.rdb.ZRangeByScore(ctx, s.keyExpire(), &redis.ZRangeBy{
			Min:    "-inf",
			Max:    max,
			Offset: 0,
			Count:  1024,
		}).Result()
		if err != nil || len(keys) == 0 {
			return
		}
		pipe := s.rdb.Pipeline()
		fields := make([]string, 0, len(keys))
		fields = append(fields, keys...)
		members := make([]any, 0, len(fields))
		for _, f := range fields {
			members = append(members, f)
		}
		pipe.HDel(ctx, s.keyCandidates(), fields...)
		pipe.ZRem(ctx, s.keyExpire(), members...)
		_, _ = pipe.Exec(ctx)
		s.dirty.Store(true)
	}
}

// RefreshTop 方法：刷新优选结果。
func (s *RedisService) RefreshTop(force bool) {
	now := time.Now().UnixMilli()
	if !force && !s.dirty.Load() && now-s.topMeta.BuiltAtMS < s.cfg.TopRefreshMS {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)
	s.SweepExpired(now)

	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		return
	}
	profile, _ := s.Profile()
	capSize := s.cfg.TopCacheMax
	if capSize <= 0 {
		capSize = 2500
	}
	out, validCount := selectTopCandidates(all, profile, now, capSize)

	s.topMu.Lock()
	s.topCache = out
	s.topMeta = TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}
	s.topMu.Unlock()
	s.dirty.Store(false)
}

// Top 方法：处理优选结果。
func (s *RedisService) Top(limit int) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
	limit = normalizeTopLimit(limit, s.cfg.TopCacheMax)
	s.RefreshTop(true)
	s.topMu.RLock()
	defer s.topMu.RUnlock()
	if limit > len(s.topCache) {
		limit = len(s.topCache)
	}
	out := make([]ScoredCandidate, limit)
	copy(out, s.topCache[:limit])
	_, pv := s.Profile()
	return out, s.topMeta, pv
}

// TopWithProfile 方法：处理优选结果策略。
func (s *RedisService) TopWithProfile(limit int, profile FilterProfile) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
	limit = normalizeTopLimit(limit, s.cfg.TopCacheMax)
	now := time.Now().UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)
	s.SweepExpired(now)

	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		_, pv := s.Profile()
		return []ScoredCandidate{}, TopMeta{BuiltAtMS: now}, pv
	}
	out, validCount := selectTopCandidates(all, profile, now, limit)
	_, pv := s.Profile()
	return out, TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}, pv
}

// Stats 方法：处理统计。
func (s *RedisService) Stats() (Stats, TopMeta, int64) {
	s.statsMu.Lock()
	st := s.stats
	s.statsMu.Unlock()
	s.topMu.RLock()
	meta := s.topMeta
	s.topMu.RUnlock()
	_, pv := s.Profile()
	return st, meta, pv
}

// Close 方法：关闭服务资源并停止后台任务。
func (s *RedisService) Close() error {
	if s.rdb != nil {
		return s.rdb.Close()
	}
	return nil
}

// fetchAllCandidates 方法：请求并获取候选项列表。
func (s *RedisService) fetchAllCandidates(ctx context.Context) ([]Candidate, error) {
	values, err := s.rdb.HGetAll(ctx, s.keyCandidates()).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Candidate, 0, len(values))
	for _, raw := range values {
		var c Candidate
		if err := json.Unmarshal([]byte(raw), &c); err != nil {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

// syncProfileFromRedis 方法：同步策略Redis。
func (s *RedisService) syncProfileFromRedis(ctx context.Context) error {
	val, err := s.rdb.Get(ctx, s.keyProfile()).Result()
	if err == redis.Nil {
		p, v := s.Profile()
		return s.saveProfileToRedis(ctx, p, v)
	}
	if err != nil {
		return err
	}
	var payload redisProfilePayload
	if err := json.Unmarshal([]byte(val), &payload); err != nil {
		return err
	}
	s.profileMu.Lock()
	if payload.Version > s.profileVersion {
		s.profile = payload.Profile
		s.profileVersion = payload.Version
		s.dirty.Store(true)
	}
	s.profileMu.Unlock()
	return nil
}

// saveProfileToRedis 方法：保存策略Redis。
func (s *RedisService) saveProfileToRedis(ctx context.Context, p FilterProfile, version int64) error {
	payload := redisProfilePayload{
		Profile:   p,
		Version:   version,
		UpdatedAt: time.Now().UnixMilli(),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, s.keyProfile(), string(b), 0).Err()
}

// keyCandidates 方法：处理键候选项列表。
func (s *RedisService) keyCandidates() string {
	return s.rcfg.Prefix + ":candidates"
}

// keyExpire 方法：处理键。
func (s *RedisService) keyExpire() string {
	return s.rcfg.Prefix + ":expire"
}

// keyProfile 方法：处理键策略。
func (s *RedisService) keyProfile() string {
	return s.rcfg.Prefix + ":profile"
}

// stringsTrim 方法：处理字符串集合首尾空白。
func stringsTrim(v string) string {
	return strings.TrimSpace(v)
}
