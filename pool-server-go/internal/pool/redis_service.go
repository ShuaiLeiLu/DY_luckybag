package pool

import (
	"context"
	"encoding/json"
	"errors"
	"math"
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

	upsertScript        *redis.Script
	claimScript         *redis.Script
	renewScript         *redis.Script
	releaseScript       *redis.Script
	finishScript        *redis.Script
	feedbackScript      *redis.Script
	permitScript        *redis.Script
	allScanClaimScript  *redis.Script
	allScanReportScript *redis.Script
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
		claimScript: redis.NewScript(`
local candidateLeaseCountKey = KEYS[1]
local candidateJoinedCountKey = KEYS[2]
local ownerCandidateLeaseKey = KEYS[3]
local leasesKey = KEYS[4]
local leaseExpireKey = KEYS[5]
local candidateKey = ARGV[1]
local leaseID = ARGV[2]
local nowMS = tonumber(ARGV[3])
local expireAtMS = tonumber(ARGV[4])
local maxSlots = tonumber(ARGV[5])
local payload = ARGV[6]
local ownerCandidateKey = ARGV[7]
local currentCount = tonumber(redis.call('HGET', candidateLeaseCountKey, candidateKey) or '0')
local joinedCount = tonumber(redis.call('HGET', candidateJoinedCountKey, candidateKey) or '0')
if currentCount + joinedCount >= maxSlots then
  return 0
end
if ownerCandidateKey ~= '' then
  local existingLeaseID = tostring(redis.call('HGET', ownerCandidateLeaseKey, ownerCandidateKey) or '')
  if existingLeaseID ~= '' then
    local existingRaw = redis.call('HGET', leasesKey, existingLeaseID)
    if existingRaw then
      return -1
    end
    redis.call('HDEL', ownerCandidateLeaseKey, ownerCandidateKey)
  end
end
redis.call('HSET', leasesKey, leaseID, payload)
redis.call('HINCRBY', candidateLeaseCountKey, candidateKey, 1)
if ownerCandidateKey ~= '' then
  redis.call('HSET', ownerCandidateLeaseKey, ownerCandidateKey, leaseID)
end
redis.call('ZADD', leaseExpireKey, expireAtMS, leaseID)
return 1
`),
		renewScript: redis.NewScript(`
local leasesKey = KEYS[1]
local leaseExpireKey = KEYS[2]
local candidateLeaseCountKey = KEYS[3]
local ownerCandidateLeaseKey = KEYS[4]
local leaseID = ARGV[1]
local clientID = ARGV[2]
local accountID = ARGV[3]
local nowMS = tonumber(ARGV[4])
local expireAtMS = tonumber(ARGV[5])
local raw = redis.call('HGET', leasesKey, leaseID)
if not raw then
  return ''
end
local ok, obj = pcall(cjson.decode, raw)
if not ok or not obj then
  return ''
end
if tostring(obj.clientId or '') ~= clientID or tostring(obj.accountId or '') ~= accountID then
  return ''
end
if tonumber(obj.expiresAt or 0) <= nowMS then
  redis.call('HDEL', leasesKey, leaseID)
  if obj.candidateKey then
    local nextCount = tonumber(redis.call('HINCRBY', candidateLeaseCountKey, obj.candidateKey, -1))
    if nextCount <= 0 then
      redis.call('HDEL', candidateLeaseCountKey, obj.candidateKey)
    end
    local ownerCandidateKey = tostring(obj.clientId or '') .. '|' .. tostring(obj.accountId or '') .. '|' .. tostring(obj.candidateKey or '')
    redis.call('HDEL', ownerCandidateLeaseKey, ownerCandidateKey)
  end
  redis.call('ZREM', leaseExpireKey, leaseID)
  return ''
end
obj.updatedAt = nowMS
obj.expiresAt = expireAtMS
local payload = cjson.encode(obj)
redis.call('HSET', leasesKey, leaseID, payload)
redis.call('ZADD', leaseExpireKey, expireAtMS, leaseID)
return payload
`),
		releaseScript: redis.NewScript(`
local leasesKey = KEYS[1]
local leaseExpireKey = KEYS[2]
local candidateLeaseCountKey = KEYS[3]
local ownerCandidateLeaseKey = KEYS[4]
local leaseID = ARGV[1]
local clientID = ARGV[2]
local accountID = ARGV[3]
local raw = redis.call('HGET', leasesKey, leaseID)
if not raw then
  return 0
end
local ok, obj = pcall(cjson.decode, raw)
if not ok or not obj then
  return 0
end
if tostring(obj.clientId or '') ~= clientID or tostring(obj.accountId or '') ~= accountID then
  return 0
end
redis.call('HDEL', leasesKey, leaseID)
if obj.candidateKey then
  local nextCount = tonumber(redis.call('HINCRBY', candidateLeaseCountKey, obj.candidateKey, -1))
  if nextCount <= 0 then
    redis.call('HDEL', candidateLeaseCountKey, obj.candidateKey)
  end
  local ownerCandidateKey = tostring(obj.clientId or '') .. '|' .. tostring(obj.accountId or '') .. '|' .. tostring(obj.candidateKey or '')
  redis.call('HDEL', ownerCandidateLeaseKey, ownerCandidateKey)
end
redis.call('ZREM', leaseExpireKey, leaseID)
return 1
`),
		finishScript: redis.NewScript(`
local leasesKey = KEYS[1]
local leaseExpireKey = KEYS[2]
local candidateLeaseCountKey = KEYS[3]
local candidateJoinedCountKey = KEYS[4]
local ownerCandidateLeaseKey = KEYS[5]
local candidatesKey = KEYS[6]
local candidateExpireKey = KEYS[7]
local leaseID = ARGV[1]
local clientID = ARGV[2]
local accountID = ARGV[3]
local removeCandidate = ARGV[4]
local result = ARGV[5]
local raw = redis.call('HGET', leasesKey, leaseID)
if not raw then
  return 0
end
local ok, obj = pcall(cjson.decode, raw)
if not ok or not obj then
  return 0
end
if tostring(obj.clientId or '') ~= clientID or tostring(obj.accountId or '') ~= accountID then
  return 0
end
redis.call('HDEL', leasesKey, leaseID)
if obj.candidateKey then
  local nextCount = tonumber(redis.call('HINCRBY', candidateLeaseCountKey, obj.candidateKey, -1))
  if nextCount <= 0 then
    redis.call('HDEL', candidateLeaseCountKey, obj.candidateKey)
  end
  local ownerCandidateKey = tostring(obj.clientId or '') .. '|' .. tostring(obj.accountId or '') .. '|' .. tostring(obj.candidateKey or '')
  redis.call('HDEL', ownerCandidateLeaseKey, ownerCandidateKey)
  local joinedCount = tonumber(redis.call('HGET', candidateJoinedCountKey, obj.candidateKey) or '0')
  if result == 'join_success' then
    joinedCount = tonumber(redis.call('HINCRBY', candidateJoinedCountKey, obj.candidateKey, 1))
  end
  local slotLimit = tonumber(obj.slotLimit or '1')
  if removeCandidate == '1' and (slotLimit <= 1 or joinedCount >= slotLimit) then
    redis.call('HDEL', candidatesKey, obj.candidateKey)
    redis.call('ZREM', candidateExpireKey, obj.candidateKey)
    redis.call('HDEL', candidateLeaseCountKey, obj.candidateKey)
    redis.call('HDEL', candidateJoinedCountKey, obj.candidateKey)
  end
end
redis.call('ZREM', leaseExpireKey, leaseID)
return 1
`),
		feedbackScript: redis.NewScript(`
local learningKey = KEYS[1]
local bucketKey = ARGV[1]
local prizeClass = ARGV[2]
local remainBucket = ARGV[3]
local probBucket = ARGV[4]
local onlineBucket = ARGV[5]
local crowdBucket = ARGV[6]
local event = ARGV[7]
local predictedProbability = tonumber(ARGV[8] or '0')
local rewardAmount = tonumber(ARGV[9] or '0')
local nowMS = tonumber(ARGV[10] or '0')

local raw = redis.call('HGET', learningKey, bucketKey)
local obj = nil
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and decoded then
    obj = decoded
  end
end
if not obj then
  obj = {
    key = bucketKey,
    prizeClass = prizeClass,
    remainBucket = remainBucket,
    probBucket = probBucket,
    onlineBucket = onlineBucket,
    crowdBucket = crowdBucket,
    feedbackCount = 0,
    joinSuccess = 0,
    joinFailed = 0,
    drawWon = 0,
    drawLost = 0,
    expectedWins = 0,
    actualWins = 0,
    rewardSum = 0,
    updatedAt = nowMS
  }
end

obj.feedbackCount = tonumber(obj.feedbackCount or 0) + 1
obj.updatedAt = nowMS
if event == 'join_success' then
  obj.joinSuccess = tonumber(obj.joinSuccess or 0) + 1
elseif event == 'join_failed' then
  obj.joinFailed = tonumber(obj.joinFailed or 0) + 1
elseif event == 'draw_won' then
  obj.drawWon = tonumber(obj.drawWon or 0) + 1
  obj.expectedWins = tonumber(obj.expectedWins or 0) + predictedProbability
  obj.actualWins = tonumber(obj.actualWins or 0) + 1
  obj.rewardSum = tonumber(obj.rewardSum or 0) + rewardAmount
elseif event == 'draw_lost' then
  obj.drawLost = tonumber(obj.drawLost or 0) + 1
  obj.expectedWins = tonumber(obj.expectedWins or 0) + predictedProbability
end

redis.call('HSET', learningKey, bucketKey, cjson.encode(obj))
return 1
`),
		permitScript: redis.NewScript(`
local bucketKey = KEYS[1]
local nowMS = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local refillPerSec = tonumber(ARGV[3])
local burst = tonumber(ARGV[4])
local ttlMS = tonumber(ARGV[5])
local kind = tostring(ARGV[6] or '')
local clusterRiskLevel = tonumber(ARGV[7] or '0')
local clusterRiskScore = tonumber(ARGV[8] or '0')
local tokens = tonumber(redis.call('HGET', bucketKey, 'tokens') or tostring(burst))
local updatedAtMS = tonumber(redis.call('HGET', bucketKey, 'updatedAtMs') or tostring(nowMS))
if updatedAtMS > nowMS then
  updatedAtMS = nowMS
end
local elapsedSec = math.max(0, nowMS - updatedAtMS) / 1000.0
tokens = math.min(burst, tokens + elapsedSec * refillPerSec)
local allowed = 0
local retryAfterMS = 0
if tokens >= cost then
  allowed = 1
  tokens = tokens - cost
elseif refillPerSec > 0 then
  retryAfterMS = math.ceil(((cost - tokens) / refillPerSec) * 1000)
  if retryAfterMS < 400 then
    retryAfterMS = 400
  end
else
  retryAfterMS = 2000
end
redis.call('HSET', bucketKey, 'tokens', tokens, 'updatedAtMs', nowMS)
redis.call('PEXPIRE', bucketKey, math.max(ttlMS, 60000))
return cjson.encode({
  allowed = allowed == 1,
  kind = kind,
  cost = cost,
  retryAfterMs = retryAfterMS,
  tokensLeft = tokens,
  burst = burst,
  refillPerSec = refillPerSec,
  clusterRiskLevel = clusterRiskLevel,
  clusterRiskScore = clusterRiskScore,
  generatedAt = nowMS,
  reason = allowed == 1 and 'granted' or 'rate_limited'
})
`),
		allScanClaimScript: redis.NewScript(`
local stateKey = KEYS[1]
local nowMS = tonumber(ARGV[1])
local leaseTTLMS = tonumber(ARGV[2])
local clientID = tostring(ARGV[3] or '')
local accountID = tostring(ARGV[4] or '')
local restartCooldownMS = tonumber(ARGV[5])
local raw = redis.call('GET', stateKey)
local state = nil
if raw and raw ~= '' then
  local ok, obj = pcall(cjson.decode, raw)
  if ok and obj then
    state = obj
  end
end
if not state then
  state = {
    nextCursorMaxTime = 0,
    depth = 0,
    cycle = 1,
    exhausted = false,
    lastAdvancedAtMS = nowMS,
    lastIssuedAtMS = 0
  }
end
local lease = state.lease or {}
local leaseExpiresAtMS = tonumber(lease.expiresAtMS or '0') or 0
if leaseExpiresAtMS > nowMS then
  if tostring(lease.clientId or '') == clientID and tostring(lease.accountId or '') == accountID then
    return cjson.encode({
      claimed = true,
      slotId = tostring(lease.slotId or ''),
      cursorMaxTime = tonumber(lease.cursorMaxTime or '0') or 0,
      depth = tonumber(lease.depth or '0') or 0,
      cycle = tonumber(state.cycle or '1') or 1,
      retryAfterMs = 0,
      leaseTtlMs = math.max(leaseExpiresAtMS - nowMS, 0),
      fromHead = (tonumber(lease.cursorMaxTime or '0') or 0) <= 0 and (tonumber(lease.depth or '0') or 0) == 0,
      generatedAt = nowMS,
      reason = 'already_claimed'
    })
  end
  return cjson.encode({
    claimed = false,
    retryAfterMs = math.max(leaseExpiresAtMS - nowMS, 400),
    generatedAt = nowMS,
    reason = 'leased'
  })
end
local exhausted = state.exhausted == true or state.exhausted == 1
local lastAdvancedAtMS = tonumber(state.lastAdvancedAtMS or '0') or 0
if exhausted and (lastAdvancedAtMS + restartCooldownMS) > nowMS then
  return cjson.encode({
    claimed = false,
    retryAfterMs = math.max(lastAdvancedAtMS + restartCooldownMS - nowMS, 400),
    generatedAt = nowMS,
    reason = 'exhausted_cooldown'
  })
end
if exhausted then
  state.nextCursorMaxTime = 0
  state.depth = 0
  state.cycle = (tonumber(state.cycle or '0') or 0) + 1
  state.exhausted = false
end
local cursorMaxTime = tonumber(state.nextCursorMaxTime or '0') or 0
local depth = tonumber(state.depth or '0') or 0
local cycle = tonumber(state.cycle or '1') or 1
local slotId = 'all-' .. tostring(cycle) .. '-' .. tostring(nowMS)
state.lastIssuedAtMS = nowMS
state.lease = {
  slotId = slotId,
  clientId = clientID,
  accountId = accountID,
  cursorMaxTime = cursorMaxTime,
  depth = depth,
  claimedAtMS = nowMS,
  expiresAtMS = nowMS + leaseTTLMS
}
redis.call('SET', stateKey, cjson.encode(state))
redis.call('PEXPIRE', stateKey, math.max(leaseTTLMS + restartCooldownMS * 4, 60000))
return cjson.encode({
  claimed = true,
  slotId = slotId,
  cursorMaxTime = cursorMaxTime,
  depth = depth,
  cycle = cycle,
  retryAfterMs = 0,
  leaseTtlMs = leaseTTLMS,
  fromHead = cursorMaxTime <= 0 and depth == 0,
  generatedAt = nowMS,
  reason = 'claimed'
})
`),
		allScanReportScript: redis.NewScript(`
local stateKey = KEYS[1]
local nowMS = tonumber(ARGV[1])
local clientID = tostring(ARGV[2] or '')
local accountID = tostring(ARGV[3] or '')
local slotId = tostring(ARGV[4] or '')
local usedCursorMaxTime = tonumber(ARGV[5] or '0')
local nextCursorMaxTime = tonumber(ARGV[6] or '0')
local hasMore = tonumber(ARGV[7] or '0')
local errMsg = tostring(ARGV[8] or '')
local raw = redis.call('GET', stateKey)
if not raw or raw == '' then
  return cjson.encode({accepted = false, generatedAt = nowMS, reason = 'cursor_state_missing'})
end
local ok, state = pcall(cjson.decode, raw)
if not ok or not state then
  return cjson.encode({accepted = false, generatedAt = nowMS, reason = 'cursor_state_invalid'})
end
local lease = state.lease or {}
if tostring(lease.slotId or '') ~= slotId or tostring(lease.clientId or '') ~= clientID or tostring(lease.accountId or '') ~= accountID then
  return cjson.encode({accepted = false, generatedAt = nowMS, reason = 'lease_mismatch'})
end
state.lease = {}
if errMsg ~= '' then
  redis.call('SET', stateKey, cjson.encode(state))
  redis.call('PEXPIRE', stateKey, 60000)
  return cjson.encode({accepted = true, continue = true, nextQueued = false, generatedAt = nowMS, reason = 'retry_current_cursor'})
end
if hasMore == 1 and nextCursorMaxTime > 0 and nextCursorMaxTime ~= usedCursorMaxTime then
  state.nextCursorMaxTime = nextCursorMaxTime
  state.depth = (tonumber(lease.depth or '0') or 0) + 1
  state.exhausted = false
  state.lastAdvancedAtMS = nowMS
  redis.call('SET', stateKey, cjson.encode(state))
  redis.call('PEXPIRE', stateKey, 60000)
  return cjson.encode({accepted = true, continue = true, nextQueued = true, generatedAt = nowMS, reason = 'advanced'})
end
state.nextCursorMaxTime = 0
state.depth = 0
state.exhausted = true
state.lastAdvancedAtMS = nowMS
redis.call('SET', stateKey, cjson.encode(state))
redis.call('PEXPIRE', stateKey, 60000)
return cjson.encode({accepted = true, continue = false, nextQueued = false, generatedAt = nowMS, reason = 'exhausted'})
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
		if err != nil {
			break
		}
		if len(keys) == 0 {
			break
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
		pipe.HDel(ctx, s.keyCandidateLeaseCount(), fields...)
		pipe.HDel(ctx, s.keyCandidateJoinedCount(), fields...)
		_, _ = pipe.Exec(ctx)
		s.dirty.Store(true)
	}

	s.sweepExpiredLeases(ctx, nowMS)
}

func (s *RedisService) sweepExpiredLeases(ctx context.Context, nowMS int64) {
	max := strconv.FormatInt(nowMS, 10)
	for {
		leaseIDs, err := s.rdb.ZRangeByScore(ctx, s.keyLeaseExpire(), &redis.ZRangeBy{
			Min:    "-inf",
			Max:    max,
			Offset: 0,
			Count:  1024,
		}).Result()
		if err != nil || len(leaseIDs) == 0 {
			return
		}

		raws, err := s.rdb.HMGet(ctx, s.keyLeases(), leaseIDs...).Result()
		if err != nil {
			return
		}

		decrByCandidate := make(map[string]int64, len(raws))
		for _, raw := range raws {
			if raw == nil {
				continue
			}
			var lease LeaseInfo
			if err := json.Unmarshal([]byte(asString(raw)), &lease); err != nil {
				continue
			}
			if lease.CandidateKey != "" {
				decrByCandidate[lease.CandidateKey]++
			}
		}

		pipe := s.rdb.Pipeline()
		if len(leaseIDs) > 0 {
			fields := make([]string, 0, len(leaseIDs))
			fields = append(fields, leaseIDs...)
			pipe.HDel(ctx, s.keyLeases(), fields...)
			members := make([]any, 0, len(fields))
			for _, field := range fields {
				members = append(members, field)
			}
			pipe.ZRem(ctx, s.keyLeaseExpire(), members...)
		}
		countCmds := make(map[string]*redis.IntCmd, len(decrByCandidate))
		ownerKeys := make([]string, 0, len(raws))
		for candidateKey, delta := range decrByCandidate {
			if candidateKey == "" || delta <= 0 {
				continue
			}
			countCmds[candidateKey] = pipe.HIncrBy(ctx, s.keyCandidateLeaseCount(), candidateKey, -delta)
		}
		for _, raw := range raws {
			if raw == nil {
				continue
			}
			var lease LeaseInfo
			if err := json.Unmarshal([]byte(asString(raw)), &lease); err != nil {
				continue
			}
			if ownerKey := buildOwnerCandidateLeaseKey(ClaimOwner{ClientID: lease.ClientID, AccountID: lease.AccountID}, lease.CandidateKey); ownerKey != "" {
				ownerKeys = append(ownerKeys, ownerKey)
			}
		}
		if len(ownerKeys) > 0 {
			pipe.HDel(ctx, s.keyOwnerCandidateLease(), ownerKeys...)
		}
		if _, err := pipe.Exec(ctx); err != nil {
			return
		}

		if len(countCmds) > 0 {
			toDelete := make([]string, 0, len(countCmds))
			for candidateKey, cmd := range countCmds {
				if cmd == nil {
					continue
				}
				if value, err := cmd.Result(); err == nil && value <= 0 {
					toDelete = append(toDelete, candidateKey)
				}
			}
			if len(toDelete) > 0 {
				_ = s.rdb.HDel(ctx, s.keyCandidateLeaseCount(), toDelete...).Err()
			}
		}
	}
}

func (s *RedisService) sweepExpiredScanClients(ctx context.Context, nowMS int64) {
	max := strconv.FormatInt(nowMS, 10)
	for {
		clientIDs, err := s.rdb.ZRangeByScore(ctx, s.keyScanClientExpire(), &redis.ZRangeBy{
			Min:    "-inf",
			Max:    max,
			Offset: 0,
			Count:  512,
		}).Result()
		if err != nil || len(clientIDs) == 0 {
			return
		}
		pipe := s.rdb.Pipeline()
		pipe.HDel(ctx, s.keyScanClients(), clientIDs...)
		members := make([]any, 0, len(clientIDs))
		for _, clientID := range clientIDs {
			members = append(members, clientID)
		}
		pipe.ZRem(ctx, s.keyScanClientExpire(), members...)
		_, _ = pipe.Exec(ctx)
	}
}

func (s *RedisService) fetchActiveScanClientStates(ctx context.Context, nowMS int64) map[string]scanClientState {
	s.sweepExpiredScanClients(ctx, nowMS)
	values, err := s.rdb.HGetAll(ctx, s.keyScanClients()).Result()
	if err != nil {
		return map[string]scanClientState{}
	}
	out := make(map[string]scanClientState, len(values))
	for clientID, raw := range values {
		var state scanClientState
		if err := json.Unmarshal([]byte(raw), &state); err != nil {
			state = scanClientState{
				ClientID:    clientID,
				UpdatedAtMS: nowMS,
			}
		}
		state.ClientID = stringsTrim(clientID)
		out[state.ClientID] = state
	}
	return out
}

func (s *RedisService) fetchActiveLeaseGroups(ctx context.Context, nowMS int64) map[string][]LeaseInfo {
	return buildLeaseGroupMap(s.fetchActiveLeases(ctx, nowMS))
}

func (s *RedisService) fetchCandidateJoinedCounts(ctx context.Context) map[string]int {
	values, err := s.rdb.HGetAll(ctx, s.keyCandidateJoinedCount()).Result()
	if err != nil || len(values) == 0 {
		return map[string]int{}
	}
	out := make(map[string]int, len(values))
	for key, raw := range values {
		value, err := strconv.Atoi(stringsTrim(raw))
		if err != nil || value <= 0 {
			continue
		}
		out[key] = value
	}
	return out
}

func (s *RedisService) fetchActiveLeases(ctx context.Context, nowMS int64) []LeaseInfo {
	s.sweepExpiredLeases(ctx, nowMS)
	values, err := s.rdb.HGetAll(ctx, s.keyLeases()).Result()
	if err != nil {
		return []LeaseInfo{}
	}
	out := make([]LeaseInfo, 0, len(values))
	for leaseID, raw := range values {
		var lease LeaseInfo
		if err := json.Unmarshal([]byte(raw), &lease); err != nil {
			continue
		}
		if lease.ExpiresAtMS > 0 && lease.ExpiresAtMS <= nowMS {
			continue
		}
		if lease.LeaseID == "" {
			lease.LeaseID = leaseID
		}
		out = append(out, lease)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ExpiresAtMS == out[j].ExpiresAtMS {
			return out[i].ClaimedAtMS > out[j].ClaimedAtMS
		}
		return out[i].ExpiresAtMS < out[j].ExpiresAtMS
	})
	return out
}

func (s *RedisService) fetchLeaseByID(ctx context.Context, leaseID string) (*LeaseInfo, error) {
	raw, err := s.rdb.HGet(ctx, s.keyLeases(), leaseID).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var lease LeaseInfo
	if err := json.Unmarshal([]byte(raw), &lease); err != nil {
		return nil, err
	}
	return &lease, nil
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
	learningLookup := s.fetchLearningLookup(ctx)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	capSize := s.cfg.TopCacheMax
	if capSize <= 0 {
		capSize = 2500
	}
	out, validCount, _ := selectTopCandidatesWithLease(all, profile, now, capSize, nil, joinedCounts, ClaimOwner{}, false, learningLookup)

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
	learningLookup := s.fetchLearningLookup(ctx)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	out, validCount, _ := selectTopCandidatesWithLease(all, profile, now, limit, nil, joinedCounts, ClaimOwner{}, false, learningLookup)
	_, pv := s.Profile()
	return out, TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}, pv
}

// TopAvailable 方法：返回当前 owner 可见的可执行优选列表，默认排除其他客户端已持有的租约。
func (s *RedisService) TopAvailable(limit int, profile FilterProfile, owner ClaimOwner, includeClaimedSelf bool) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
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
	leaseGroups := s.fetchActiveLeaseGroups(ctx, now)
	learningLookup := s.fetchLearningLookup(ctx)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	out, validCount, _ := selectTopCandidatesWithLease(all, profile, now, limit, leaseGroups, joinedCounts, normalizeClaimOwner(owner), includeClaimedSelf, learningLookup)
	_, pv := s.Profile()
	return out, TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}, pv
}

// ClaimTask 方法：从 Redis 共享池中领取一个任务，并写入租约记录。
func (s *RedisService) ClaimTask(options ClaimOptions) (ClaimResult, error) {
	now := time.Now().UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)
	s.SweepExpired(now)

	owner := normalizeClaimOwner(options.Owner)
	leaseSec := normalizeLeaseSec(options.LeaseSec)
	profile := options.Profile
	_, pv := s.Profile()

	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		return ClaimResult{Claimed: false, Reason: err.Error(), ProfileVersion: pv, GeneratedAtMS: now}, err
	}
	leaseGroups := s.fetchActiveLeaseGroups(ctx, now)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	learningLookup := s.fetchLearningLookup(ctx)
	candidateMap := make(map[string]Candidate, len(all))
	for _, candidate := range all {
		candidateMap[candidate.Key] = candidate
	}
	scored, _, _ := selectTopCandidatesWithLease(all, profile, now, s.cfg.TopCacheMax, leaseGroups, joinedCounts, ClaimOwner{}, false, learningLookup)
	exclude := make(map[string]struct{}, len(options.ExcludeKeys))
	for _, key := range options.ExcludeKeys {
		if trimmed := stringsTrim(key); trimmed != "" {
			exclude[trimmed] = struct{}{}
		}
	}
	preferSet := make(map[string]struct{}, len(options.PreferKeys))
	for _, key := range options.PreferKeys {
		if trimmed := stringsTrim(key); trimmed != "" {
			preferSet[trimmed] = struct{}{}
		}
	}

	ordered := make([]ScoredCandidate, 0, len(scored))
	if len(preferSet) > 0 {
		for _, item := range scored {
			if _, ok := preferSet[scoredCandidateKey(item)]; ok {
				ordered = append(ordered, item)
			}
		}
	}
	for _, item := range scored {
		if _, ok := preferSet[scoredCandidateKey(item)]; ok {
			continue
		}
		ordered = append(ordered, item)
	}
	preferredItems := make([]ScoredCandidate, 0, len(preferSet))
	regularItems := make([]ScoredCandidate, 0, len(ordered))
	for _, item := range ordered {
		if _, ok := preferSet[scoredCandidateKey(item)]; ok {
			preferredItems = append(preferredItems, item)
			continue
		}
		regularItems = append(regularItems, item)
	}
	preferredItems = rankClaimCandidates(preferredItems, candidateMap, now, 8)
	if len(regularItems) > 48 {
		regularItems = regularItems[:48]
	}
	regularItems = rankClaimCandidates(regularItems, candidateMap, now, 24)
	ordered = append(preferredItems, regularItems...)

	for _, item := range ordered {
		key := scoredCandidateKey(item)
		if key == "" {
			continue
		}
		if _, blocked := exclude[key]; blocked {
			continue
		}

		leaseID := "lease-" + strconv.FormatInt(s.seq.Add(1), 10)
		lease := LeaseInfo{
			LeaseID:      leaseID,
			CandidateKey: key,
			RoomID:       item.RoomID,
			LotteryID:    item.LotteryID,
			ClientID:     owner.ClientID,
			AccountID:    owner.AccountID,
			SlotLimit:    item.MaxLeaseSlots,
			ClaimedAtMS:  now,
			UpdatedAtMS:  now,
			ExpiresAtMS:  now + leaseSec*1000,
		}
		payload, err := json.Marshal(lease)
		if err != nil {
			continue
		}

		ok, err := s.claimScript.Run(ctx, s.rdb,
			[]string{s.keyCandidateLeaseCount(), s.keyCandidateJoinedCount(), s.keyOwnerCandidateLease(), s.keyLeases(), s.keyLeaseExpire()},
			key, leaseID, now, lease.ExpiresAtMS, item.MaxLeaseSlots, string(payload), buildOwnerCandidateLeaseKey(owner, key),
		).Int()
		if err != nil {
			continue
		}
		if ok != 1 {
			continue
		}

		item.Claimed = true
		item.Lease = &lease
		item.LeaseCount++
		item.JoinedCount = maxInt(joinedCounts[key], 0)
		item.AvailableSlots = maxInt(item.MaxLeaseSlots-item.LeaseCount-item.JoinedCount, 0)
		return ClaimResult{
			Claimed:        true,
			Item:           &item,
			Lease:          &lease,
			ProfileVersion: pv,
			GeneratedAtMS:  now,
		}, nil
	}

	return ClaimResult{
		Claimed:        false,
		Reason:         "no_available_task",
		ProfileVersion: pv,
		GeneratedAtMS:  now,
	}, nil
}

// RenewTaskLease 方法：续租共享任务，避免预热期间被其他客户端接管。
func (s *RedisService) RenewTaskLease(owner ClaimOwner, leaseID string, leaseSec int64) (*LeaseInfo, bool, error) {
	now := time.Now().UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	s.sweepExpiredLeases(ctx, now)

	owner = normalizeClaimOwner(owner)
	leaseSec = normalizeLeaseSec(leaseSec)
	expireAt := now + leaseSec*1000

	raw, err := s.renewScript.Run(ctx, s.rdb,
		[]string{s.keyLeases(), s.keyLeaseExpire(), s.keyCandidateLeaseCount(), s.keyOwnerCandidateLease()},
		stringsTrim(leaseID), owner.ClientID, owner.AccountID, now, expireAt,
	).Text()
	if err != nil {
		return nil, false, err
	}
	if stringsTrim(raw) == "" {
		return nil, false, nil
	}
	var lease LeaseInfo
	if err := json.Unmarshal([]byte(raw), &lease); err != nil {
		return nil, false, err
	}
	return &lease, true, nil
}

// ReleaseTaskLease 方法：主动释放共享任务租约。
func (s *RedisService) ReleaseTaskLease(owner ClaimOwner, leaseID string, reason string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	owner = normalizeClaimOwner(owner)
	res, err := s.releaseScript.Run(ctx, s.rdb,
		[]string{s.keyLeases(), s.keyLeaseExpire(), s.keyCandidateLeaseCount(), s.keyOwnerCandidateLease()},
		stringsTrim(leaseID), owner.ClientID, owner.AccountID, reason,
	).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

// FinishTaskLease 方法：结束共享任务租约，并在需要时将候选从池中移除。
func (s *RedisService) FinishTaskLease(owner ClaimOwner, leaseID string, result string, removeCandidate bool) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	owner = normalizeClaimOwner(owner)
	removeFlag := "0"
	if removeCandidate {
		removeFlag = "1"
	}
	res, err := s.finishScript.Run(ctx, s.rdb,
		[]string{s.keyLeases(), s.keyLeaseExpire(), s.keyCandidateLeaseCount(), s.keyCandidateJoinedCount(), s.keyOwnerCandidateLease(), s.keyCandidates(), s.keyExpire()},
		stringsTrim(leaseID), owner.ClientID, owner.AccountID, removeFlag, result,
	).Int()
	if err != nil {
		return false, err
	}
	if res == 1 {
		s.dirty.Store(true)
	}
	return res == 1, nil
}

// RecordTaskFeedback 方法：将执行端反馈写入 Redis 学习桶。
func (s *RedisService) RecordTaskFeedback(feedback TaskFeedback) error {
	normalized := normalizeTaskFeedback(feedback)
	if normalized.Event == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	bucketKey := buildLearningBucketKey(normalized)
	bucket := newLearningBucketFromFeedback(normalized, bucketKey)
	_, err := s.feedbackScript.Run(ctx, s.rdb,
		[]string{s.keyLearning()},
		bucketKey,
		bucket.PrizeClass,
		bucket.RemainBucket,
		bucket.ProbBucket,
		bucket.OnlineBucket,
		bucket.CrowdBucket,
		normalized.Event,
		normalized.PredictedProbability,
		normalized.RewardAmount,
		time.Now().UnixMilli(),
	).Int()
	if err == nil {
		s.dirty.Store(true)
		if appendErr := appendFeedbackJSONL(s.cfg.FeedbackLogPath, normalized); appendErr != nil {
			return appendErr
		}
	}
	return err
}

func (s *RedisService) buildScanPoolSummary(ctx context.Context, nowMS int64) scanPoolSummary {
	s.SweepExpired(nowMS)
	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		return scanPoolSummary{}
	}
	profile, _ := s.Profile()
	leaseGroups := s.fetchActiveLeaseGroups(ctx, nowMS)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	learningLookup := s.fetchLearningLookup(ctx)
	_, validCount, availableCount := selectTopCandidatesWithLease(all, profile, nowMS, maxInt(len(all), 1), leaseGroups, joinedCounts, ClaimOwner{}, false, learningLookup)
	leaseCount := len(s.fetchActiveLeases(ctx, nowMS))
	return scanPoolSummary{
		ValidCandidates:     validCount,
		AvailableCandidates: availableCount,
		LeaseCount:          leaseCount,
	}
}

// ScanPermit 方法：通过 Redis 令牌桶对集群扫描请求执行硬限流。
func (s *RedisService) ScanPermit(options ScanPermitOptions) (ScanPermitResult, error) {
	now := time.Now().UnixMilli()
	normalized := normalizeScanPermitOptions(options)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	activeStates := s.fetchActiveScanClientStates(ctx, now)
	refillPerSec, burst, clusterRiskLevel, clusterRiskScore := buildScanPermitPolicy(normalized.Kind, activeStates, s.buildScanPoolSummary(ctx, now))
	ttlMS := int64(math.Max(60000, math.Ceil((burst/math.Max(refillPerSec, 0.08))*3000)))
	raw, err := s.permitScript.Run(ctx, s.rdb, []string{s.keyScanPermit(normalized.Kind)},
		now,
		normalized.Cost,
		refillPerSec,
		burst,
		ttlMS,
		normalized.Kind,
		clusterRiskLevel,
		clusterRiskScore,
	).Text()
	if err != nil {
		return ScanPermitResult{}, err
	}
	var result ScanPermitResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return ScanPermitResult{}, err
	}
	if result.Kind == "" {
		result.Kind = normalized.Kind
	}
	return result, nil
}

// ClaimAllScanCursor 方法：从 Redis 共享状态中领取当前可推进的全站 maxTime 游标。
func (s *RedisService) ClaimAllScanCursor(options AllScanClaimOptions) (AllScanClaimResult, error) {
	now := time.Now().UnixMilli()
	normalized := normalizeAllScanClaimOptions(options)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	raw, err := s.allScanClaimScript.Run(ctx, s.rdb, []string{s.keyAllScanCursor()},
		now,
		normalized.LeaseTTLMS,
		normalized.ClientID,
		normalized.AccountID,
		DefaultAllScanRestartCooldownMS,
	).Text()
	if err != nil {
		return AllScanClaimResult{}, err
	}
	var result AllScanClaimResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return AllScanClaimResult{}, err
	}
	return result, nil
}

// ReportAllScanCursor 方法：回传全站 maxTime 扫描推进结果，更新 Redis 共享游标。
func (s *RedisService) ReportAllScanCursor(options AllScanReportOptions) (AllScanReportResult, error) {
	now := time.Now().UnixMilli()
	normalized := normalizeAllScanReportOptions(options)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	hasMore := 0
	if normalized.HasMore {
		hasMore = 1
	}
	raw, err := s.allScanReportScript.Run(ctx, s.rdb, []string{s.keyAllScanCursor()},
		now,
		normalized.ClientID,
		normalized.AccountID,
		normalized.SlotID,
		normalized.UsedCursorMaxTime,
		normalized.NextCursorMaxTime,
		hasMore,
		normalized.Error,
	).Text()
	if err != nil {
		return AllScanReportResult{}, err
	}
	var result AllScanReportResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return AllScanReportResult{}, err
	}
	return result, nil
}

// ScanAssignment 方法：更新客户端扫描心跳与风控遥测，并返回共享池服务端分配的扫描分片。
func (s *RedisService) ScanAssignment(clientID string, categoryIDs []string, telemetry ScanTelemetry) (ScanAssignment, error) {
	now := time.Now().UnixMilli()
	normalizedClientID := stringsTrim(clientID)
	if normalizedClientID == "" {
		return ScanAssignment{}, errors.New("clientId is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	expiresAtMS := now + DefaultScanHeartbeatTTLMS
	state := scanClientState{
		ClientID:    normalizedClientID,
		UpdatedAtMS: now,
		Telemetry:   normalizeScanTelemetry(telemetry),
	}
	rawState, _ := json.Marshal(state)
	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, s.keyScanClients(), normalizedClientID, string(rawState))
	pipe.ZAdd(ctx, s.keyScanClientExpire(), redis.Z{Score: float64(expiresAtMS), Member: normalizedClientID})
	if _, err := pipe.Exec(ctx); err != nil {
		return ScanAssignment{}, err
	}

	activeStates := s.fetchActiveScanClientStates(ctx, now)
	return buildScanAssignment(normalizedClientID, activeStates, categoryIDs, now, DefaultScanHeartbeatTTLMS, s.buildScanPoolSummary(ctx, now)), nil
}

// TaskDebug 方法：返回当前共享池和租约的调试快照，便于客户端观测调度状态。
func (s *RedisService) TaskDebug(profile FilterProfile, owner ClaimOwner, leaseLimit int) (TaskDebugSnapshot, int64) {
	now := time.Now().UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)
	s.SweepExpired(now)

	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		_, pv := s.Profile()
		return TaskDebugSnapshot{
			Summary: TaskDebugSummary{
				GeneratedAtMS: now,
			},
			Leases: []LeaseInfo{},
		}, pv
	}
	leases := s.fetchActiveLeases(ctx, now)
	leaseGroups := buildLeaseGroupMap(leases)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	learningLookup := s.fetchLearningLookup(ctx)
	_, pv := s.Profile()
	return buildTaskDebugSnapshot(all, profile, now, normalizeClaimOwner(owner), leaseGroups, joinedCounts, leases, learningLookup, leaseLimit), pv
}

// ReviewTask 方法：在预热阶段执行服务端临开奖再重排，输出 keep/switch/drop 建议。
func (s *RedisService) ReviewTask(options ReviewOptions) (ReviewResult, error) {
	now := time.Now().UnixMilli()
	owner := normalizeClaimOwner(options.Owner)
	stage := normalizeReviewStage(options.Stage, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.syncProfileFromRedis(ctx)
	s.SweepExpired(now)

	all, err := s.fetchAllCandidates(ctx)
	if err != nil {
		_, pv := s.Profile()
		return ReviewResult{
			Reviewed:       false,
			Stage:          stage,
			Decision:       "drop",
			Reason:         err.Error(),
			ProfileVersion: pv,
			GeneratedAtMS:  now,
			Alternatives:   []ScoredCandidate{},
		}, nil
	}
	leaseGroups := s.fetchActiveLeaseGroups(ctx, now)
	joinedCounts := s.fetchCandidateJoinedCounts(ctx)
	learningLookup := s.fetchLearningLookup(ctx)
	ordered, candidateMap := buildOrderedTaskCandidates(
		all,
		options.Profile,
		now,
		s.cfg.TopCacheMax,
		leaseGroups,
		joinedCounts,
		owner,
		true,
		learningLookup,
		[]string{options.CurrentCandidateKey},
		options.ExcludeKeys,
	)
	_, pv := s.Profile()
	if len(ordered) == 0 {
		return ReviewResult{
			Reviewed:       true,
			Stage:          stage,
			Decision:       "drop",
			Reason:         "no_available_candidate",
			ProfileVersion: pv,
			GeneratedAtMS:  now,
			Alternatives:   []ScoredCandidate{},
		}, nil
	}
	reviewed := rankReviewCandidates(ordered, candidateMap, now, stage, stringsTrim(options.CurrentCandidateKey), stringsTrim(options.CurrentRoomID), normalizeTopLimit(options.Limit, 24))
	var currentItem *ScoredCandidate
	for idx := range reviewed {
		item := reviewed[idx]
		if options.CurrentCandidateKey != "" && item.Key == stringsTrim(options.CurrentCandidateKey) {
			copyItem := item
			currentItem = &copyItem
			break
		}
		if currentItem == nil && options.CurrentRoomID != "" && item.RoomID == stringsTrim(options.CurrentRoomID) {
			copyItem := item
			currentItem = &copyItem
		}
	}
	bestItem := reviewed[0]
	decision, reason := decideReviewSwitch(currentItem, &bestItem, stage, stringsTrim(options.CurrentRoomID))
	return ReviewResult{
		Reviewed:       true,
		Stage:          stage,
		Decision:       decision,
		Reason:         reason,
		Item:           &bestItem,
		Current:        currentItem,
		Alternatives:   reviewed,
		ProfileVersion: pv,
		GeneratedAtMS:  now,
	}, nil
}

// LearningDebug 方法：输出学习桶快照，帮助观察学习闭环是否生效。
func (s *RedisService) LearningDebug(limit int) (LearningDebugSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	values, err := s.fetchLearningBuckets(ctx)
	if err != nil {
		return LearningDebugSnapshot{}, err
	}
	items := make([]LearningBucket, 0, len(values))
	for _, bucket := range values {
		items = append(items, bucket)
	}
	return LearningDebugSnapshot{
		Summary: applyLearningSummaryWeights(summarizeLearningBuckets(items), s.cfg.LearningJoinWeight, s.cfg.LearningWinWeight),
		Items:   sortLearningBuckets(items, limit),
	}, nil
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

func (s *RedisService) fetchLearningBuckets(ctx context.Context) (map[string]LearningBucket, error) {
	values, err := s.rdb.HGetAll(ctx, s.keyLearning()).Result()
	if err != nil {
		return nil, err
	}
	out := make(map[string]LearningBucket, len(values))
	for bucketKey, raw := range values {
		var bucket LearningBucket
		if err := json.Unmarshal([]byte(raw), &bucket); err != nil {
			continue
		}
		if bucket.Key == "" {
			bucket.Key = bucketKey
		}
		out[bucketKey] = bucket
	}
	return out, nil
}

func mapsValues(input map[string]LearningBucket) []LearningBucket {
	if len(input) == 0 {
		return []LearningBucket{}
	}
	out := make([]LearningBucket, 0, len(input))
	for _, value := range input {
		out = append(out, value)
	}
	return out
}

func (s *RedisService) fetchLearningLookup(ctx context.Context) LearningLookupFunc {
	values, err := s.fetchLearningBuckets(ctx)
	if err != nil || len(values) == 0 {
		return nil
	}
	summary := applyLearningSummaryWeights(summarizeLearningBuckets(mapsValues(values)), s.cfg.LearningJoinWeight, s.cfg.LearningWinWeight)
	return func(bucketKey string) (LearningBucket, LearningSummary, bool) {
		bucket, ok := values[bucketKey]
		return bucket, summary, ok
	}
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

func (s *RedisService) keyLeases() string {
	return s.rcfg.Prefix + ":leases"
}

func (s *RedisService) keyCandidateLeases() string {
	return s.rcfg.Prefix + ":candidate_leases"
}

func (s *RedisService) keyCandidateLeaseCount() string {
	return s.rcfg.Prefix + ":candidate_lease_count"
}

func (s *RedisService) keyCandidateJoinedCount() string {
	return s.rcfg.Prefix + ":candidate_joined_count"
}

func (s *RedisService) keyOwnerCandidateLease() string {
	return s.rcfg.Prefix + ":owner_candidate_lease"
}

func (s *RedisService) keyLeaseExpire() string {
	return s.rcfg.Prefix + ":lease_expire"
}

func (s *RedisService) keyLearning() string {
	return s.rcfg.Prefix + ":learning"
}

func (s *RedisService) keyScanClients() string {
	return s.rcfg.Prefix + ":scan_clients"
}

func (s *RedisService) keyScanClientExpire() string {
	return s.rcfg.Prefix + ":scan_client_expire"
}

func (s *RedisService) keyScanPermit(kind string) string {
	return s.rcfg.Prefix + ":scan_permit:" + normalizeScanPermitKind(kind)
}

func (s *RedisService) keyAllScanCursor() string {
	return s.rcfg.Prefix + ":all_scan_cursor"
}

// stringsTrim 方法：处理字符串集合首尾空白。
func stringsTrim(v string) string {
	return strings.TrimSpace(v)
}
