package pool

import (
	"container/heap"
	"context"
	"encoding/json"
	"errors"
	"sort"
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
		cfg:  cfg,
		rcfg: rcfg,
		rdb:  client,
		profile: DefaultFilterProfile(),
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

func (s *RedisService) Profile() (FilterProfile, int64) {
	s.profileMu.RLock()
	defer s.profileMu.RUnlock()
	return s.profile, s.profileVersion
}

func (s *RedisService) UpdateProfile(patch map[string]any) (FilterProfile, int64) {
	s.profileMu.Lock()
	p := s.profile

	if v, ok := patch["requireType3And6"]; ok {
		p.RequireType3And6 = asBool(v, p.RequireType3And6)
	}
	if v, ok := patch["filterFanClub"]; ok {
		p.FilterFanClub = asBool(v, p.FilterFanClub)
	}
	if v, ok := patch["onlyPhysicalPrize"]; ok {
		p.OnlyPhysicalPrize = asBool(v, p.OnlyPhysicalPrize)
	}
	if v, ok := patch["preferBigRedPacket"]; ok {
		p.PreferBigRedPacket = asBool(v, p.PreferBigRedPacket)
	}
	if v, ok := patch["bigRedPacketThreshold"]; ok {
		p.BigRedPacketThreshold = maxFloat(1, asFloat(v, p.BigRedPacketThreshold))
	}
	if v, ok := patch["minRemainingSec"]; ok {
		p.MinRemainingSec = int64(maxFloat(0, asFloat(v, float64(p.MinRemainingSec))))
	}
	if v, ok := patch["maxRemainingSec"]; ok {
		p.MaxRemainingSec = int64(maxFloat(float64(p.MinRemainingSec), asFloat(v, float64(p.MaxRemainingSec))))
	}
	if v, ok := patch["minProbability"]; ok {
		x := asFloat(v, p.MinProbability)
		if x < 0 {
			x = 0
		}
		if x > 1 {
			x = 1
		}
		p.MinProbability = x
	}

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

func (s *RedisService) SweepExpired(nowMS int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	max := strconv.FormatInt(nowMS, 10)
	for {
		keys, err := s.rdb.ZRangeByScore(ctx, s.keyExpire(), &redis.ZRangeBy{
			Min: "-inf",
			Max: max,
			Offset: 0,
			Count: 1024,
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

	h := &scoreMinHeap{}
	heap.Init(h)
	validCount := 0
	for i := range all {
		c := all[i]
		if c.ExpireAtMS > 0 && c.ExpireAtMS <= now {
			continue
		}
		ok, _ := passFilter(c, profile, now)
		if !ok {
			continue
		}
		validCount++
		sc := scoreCandidate(c, profile, now)
		if h.Len() < s.cfg.TopCacheMax {
			heap.Push(h, sc)
			continue
		}
		if (*h)[0].Score < sc.Score {
			heap.Pop(h)
			heap.Push(h, sc)
		}
	}
	out := make([]ScoredCandidate, 0, h.Len())
	for h.Len() > 0 {
		out = append(out, heap.Pop(h).(ScoredCandidate))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].EndTime < out[j].EndTime
		}
		return out[i].Score > out[j].Score
	})

	s.topMu.Lock()
	s.topCache = out
	s.topMeta = TopMeta{
		BuiltAtMS: now,
		ActiveCount: len(all),
		ValidCount: validCount,
	}
	s.topMu.Unlock()
	s.dirty.Store(false)
}

func (s *RedisService) Top(limit int) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
	if limit <= 0 {
		limit = 50
	}
	maxLimit := s.cfg.TopCacheMax
	if maxLimit <= 0 {
		maxLimit = 2500
	}
	if limit > maxLimit {
		limit = maxLimit
	}
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

func (s *RedisService) Close() error {
	if s.rdb != nil {
		return s.rdb.Close()
	}
	return nil
}

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

func (s *RedisService) saveProfileToRedis(ctx context.Context, p FilterProfile, version int64) error {
	payload := redisProfilePayload{
		Profile: p,
		Version: version,
		UpdatedAt: time.Now().UnixMilli(),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, s.keyProfile(), string(b), 0).Err()
}

func (s *RedisService) keyCandidates() string {
	return s.rcfg.Prefix + ":candidates"
}
func (s *RedisService) keyExpire() string {
	return s.rcfg.Prefix + ":expire"
}
func (s *RedisService) keyProfile() string {
	return s.rcfg.Prefix + ":profile"
}

func stringsTrim(v string) string {
	return strings.TrimSpace(v)
}
