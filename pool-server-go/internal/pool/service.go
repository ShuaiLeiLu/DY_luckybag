package pool

import (
	"container/heap"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	fanClubJoinRE  = regexp.MustCompile(`粉丝团|粉丝专属|仅粉丝|仅限粉丝|铁粉|铁粉专属|团员|加团|加入粉丝团|加入团|粉丝牌|粉团`)
	memberJoinRE   = regexp.MustCompile(`主播会员|会员可参与|仅会员|会员专属|vip|VIP|订阅后可参与|需订阅|订阅可参与|开通会员`)
	physicalNameRE = regexp.MustCompile(`实物|包邮|礼盒|手机|平板|电脑|耳机|手表|鼠标|键盘|洗衣液|纸巾|零食|玩偶|公仔|盲盒|礼品|奖品|抱枕|杯子`)
	virtualNameRE  = regexp.MustCompile(`抖币|钻石|红包|优惠券|代金券|金币|福豆|会员|体验卡|流量|点券`)
	redpackNameRE  = regexp.MustCompile(`红包|抖币|钻石|现金|元`)
)

type Config struct {
	TopCacheMax        int
	TTLGraceSec        int64
	MaxBatchSize       int
	TopRefreshMS       int64
	ExpireSweepMS      int64
	MinHeapShards      int
	LearningJoinWeight float64
	LearningWinWeight  float64
	FeedbackLogPath    string
}

// DefaultConfig 方法：返回默认配置。
func DefaultConfig() Config {
	return Config{
		TopCacheMax:        2500,
		TTLGraceSec:        8,
		MaxBatchSize:       1000,
		TopRefreshMS:       400,
		ExpireSweepMS:      500,
		MinHeapShards:      64,
		LearningJoinWeight: 0,
		LearningWinWeight:  0,
		FeedbackLogPath:    "",
	}
}

type FilterProfile struct {
	RequireType3And6      bool    `json:"requireType3And6"`
	FilterFanClub         bool    `json:"filterFanClub"`
	OnlyPhysicalPrize     bool    `json:"onlyPhysicalPrize"`
	PreferBigRedPacket    bool    `json:"preferBigRedPacket"`
	BigRedPacketThreshold float64 `json:"bigRedPacketThreshold"`
	MinRemainingSec       int64   `json:"minRemainingSec"`
	MaxRemainingSec       int64   `json:"maxRemainingSec"`
	MinProbability        float64 `json:"minProbability"`
	MaxOnlineTotal        float64 `json:"maxOnlineTotal"`
}

// DefaultFilterProfile 方法：返回默认过滤条件策略。
func DefaultFilterProfile() FilterProfile {
	return FilterProfile{
		RequireType3And6:      true,
		FilterFanClub:         true,
		OnlyPhysicalPrize:     false,
		PreferBigRedPacket:    true,
		BigRedPacketThreshold: 40,
		MinRemainingSec:       25,
		MaxRemainingSec:       420,
		MinProbability:        0,
		MaxOnlineTotal:        0,
	}
}

type Condition struct {
	Type    int    `json:"type"`
	Content string `json:"content,omitempty"`
	Desc    string `json:"desc,omitempty"`
}

type Candidate struct {
	Key            string
	RoomID         string
	WebRid         string
	LotteryID      string
	Conditions     []Condition
	JoinTotal      float64
	LuckyCount     float64
	LotteryTotal   float64
	OnlineTotal    float64
	LotteryName    string
	PrizeInfo      map[string]any
	PrizeType      any
	TotalAmount    float64
	EndTimeMS      int64
	StartTimeMS    int64
	FetchedAtMS    int64
	SourceID       string
	AuthorNickname string
	RoomTitle      string
	RiskScore      float64
	ExpireAtMS     int64
	Version        int64
}

type ScoredCandidate struct {
	Key                string      `json:"key"`
	RoomID             string      `json:"roomId"`
	WebRid             string      `json:"webRid"`
	LotteryID          string      `json:"lotteryId"`
	LotteryName        string      `json:"lotteryName"`
	Score              float64     `json:"score"`
	ReviewScore        float64     `json:"reviewScore"`
	Probability        float64     `json:"probability"`
	CurrentProbability float64     `json:"currentProbability"`
	PredictedJoinTotal float64     `json:"predictedJoinTotal"`
	EVScore            float64     `json:"evScore"`
	LearningBoost      float64     `json:"learningBoost"`
	LearningBucket     string      `json:"learningBucket,omitempty"`
	RemainingSec       int64       `json:"remainingSec"`
	JoinTotal          float64     `json:"joinTotal"`
	LuckyCount         float64     `json:"luckyCount"`
	LotteryTotal       float64     `json:"lotteryTotal"`
	OnlineTotal        float64     `json:"onlineTotal"`
	Conditions         []Condition `json:"conditions"`
	PrizeType          any         `json:"prizeType"`
	PrizeInfo          any         `json:"prizeInfo"`
	TotalAmount        float64     `json:"totalAmount"`
	RedPacketInfo      any         `json:"redPacketInfo"`
	SourceID           string      `json:"sourceId"`
	FetchedAt          int64       `json:"fetchedAt"`
	EndTime            int64       `json:"endTime"`
	StartTime          int64       `json:"startTime"`
	AuthorNickname     string      `json:"authorNickname"`
	RoomTitle          string      `json:"roomTitle"`
	Claimed            bool        `json:"claimed"`
	LeaseCount         int         `json:"leaseCount"`
	MaxLeaseSlots      int         `json:"maxLeaseSlots"`
	AvailableSlots     int         `json:"availableSlots"`
	Lease              *LeaseInfo  `json:"lease,omitempty"`
}

type BatchResult struct {
	Received         int   `json:"received"`
	Accepted         int   `json:"accepted"`
	Inserted         int   `json:"inserted"`
	Updated          int   `json:"updated"`
	IgnoredExpired   int   `json:"ignoredExpired"`
	IgnoredOlder     int   `json:"ignoredOlder"`
	Invalid          int   `json:"invalid"`
	ActiveCandidates int   `json:"activeCandidates"`
	ProfileVersion   int64 `json:"profileVersion"`
}

type Stats struct {
	TotalBatches        int64 `json:"totalBatches"`
	TotalReceived       int64 `json:"totalReceived"`
	TotalAccepted       int64 `json:"totalAccepted"`
	TotalInserted       int64 `json:"totalInserted"`
	TotalUpdated        int64 `json:"totalUpdated"`
	TotalIgnoredExpired int64 `json:"totalIgnoredExpired"`
	TotalIgnoredOlder   int64 `json:"totalIgnoredOlder"`
	TotalInvalid        int64 `json:"totalInvalid"`
}

type TopMeta struct {
	BuiltAtMS   int64 `json:"builtAt"`
	ActiveCount int   `json:"activeCount"`
	ValidCount  int   `json:"validCount"`
}

type shard struct {
	mu sync.RWMutex
	m  map[string]*Candidate
}

type store struct {
	shards []shard
	mask   uint64
}

// newStore 方法：创建存储。
func newStore(shardCount int) *store {
	n := 1
	for n < shardCount {
		n <<= 1
	}
	ss := make([]shard, n)
	for i := range ss {
		ss[i].m = make(map[string]*Candidate)
	}
	return &store{shards: ss, mask: uint64(n - 1)}
}

// hashKey 方法：处理哈希键。
func hashKey(key string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	return h.Sum64()
}

// shardFor 方法：处理分片。
func (s *store) shardFor(key string) *shard {
	return &s.shards[hashKey(key)&s.mask]
}

// cloneCandidate 方法：克隆候选项。
func cloneCandidate(c *Candidate) Candidate {
	out := *c
	if c.Conditions != nil {
		out.Conditions = make([]Condition, len(c.Conditions))
		copy(out.Conditions, c.Conditions)
	}
	if c.PrizeInfo != nil {
		pm := make(map[string]any, len(c.PrizeInfo))
		for k, v := range c.PrizeInfo {
			pm[k] = v
		}
		out.PrizeInfo = pm
	}
	return out
}

// get 方法：按键读取存储中的候选数据副本。
func (s *store) get(key string) (*Candidate, bool) {
	sh := s.shardFor(key)
	sh.mu.RLock()
	v, ok := sh.m[key]
	sh.mu.RUnlock()
	return v, ok
}

// set 方法：按键写入或覆盖存储中的候选数据。
func (s *store) set(key string, c *Candidate) {
	sh := s.shardFor(key)
	sh.mu.Lock()
	sh.m[key] = c
	sh.mu.Unlock()
}

// delete 方法：按键删除存储中的候选数据。
func (s *store) delete(key string) {
	sh := s.shardFor(key)
	sh.mu.Lock()
	delete(sh.m, key)
	sh.mu.Unlock()
}

// size 方法：处理数量。
func (s *store) size() int {
	total := 0
	for i := range s.shards {
		s.shards[i].mu.RLock()
		total += len(s.shards[i].m)
		s.shards[i].mu.RUnlock()
	}
	return total
}

// snapshot 方法：处理快照。
func (s *store) snapshot() []Candidate {
	total := s.size()
	out := make([]Candidate, 0, total)
	for i := range s.shards {
		sh := &s.shards[i]
		sh.mu.RLock()
		for _, v := range sh.m {
			out = append(out, cloneCandidate(v))
		}
		sh.mu.RUnlock()
	}
	return out
}

type expiryItem struct {
	Key        string
	ExpireAtMS int64
	Version    int64
}

type expiryMinHeap []expiryItem

// Len 方法：返回堆当前元素数量，满足 heap.Interface 要求。
func (h expiryMinHeap) Len() int { return len(h) }

// Less 方法：定义堆元素比较规则，决定堆序。
func (h expiryMinHeap) Less(i, j int) bool { return h[i].ExpireAtMS < h[j].ExpireAtMS }

// Swap 方法：交换堆中两个元素位置，供堆调整使用。
func (h expiryMinHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

// Push 方法：向堆中压入新元素。
func (h *expiryMinHeap) Push(x any) { *h = append(*h, x.(expiryItem)) }

// Pop 方法：从堆尾弹出一个元素并返回。
func (h *expiryMinHeap) Pop() any {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

type scoreMinHeap []ScoredCandidate

// Len 方法：返回堆当前元素数量，满足 heap.Interface 要求。
func (h scoreMinHeap) Len() int { return len(h) }

// Less 方法：定义堆元素比较规则，决定堆序。
func (h scoreMinHeap) Less(i, j int) bool { return h[i].Score < h[j].Score }

// Swap 方法：交换堆中两个元素位置，供堆调整使用。
func (h scoreMinHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

// Push 方法：向堆中压入新元素。
func (h *scoreMinHeap) Push(x any) { *h = append(*h, x.(ScoredCandidate)) }

// Pop 方法：从堆尾弹出一个元素并返回。
func (h *scoreMinHeap) Pop() any {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

type Service struct {
	cfg Config

	profileMu      sync.RWMutex
	profile        FilterProfile
	profileVersion int64

	store *store

	expMu sync.Mutex
	exp   expiryMinHeap

	seq   atomic.Int64
	dirty atomic.Bool

	topMu    sync.RWMutex
	topCache []ScoredCandidate
	topMeta  TopMeta

	stats   Stats
	statsMu sync.Mutex

	leaseMu sync.Mutex
	leases  map[string]*LeaseInfo

	learningMu sync.RWMutex
	learning   map[string]*LearningBucket

	scanClientMu sync.Mutex
	scanClients  map[string]scanClientState

	scanPermitMu sync.Mutex
	scanPermits  map[string]scanPermitState

	allScanMu     sync.Mutex
	allScanCursor allScanCursorState
}

// NewService 方法：创建服务。
func NewService(cfg Config) *Service {
	if cfg.TopCacheMax <= 0 {
		cfg.TopCacheMax = 2500
	}
	if cfg.TTLGraceSec <= 0 {
		cfg.TTLGraceSec = 8
	}
	if cfg.MaxBatchSize <= 0 {
		cfg.MaxBatchSize = 1000
	}
	if cfg.MinHeapShards <= 0 {
		cfg.MinHeapShards = 64
	}
	s := &Service{
		cfg:            cfg,
		profile:        DefaultFilterProfile(),
		profileVersion: 1,
		store:          newStore(cfg.MinHeapShards),
		leases:         make(map[string]*LeaseInfo),
		learning:       make(map[string]*LearningBucket),
		scanClients:    make(map[string]scanClientState),
		scanPermits:    make(map[string]scanPermitState),
		allScanCursor:  defaultAllScanCursorState(time.Now().UnixMilli()),
	}
	s.dirty.Store(true)
	heap.Init(&s.exp)
	return s
}

// Profile 方法：处理策略。
func (s *Service) Profile() (FilterProfile, int64) {
	s.profileMu.RLock()
	defer s.profileMu.RUnlock()
	return s.profile, s.profileVersion
}

// ApplyProfilePatch 基于传入 patch 生成新的 profile，不会修改全局状态。
func ApplyProfilePatch(base FilterProfile, patch map[string]any) FilterProfile {
	return applyProfilePatch(base, patch)
}

// applyProfilePatch 方法：应用策略。
func applyProfilePatch(base FilterProfile, patch map[string]any) FilterProfile {
	p := base
	if len(patch) == 0 {
		return p
	}

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
	if v, ok := patch["maxOnlineTotal"]; ok {
		p.MaxOnlineTotal = maxFloat(0, asFloat(v, p.MaxOnlineTotal))
	}

	return p
}

// normalizeTopLimit 方法：归一化优选结果。
func normalizeTopLimit(limit, maxLimit int) int {
	if limit <= 0 {
		limit = 50
	}
	if maxLimit <= 0 {
		maxLimit = 2500
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	return limit
}

// selectTopCandidates 方法：筛选优选结果候选项列表。
func selectTopCandidates(all []Candidate, profile FilterProfile, nowMS int64, capSize int) ([]ScoredCandidate, int) {
	return selectTopCandidatesWithLease(all, profile, nowMS, capSize, nil, ClaimOwner{}, false, nil)
}

func selectTopCandidatesWithLease(
	all []Candidate,
	profile FilterProfile,
	nowMS int64,
	capSize int,
	leaseGroups map[string][]LeaseInfo,
	owner ClaimOwner,
	includeClaimedSelf bool,
	learningLookup LearningLookupFunc,
) ([]ScoredCandidate, int) {
	if capSize <= 0 {
		return []ScoredCandidate{}, 0
	}

	h := &scoreMinHeap{}
	heap.Init(h)
	validCount := 0

	for i := range all {
		c := all[i]
		if c.ExpireAtMS > 0 && c.ExpireAtMS <= nowMS {
			continue
		}
		ok, _ := passFilter(c, profile, nowMS)
		if !ok {
			continue
		}
		validCount++
		sc := scoreCandidate(c, profile, nowMS, learningLookup)
		leases := leaseGroups[c.Key]
		sc.MaxLeaseSlots = maxLeaseSlotsForCandidate(c, sc, profile.BigRedPacketThreshold)
		sc.LeaseCount = len(leases)
		sc.AvailableSlots = maxInt(sc.MaxLeaseSlots-sc.LeaseCount, 0)

		var ownerLease *LeaseInfo
		if len(leases) > 0 {
			for _, lease := range leases {
				if ownerMatches(lease, owner) {
					leaseCopy := lease
					ownerLease = &leaseCopy
					break
				}
			}
			sc.Claimed = true
			if ownerLease != nil {
				sc.Lease = ownerLease
			} else {
				leaseCopy := leases[0]
				sc.Lease = &leaseCopy
			}
		}

		if sc.LeaseCount >= sc.MaxLeaseSlots {
			if ownerLease == nil {
				continue
			}
			if !includeClaimedSelf {
				continue
			}
			sc.Claimed = true
		}
		if h.Len() < capSize {
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
	return out, validCount
}

// buildLeaseGroupMap 方法：按 candidateKey 聚合活跃租约。
func buildLeaseGroupMap(leases []LeaseInfo) map[string][]LeaseInfo {
	if len(leases) == 0 {
		return map[string][]LeaseInfo{}
	}
	out := make(map[string][]LeaseInfo, len(leases))
	for _, lease := range leases {
		if lease.CandidateKey == "" {
			continue
		}
		out[lease.CandidateKey] = append(out[lease.CandidateKey], lease)
	}
	return out
}

type learningSnapshot struct {
	buckets []LearningBucket
	index   map[string]LearningBucket
	summary LearningSummary
}

func (ls learningSnapshot) lookup(bucketKey string) (LearningBucket, LearningSummary, bool) {
	if len(ls.index) == 0 {
		return LearningBucket{}, ls.summary, false
	}
	bucket, ok := ls.index[bucketKey]
	return bucket, ls.summary, ok
}

// UpdateProfile 方法：更新策略。
func (s *Service) UpdateProfile(patch map[string]any) (FilterProfile, int64) {
	s.profileMu.Lock()
	defer s.profileMu.Unlock()
	p := applyProfilePatch(s.profile, patch)

	s.profile = p
	s.profileVersion++
	s.dirty.Store(true)
	return s.profile, s.profileVersion
}

// UpsertBatch 方法：批量写入候选福袋数据，并返回新增/更新统计。
func (s *Service) UpsertBatch(sourceID string, raws []map[string]any) BatchResult {
	received := len(raws)
	if received > s.cfg.MaxBatchSize {
		raws = raws[:s.cfg.MaxBatchSize]
		received = len(raws)
	}

	now := time.Now().UnixMilli()
	result := BatchResult{
		Received: received,
	}

	for _, raw := range raws {
		c, err := normalizeCandidate(raw, sourceID, now)
		if err != nil {
			result.Invalid++
			continue
		}
		result.Accepted++

		status := s.upsertOne(c, now)
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

	result.ActiveCandidates = s.store.size()
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
func (s *Service) upsertOne(c Candidate, nowMS int64) string {
	exp := c.EndTimeMS + s.cfg.TTLGraceSec*1000
	if exp <= nowMS {
		return "expired"
	}

	wasExisting := false
	if prev, ok := s.store.get(c.Key); ok {
		wasExisting = true
		if prev.FetchedAtMS > c.FetchedAtMS {
			return "older"
		}
	}

	c.ExpireAtMS = exp
	c.Version = s.seq.Add(1)
	cloned := c
	s.store.set(c.Key, &cloned)
	s.expMu.Lock()
	heap.Push(&s.exp, expiryItem{
		Key: c.Key, ExpireAtMS: exp, Version: c.Version,
	})
	s.expMu.Unlock()
	s.dirty.Store(true)

	if wasExisting {
		return "updated"
	}
	return "inserted"
}

// SweepExpired 方法：清理已过期候选福袋并同步索引。
func (s *Service) SweepExpired(nowMS int64) {
	for {
		s.expMu.Lock()
		if s.exp.Len() == 0 {
			s.expMu.Unlock()
			break
		}
		top := s.exp[0]
		if top.ExpireAtMS > nowMS {
			s.expMu.Unlock()
			break
		}
		heap.Pop(&s.exp)
		s.expMu.Unlock()

		current, ok := s.store.get(top.Key)
		if !ok {
			continue
		}
		if current.Version != top.Version {
			continue
		}
		if current.ExpireAtMS <= nowMS {
			s.store.delete(top.Key)
			s.dirty.Store(true)
		}
	}

	s.leaseMu.Lock()
	s.sweepExpiredLeasesLocked(nowMS)
	s.leaseMu.Unlock()
}

func cloneLeaseInfo(src *LeaseInfo) *LeaseInfo {
	if src == nil {
		return nil
	}
	out := *src
	return &out
}

func (s *Service) sweepExpiredLeasesLocked(nowMS int64) {
	for leaseID, lease := range s.leases {
		if lease == nil || lease.ExpiresAtMS <= nowMS {
			delete(s.leases, leaseID)
		}
	}
}

func (s *Service) activeLeaseGroups(nowMS int64) map[string][]LeaseInfo {
	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	s.sweepExpiredLeasesLocked(nowMS)
	out := make(map[string][]LeaseInfo, len(s.leases))
	for _, lease := range s.leases {
		if lease == nil || lease.ExpiresAtMS <= nowMS || lease.CandidateKey == "" {
			continue
		}
		out[lease.CandidateKey] = append(out[lease.CandidateKey], *lease)
	}
	return out
}

func (s *Service) activeLeases(nowMS int64) []LeaseInfo {
	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	s.sweepExpiredLeasesLocked(nowMS)
	out := make([]LeaseInfo, 0, len(s.leases))
	for _, lease := range s.leases {
		if lease == nil || lease.ExpiresAtMS <= nowMS {
			continue
		}
		out = append(out, *lease)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ExpiresAtMS == out[j].ExpiresAtMS {
			return out[i].ClaimedAtMS > out[j].ClaimedAtMS
		}
		return out[i].ExpiresAtMS < out[j].ExpiresAtMS
	})
	return out
}

func (s *Service) countCandidateLeasesLocked(candidateKey string, owner ClaimOwner, nowMS int64) (int, bool) {
	count := 0
	ownerClaimed := false
	for _, lease := range s.leases {
		if lease == nil || lease.ExpiresAtMS <= nowMS || lease.CandidateKey != candidateKey {
			continue
		}
		count++
		if ownerMatches(*lease, owner) {
			ownerClaimed = true
		}
	}
	return count, ownerClaimed
}

func (s *Service) learningSnapshot() learningSnapshot {
	s.learningMu.RLock()
	defer s.learningMu.RUnlock()
	items := make([]LearningBucket, 0, len(s.learning))
	index := make(map[string]LearningBucket, len(s.learning))
	for key, bucket := range s.learning {
		if bucket == nil {
			continue
		}
		copyBucket := *bucket
		if copyBucket.Key == "" {
			copyBucket.Key = key
		}
		items = append(items, copyBucket)
		index[key] = copyBucket
	}
	return learningSnapshot{
		buckets: items,
		index:   index,
		summary: applyLearningSummaryWeights(summarizeLearningBuckets(items), s.cfg.LearningJoinWeight, s.cfg.LearningWinWeight),
	}
}

func buildTaskDebugSnapshot(all []Candidate, profile FilterProfile, nowMS int64, owner ClaimOwner, leaseGroups map[string][]LeaseInfo, leases []LeaseInfo, learningLookup LearningLookupFunc, leaseLimit int) TaskDebugSnapshot {
	summary := TaskDebugSummary{
		GeneratedAtMS:    nowMS,
		ActiveCandidates: len(all),
		LeaseCount:       len(leases),
	}

	if owner.ClientID != "" {
		for _, lease := range leases {
			if stringsTrim(lease.ClientID) == owner.ClientID {
				summary.ClientLeaseCount++
			}
			if ownerMatches(lease, owner) {
				summary.AccountLeaseCount++
			}
		}
	}

	validCount := 0
	availableCount := 0
	for i := range all {
		candidate := all[i]
		if candidate.ExpireAtMS > 0 && candidate.ExpireAtMS <= nowMS {
			continue
		}
		ok, _ := passFilter(candidate, profile, nowMS)
		if !ok {
			continue
		}
		validCount++
		scored := scoreCandidate(candidate, profile, nowMS, learningLookup)
		scored.MaxLeaseSlots = maxLeaseSlotsForCandidate(candidate, scored, profile.BigRedPacketThreshold)
		leaseCount := len(leaseGroups[candidate.Key])
		if scored.MaxLeaseSlots > 1 {
			summary.MultiSlotCandidates++
		}
		if leaseCount >= scored.MaxLeaseSlots {
			summary.SaturatedCandidates++
		}
		if leaseCount < scored.MaxLeaseSlots {
			availableCount++
		}
	}
	summary.ValidCandidates = validCount
	summary.AvailableCandidates = availableCount

	if leaseLimit <= 0 || leaseLimit > len(leases) {
		leaseLimit = len(leases)
	}
	snapshot := TaskDebugSnapshot{
		Summary: summary,
	}
	if leaseLimit > 0 {
		snapshot.Leases = make([]LeaseInfo, leaseLimit)
		copy(snapshot.Leases, leases[:leaseLimit])
	} else {
		snapshot.Leases = []LeaseInfo{}
	}
	return snapshot
}

func (s *Service) sweepExpiredScanClientsLocked(nowMS int64) {
	ttlMS := DefaultScanHeartbeatTTLMS
	for clientID, state := range s.scanClients {
		if state.UpdatedAtMS+ttlMS <= nowMS {
			delete(s.scanClients, clientID)
		}
	}
}

func (s *Service) activeScanClientStates(nowMS int64) map[string]scanClientState {
	s.scanClientMu.Lock()
	defer s.scanClientMu.Unlock()
	s.sweepExpiredScanClientsLocked(nowMS)
	out := make(map[string]scanClientState, len(s.scanClients))
	for clientID, state := range s.scanClients {
		out[clientID] = state
	}
	return out
}

func (s *Service) buildScanPoolSummary(nowMS int64) scanPoolSummary {
	s.RefreshTop(false)
	s.topMu.RLock()
	meta := s.topMeta
	s.topMu.RUnlock()
	leases := s.activeLeases(nowMS)
	return scanPoolSummary{
		ValidCandidates:     maxInt(meta.ValidCount, 0),
		AvailableCandidates: maxInt(meta.ValidCount-len(leases), 0),
		LeaseCount:          len(leases),
	}
}

func (s *Service) activeScanClientIDs(nowMS int64) []string {
	s.scanClientMu.Lock()
	defer s.scanClientMu.Unlock()
	s.sweepExpiredScanClientsLocked(nowMS)
	out := make([]string, 0, len(s.scanClients))
	for clientID := range s.scanClients {
		out = append(out, clientID)
	}
	sort.Strings(out)
	return out
}

// TopAvailable 方法：返回“当前可分配视角”的优选结果，可选择保留当前 owner 已持有的租约任务。
func (s *Service) TopAvailable(limit int, profile FilterProfile, owner ClaimOwner, includeClaimedSelf bool) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
	limit = normalizeTopLimit(limit, s.cfg.TopCacheMax)
	now := time.Now().UnixMilli()
	s.SweepExpired(now)
	all := s.store.snapshot()
	leaseGroups := s.activeLeaseGroups(now)
	learningSnapshot := s.learningSnapshot()
	out, validCount := selectTopCandidatesWithLease(all, profile, now, limit, leaseGroups, normalizeClaimOwner(owner), includeClaimedSelf, learningSnapshot.lookup)
	_, pv := s.Profile()
	return out, TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}, pv
}

func buildCandidateMap(all []Candidate) map[string]Candidate {
	out := make(map[string]Candidate, len(all))
	for _, candidate := range all {
		out[candidate.Key] = candidate
	}
	return out
}

func buildOrderedTaskCandidates(
	all []Candidate,
	profile FilterProfile,
	now int64,
	capSize int,
	leaseGroups map[string][]LeaseInfo,
	owner ClaimOwner,
	includeClaimedSelf bool,
	learningLookup LearningLookupFunc,
	preferKeys []string,
	excludeKeys []string,
) ([]ScoredCandidate, map[string]Candidate) {
	candidateMap := buildCandidateMap(all)
	scored, _ := selectTopCandidatesWithLease(all, profile, now, capSize, leaseGroups, owner, includeClaimedSelf, learningLookup)
	ordered := make([]ScoredCandidate, 0, len(scored))
	preferSet := make(map[string]struct{}, len(preferKeys))
	excludeSet := make(map[string]struct{}, len(excludeKeys))
	for _, key := range preferKeys {
		if trimmed := stringsTrim(key); trimmed != "" {
			preferSet[trimmed] = struct{}{}
		}
	}
	for _, key := range excludeKeys {
		if trimmed := stringsTrim(key); trimmed != "" {
			excludeSet[trimmed] = struct{}{}
		}
	}
	if len(preferSet) > 0 {
		for _, item := range scored {
			key := scoredCandidateKey(item)
			if _, blocked := excludeSet[key]; blocked {
				continue
			}
			if _, ok := preferSet[key]; ok {
				ordered = append(ordered, item)
			}
		}
	}
	for _, item := range scored {
		key := scoredCandidateKey(item)
		if _, blocked := excludeSet[key]; blocked {
			continue
		}
		if _, ok := preferSet[key]; ok {
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
	return append(preferredItems, regularItems...), candidateMap
}

// ClaimTask 方法：按 owner 和过滤条件从当前候选池中领取一个未被占用的任务。
func (s *Service) ClaimTask(options ClaimOptions) (ClaimResult, error) {
	now := time.Now().UnixMilli()
	s.SweepExpired(now)
	owner := normalizeClaimOwner(options.Owner)
	leaseSec := normalizeLeaseSec(options.LeaseSec)

	profile := options.Profile
	_, pv := s.Profile()
	all := s.store.snapshot()
	leaseGroups := s.activeLeaseGroups(now)
	learningSnapshot := s.learningSnapshot()
	ordered, _ := buildOrderedTaskCandidates(
		all,
		profile,
		now,
		s.cfg.TopCacheMax,
		leaseGroups,
		ClaimOwner{},
		false,
		learningSnapshot.lookup,
		options.PreferKeys,
		options.ExcludeKeys,
	)
	exclude := make(map[string]struct{}, len(options.ExcludeKeys))
	for _, key := range options.ExcludeKeys {
		if trimmed := stringsTrim(key); trimmed != "" {
			exclude[trimmed] = struct{}{}
		}
	}

	for _, item := range ordered {
		key := scoredCandidateKey(item)
		if key == "" {
			continue
		}
		if _, blocked := exclude[key]; blocked {
			continue
		}

		s.leaseMu.Lock()
		s.sweepExpiredLeasesLocked(now)
		leaseCount, ownerAlreadyClaimed := s.countCandidateLeasesLocked(key, owner, now)
		if ownerAlreadyClaimed || leaseCount >= item.MaxLeaseSlots {
			s.leaseMu.Unlock()
			continue
		}

		leaseID := "lease-" + strconv.FormatInt(s.seq.Add(1), 10)
		lease := &LeaseInfo{
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
		s.leases[leaseID] = lease
		s.leaseMu.Unlock()

		item.Claimed = true
		item.Lease = cloneLeaseInfo(lease)
		item.LeaseCount = leaseCount + 1
		item.AvailableSlots = maxInt(item.MaxLeaseSlots-item.LeaseCount, 0)
		return ClaimResult{
			Claimed:        true,
			Item:           &item,
			Lease:          cloneLeaseInfo(lease),
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

// ReviewTask 方法：在预热阶段执行服务端临开奖再重排，输出 keep/switch/drop 建议。
func (s *Service) ReviewTask(options ReviewOptions) (ReviewResult, error) {
	now := time.Now().UnixMilli()
	s.SweepExpired(now)
	owner := normalizeClaimOwner(options.Owner)
	stage := normalizeReviewStage(options.Stage, 0)
	_, pv := s.Profile()
	all := s.store.snapshot()
	leaseGroups := s.activeLeaseGroups(now)
	learningSnapshot := s.learningSnapshot()
	limit := normalizeTopLimit(options.Limit, 24)

	ordered, candidateMap := buildOrderedTaskCandidates(
		all,
		options.Profile,
		now,
		s.cfg.TopCacheMax,
		leaseGroups,
		owner,
		true,
		learningSnapshot.lookup,
		[]string{options.CurrentCandidateKey},
		options.ExcludeKeys,
	)
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

	currentKey := stringsTrim(options.CurrentCandidateKey)
	currentRoomID := stringsTrim(options.CurrentRoomID)
	reviewed := rankReviewCandidates(ordered, candidateMap, now, stage, currentKey, currentRoomID, limit)
	var currentItem *ScoredCandidate
	for idx := range reviewed {
		item := reviewed[idx]
		if currentKey != "" && item.Key == currentKey {
			copyItem := item
			currentItem = &copyItem
			break
		}
		if currentItem == nil && currentRoomID != "" && item.RoomID == currentRoomID {
			copyItem := item
			currentItem = &copyItem
		}
	}

	bestItem := reviewed[0]
	decision, reason := decideReviewSwitch(currentItem, &bestItem, stage, currentRoomID)
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

// RenewTaskLease 方法：续约当前任务租约，避免预热阶段被其他客户端抢占。
func (s *Service) RenewTaskLease(owner ClaimOwner, leaseID string, leaseSec int64) (*LeaseInfo, bool, error) {
	now := time.Now().UnixMilli()
	owner = normalizeClaimOwner(owner)
	leaseSec = normalizeLeaseSec(leaseSec)

	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	s.sweepExpiredLeasesLocked(now)

	lease, ok := s.leases[stringsTrim(leaseID)]
	if !ok || lease == nil {
		return nil, false, nil
	}
	if !ownerMatches(*lease, owner) {
		return nil, false, nil
	}
	lease.UpdatedAtMS = now
	lease.ExpiresAtMS = now + leaseSec*1000
	return cloneLeaseInfo(lease), true, nil
}

// ReleaseTaskLease 方法：主动释放当前任务租约，使候选回到服务端池中。
func (s *Service) ReleaseTaskLease(owner ClaimOwner, leaseID string, reason string) (bool, error) {
	now := time.Now().UnixMilli()
	owner = normalizeClaimOwner(owner)

	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	s.sweepExpiredLeasesLocked(now)

	lease, ok := s.leases[stringsTrim(leaseID)]
	if !ok || lease == nil || !ownerMatches(*lease, owner) {
		return false, nil
	}
	lease.Reason = reason
	delete(s.leases, lease.LeaseID)
	return true, nil
}

// FinishTaskLease 方法：标记任务已执行完成，并按需要从候选池移除。
func (s *Service) FinishTaskLease(owner ClaimOwner, leaseID string, result string, removeCandidate bool) (bool, error) {
	now := time.Now().UnixMilli()
	owner = normalizeClaimOwner(owner)

	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	s.sweepExpiredLeasesLocked(now)

	lease, ok := s.leases[stringsTrim(leaseID)]
	if !ok || lease == nil || !ownerMatches(*lease, owner) {
		return false, nil
	}
	lease.Result = result
	delete(s.leases, lease.LeaseID)
	if removeCandidate {
		s.store.delete(lease.CandidateKey)
		s.dirty.Store(true)
	}
	return true, nil
}

// ScanPermit 方法：为全站/分类/详情扫描请求发放集群级硬限流许可证。
func (s *Service) ScanPermit(options ScanPermitOptions) (ScanPermitResult, error) {
	now := time.Now().UnixMilli()
	normalized := normalizeScanPermitOptions(options)
	activeStates := s.activeScanClientStates(now)
	refillPerSec, burst, clusterRiskLevel, clusterRiskScore := buildScanPermitPolicy(normalized.Kind, activeStates, s.buildScanPoolSummary(now))

	s.scanPermitMu.Lock()
	state := s.scanPermits[normalized.Kind]
	nextState, result := applyScanPermitState(state, normalized, now, refillPerSec, burst, clusterRiskLevel, clusterRiskScore)
	s.scanPermits[normalized.Kind] = nextState
	s.scanPermitMu.Unlock()

	return result, nil
}

// ClaimAllScanCursor 方法：领取当前共享全站 maxTime 游标，避免多个客户端从头重复扫描。
func (s *Service) ClaimAllScanCursor(options AllScanClaimOptions) (AllScanClaimResult, error) {
	now := time.Now().UnixMilli()
	s.allScanMu.Lock()
	defer s.allScanMu.Unlock()
	nextState, result := claimAllScanCursorState(s.allScanCursor, options, now)
	s.allScanCursor = nextState
	return result, nil
}

// ReportAllScanCursor 方法：回传本次全站扫描推进结果，更新共享 maxTime 游标链路。
func (s *Service) ReportAllScanCursor(options AllScanReportOptions) (AllScanReportResult, error) {
	now := time.Now().UnixMilli()
	s.allScanMu.Lock()
	defer s.allScanMu.Unlock()
	nextState, result := reportAllScanCursorState(s.allScanCursor, options, now)
	s.allScanCursor = nextState
	return result, nil
}

// ScanAssignment 方法：更新客户端扫描心跳与风控遥测，并返回服务端分配的扫描分片与预算。
func (s *Service) ScanAssignment(clientID string, categoryIDs []string, telemetry ScanTelemetry) (ScanAssignment, error) {
	now := time.Now().UnixMilli()
	normalizedClientID := stringsTrim(clientID)
	if normalizedClientID == "" {
		return ScanAssignment{}, errors.New("clientId is required")
	}

	s.scanClientMu.Lock()
	s.scanClients[normalizedClientID] = scanClientState{
		ClientID:    normalizedClientID,
		UpdatedAtMS: now,
		Telemetry:   normalizeScanTelemetry(telemetry),
	}
	s.sweepExpiredScanClientsLocked(now)
	activeStates := make(map[string]scanClientState, len(s.scanClients))
	for item, state := range s.scanClients {
		activeStates[item] = state
	}
	s.scanClientMu.Unlock()

	return buildScanAssignment(normalizedClientID, activeStates, categoryIDs, now, DefaultScanHeartbeatTTLMS, s.buildScanPoolSummary(now)), nil
}

// TaskDebug 方法：返回当前共享池和租约的调试快照，便于前端观察服务端分配状态。
func (s *Service) TaskDebug(profile FilterProfile, owner ClaimOwner, leaseLimit int) (TaskDebugSnapshot, int64) {
	now := time.Now().UnixMilli()
	s.SweepExpired(now)
	all := s.store.snapshot()
	leases := s.activeLeases(now)
	leaseGroups := buildLeaseGroupMap(leases)
	learningSnapshot := s.learningSnapshot()
	_, pv := s.Profile()
	return buildTaskDebugSnapshot(all, profile, now, normalizeClaimOwner(owner), leaseGroups, leases, learningSnapshot.lookup, leaseLimit), pv
}

// RefreshTop 方法：刷新优选结果。
func (s *Service) RefreshTop(force bool) {
	now := time.Now().UnixMilli()
	if !force && !s.dirty.Load() && now-s.topMeta.BuiltAtMS < s.cfg.TopRefreshMS {
		return
	}

	s.SweepExpired(now)
	profile, _ := s.Profile()
	all := s.store.snapshot()
	capSize := s.cfg.TopCacheMax
	if capSize <= 0 {
		capSize = 2500
	}
	learningSnapshot := s.learningSnapshot()
	out, validCount := selectTopCandidatesWithLease(all, profile, now, capSize, nil, ClaimOwner{}, false, learningSnapshot.lookup)

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
func (s *Service) Top(limit int) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
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
func (s *Service) TopWithProfile(limit int, profile FilterProfile) (items []ScoredCandidate, meta TopMeta, profileVersion int64) {
	limit = normalizeTopLimit(limit, s.cfg.TopCacheMax)
	now := time.Now().UnixMilli()
	s.SweepExpired(now)
	all := s.store.snapshot()
	learningSnapshot := s.learningSnapshot()
	out, validCount := selectTopCandidatesWithLease(all, profile, now, limit, nil, ClaimOwner{}, false, learningSnapshot.lookup)
	_, pv := s.Profile()
	return out, TopMeta{
		BuiltAtMS:   now,
		ActiveCount: len(all),
		ValidCount:  validCount,
	}, pv
}

// RecordTaskFeedback 方法：接收执行侧反馈并更新学习桶。
func (s *Service) RecordTaskFeedback(feedback TaskFeedback) error {
	normalized := normalizeTaskFeedback(feedback)
	if normalized.Event == "" {
		return nil
	}
	bucketKey := buildLearningBucketKey(normalized)
	now := time.Now().UnixMilli()

	s.learningMu.Lock()
	bucket, ok := s.learning[bucketKey]
	if !ok || bucket == nil {
		next := newLearningBucketFromFeedback(normalized, bucketKey)
		bucket = &next
		s.learning[bucketKey] = bucket
	}
	applyTaskFeedback(bucket, normalized, now)
	s.learningMu.Unlock()
	s.dirty.Store(true)
	if err := appendFeedbackJSONL(s.cfg.FeedbackLogPath, normalized); err != nil {
		return err
	}
	return nil
}

// LearningDebug 方法：输出当前学习桶快照与校准摘要，便于观察学习闭环是否生效。
func (s *Service) LearningDebug(limit int) (LearningDebugSnapshot, error) {
	snapshot := s.learningSnapshot()
	items := make([]LearningBucket, 0, len(snapshot.buckets))
	items = append(items, snapshot.buckets...)
	return LearningDebugSnapshot{
		Summary: snapshot.summary,
		Items:   sortLearningBuckets(items, limit),
	}, nil
}

// Stats 方法：处理统计。
func (s *Service) Stats() (Stats, TopMeta, int64) {
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
func (s *Service) Close() error {
	return nil
}

// normalizeCandidate 方法：归一化候选项。
func normalizeCandidate(raw map[string]any, sourceID string, nowMS int64) (Candidate, error) {
	roomID := firstNonEmpty(
		asString(raw["roomId"]),
		asString(raw["room_id"]),
	)
	webRid := firstNonEmpty(
		asString(raw["webRid"]),
		asString(raw["web_rid"]),
		roomID,
	)
	lotteryID := firstNonEmpty(
		asString(raw["lotteryId"]),
		asString(raw["lottery_id"]),
		asString(raw["lottery_id_str"]),
	)
	endMS := normalizeTimeMS(firstAny(raw["endTime"], raw["end_time"], raw["drawTime"], raw["draw_time"]))
	startMS := normalizeTimeMS(firstAny(raw["startTime"], raw["start_time"]))
	fetchedMS := normalizeTimeMS(firstAny(raw["fetchedAt"], raw["fetched_at"]))
	if fetchedMS <= 0 {
		fetchedMS = nowMS
	}
	if roomID == "" || lotteryID == "" || endMS <= 0 {
		return Candidate{}, errors.New("missing required fields")
	}

	conditions := parseConditions(raw["conditions"])
	prizeInfo := asMap(firstAny(raw["prizeInfo"], raw["prize_info"]))
	lotteryName := firstNonEmpty(
		asString(raw["lotteryName"]),
		asString(raw["prize_name"]),
		asString(prizeInfo["name"]),
	)

	c := Candidate{
		Key:            roomID + ":" + lotteryID,
		RoomID:         roomID,
		WebRid:         webRid,
		LotteryID:      lotteryID,
		Conditions:     conditions,
		JoinTotal:      asFloat(firstAny(raw["joinTotal"], raw["candidate_num"]), 0),
		LuckyCount:     asFloat(firstAny(raw["luckyCount"], raw["winningTotal"], raw["lucky_count"]), 0),
		LotteryTotal:   asFloat(firstAny(raw["lotteryTotal"], raw["prize_count"]), 0),
		OnlineTotal:    asFloat(firstAny(raw["onlineTotal"], raw["user_count"]), 0),
		LotteryName:    lotteryName,
		PrizeInfo:      prizeInfo,
		PrizeType:      firstAny(raw["prizeType"], prizeInfo["type"], prizeInfo["prize_type"]),
		TotalAmount:    asFloat(firstAny(raw["total_amount"], raw["totalAmount"], prizeInfo["total_amount"]), 0),
		EndTimeMS:      endMS,
		StartTimeMS:    startMS,
		FetchedAtMS:    fetchedMS,
		SourceID:       firstNonEmpty(sourceID, asString(raw["sourceId"]), asString(raw["source"])),
		AuthorNickname: asString(raw["authorNickname"]),
		RoomTitle:      asString(raw["roomTitle"]),
		RiskScore:      asFloat(raw["riskScore"], 0),
	}
	return c, nil
}

// parseConditions 方法：解析参与条件。
func parseConditions(v any) []Condition {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]Condition, 0, len(arr))
	for _, x := range arr {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, Condition{
			Type:    int(asFloat(firstAny(m["type"]), 0)),
			Content: asString(m["content"]),
			Desc: firstNonEmpty(
				asString(m["desc"]),
				asString(m["description"]),
				asString(m["title"]),
				asString(m["text"]),
				asString(m["name"]),
			),
		})
	}
	return out
}

// passFilter 方法：处理过滤条件。
func passFilter(c Candidate, p FilterProfile, nowMS int64) (bool, string) {
	remainingSec := (c.EndTimeMS - nowMS) / 1000
	if remainingSec < p.MinRemainingSec {
		return false, "remaining_too_short"
	}
	if remainingSec > p.MaxRemainingSec {
		return false, "remaining_too_long"
	}

	if p.RequireType3And6 {
		has3 := false
		has6 := false
		for _, cond := range c.Conditions {
			if cond.Type == 3 {
				has3 = true
			}
			if cond.Type == 6 {
				has6 = true
			}
		}
		if !(has3 && has6) {
			return false, "condition_not_match"
		}
	}

	if hasMemberJoinRequirement(c.Conditions) {
		return false, "member_required"
	}

	if p.FilterFanClub && hasFanClubJoinRequirement(c.Conditions) {
		return false, "fanclub_required"
	}

	if p.OnlyPhysicalPrize && !isPhysicalPrize(c) {
		return false, "not_physical"
	}

	if p.MaxOnlineTotal > 0 && c.OnlineTotal > p.MaxOnlineTotal {
		return false, "online_too_high"
	}

	_, predictedProb := predictFinalJoinAndProbability(c, nowMS)
	if predictedProb < p.MinProbability {
		return false, "probability_too_low"
	}
	return true, ""
}

// hasFanClubJoinRequirement 方法：判断参与条件中是否包含粉丝团要求。
func hasFanClubJoinRequirement(conditions []Condition) bool {
	for _, c := range conditions {
		if c.Type == 2 {
			return true
		}
		textRaw := strings.Join([]string{c.Content, c.Desc}, " ")
		textLower := strings.ToLower(textRaw)
		if fanClubJoinRE.MatchString(textRaw) {
			return true
		}
		if strings.Contains(textLower, "fans") || strings.Contains(textLower, "fanclub") {
			return true
		}
	}
	return false
}

// hasMemberJoinRequirement 方法：判断参与条件中是否包含会员要求。
func hasMemberJoinRequirement(conditions []Condition) bool {
	for _, c := range conditions {
		textRaw := strings.Join([]string{c.Content, c.Desc}, " ")
		textLower := strings.ToLower(textRaw)
		if memberJoinRE.MatchString(textRaw) {
			return true
		}
		if strings.Contains(textLower, "member_only") || strings.Contains(textLower, "subscriber") || strings.Contains(textLower, "subscription") {
			return true
		}
	}
	return false
}

// isPhysicalPrize 方法：判断候选福袋是否属于实物奖品。
func isPhysicalPrize(c Candidate) bool {
	for _, v := range []any{c.PrizeType, c.PrizeInfo["type"], c.PrizeInfo["prize_type"]} {
		if v == nil {
			continue
		}
		if n, ok := toFloat(v); ok {
			if n == 3 {
				return true
			}
			if n == 1 || n == 2 || n == 4 {
				return false
			}
		}
		t := fmt.Sprint(v)
		if strings.Contains(strings.ToLower(t), "physical") || strings.Contains(t, "实物") {
			return true
		}
		if strings.Contains(strings.ToLower(t), "diamond") || strings.Contains(strings.ToLower(t), "virtual") {
			return false
		}
	}
	name := strings.TrimSpace(strings.Join([]string{
		c.LotteryName,
		asString(c.PrizeInfo["name"]),
	}, " "))
	if name == "" {
		return false
	}
	if virtualNameRE.MatchString(name) && !physicalNameRE.MatchString(name) {
		return false
	}
	return physicalNameRE.MatchString(name)
}

// scoreCandidate 方法：计算候选项。
func scoreCandidate(c Candidate, p FilterProfile, nowMS int64, learningLookup LearningLookupFunc) ScoredCandidate {
	nowSec := float64(nowMS) / 1000
	endSec := float64(c.EndTimeMS) / 1000
	remainingSec := maxFloat(0, endSec-nowSec)

	currentProb := 0.0
	if c.JoinTotal > 0 {
		currentProb = c.LuckyCount / c.JoinTotal
	}
	predictedJoinTotal, predictedProb := predictFinalJoinAndProbability(c, nowMS)

	timeFactor := 0.2
	if remainingSec >= 35 && remainingSec <= 120 {
		timeFactor = 1
	} else if remainingSec > 120 && remainingSec <= 220 {
		timeFactor = 0.6
	} else if remainingSec >= 25 && remainingSec < 35 {
		timeFactor = 0.45
	}

	crowdPenalty := math.Min(math.Log10(math.Max(c.JoinTotal, 1))/4, 1)
	onlinePenalty := math.Min(math.Log10(math.Max(c.OnlineTotal, 1))/5, 1)
	rewardBonus := math.Min(c.LuckyCount/80, 1)

	redInfo := redPacketInfo(c, p.BigRedPacketThreshold)
	bigRedPacketBonus := 0.0
	if p.PreferBigRedPacket {
		if redInfo.IsBig {
			bigRedPacketBonus = 18
		} else if redInfo.IsRedPacket && redInfo.Known {
			bigRedPacketBonus = -4
		}
	}
	riskPenalty := math.Min(math.Max(c.RiskScore, 0), 1) * 8

	score := predictedProb*100*0.62 +
		timeFactor*100*0.2 +
		rewardBonus*100*0.12 -
		crowdPenalty*100*0.04 -
		onlinePenalty*100*0.02 +
		bigRedPacketBonus -
		riskPenalty
	learningBoost, learningBucket := learningMultiplierForCandidate(c, p, nowMS, learningLookup)
	boostedScore := score * learningBoost

	return ScoredCandidate{
		Key:                c.Key,
		RoomID:             c.RoomID,
		WebRid:             c.WebRid,
		LotteryID:          c.LotteryID,
		LotteryName:        c.LotteryName,
		Score:              round(boostedScore, 4),
		ReviewScore:        round(boostedScore, 4),
		Probability:        round(predictedProb*100, 4),
		CurrentProbability: round(currentProb*100, 4),
		PredictedJoinTotal: round(predictedJoinTotal, 2),
		EVScore:            round(score, 4),
		LearningBoost:      round(learningBoost, 4),
		LearningBucket:     learningBucket,
		RemainingSec:       int64(remainingSec),
		JoinTotal:          c.JoinTotal,
		LuckyCount:         c.LuckyCount,
		LotteryTotal:       c.LotteryTotal,
		OnlineTotal:        c.OnlineTotal,
		Conditions:         c.Conditions,
		PrizeType:          c.PrizeType,
		PrizeInfo:          c.PrizeInfo,
		TotalAmount:        c.TotalAmount,
		RedPacketInfo:      redInfo,
		SourceID:           c.SourceID,
		FetchedAt:          c.FetchedAtMS,
		EndTime:            c.EndTimeMS,
		StartTime:          c.StartTimeMS,
		AuthorNickname:     c.AuthorNickname,
		RoomTitle:          c.RoomTitle,
	}
}

// predictFinalJoinAndProbability 方法：估算开奖前最终参与人数和预测概率，降低尾盘涌入带来的误判。
func predictFinalJoinAndProbability(c Candidate, nowMS int64) (float64, float64) {
	currentPeople := math.Max(c.JoinTotal, 0)
	bagCount := math.Max(c.LuckyCount, 0)
	onlinePeople := math.Max(c.OnlineTotal, 0)
	endSec := float64(c.EndTimeMS) / 1000
	startSec := float64(c.StartTimeMS) / 1000
	nowSec := float64(nowMS) / 1000

	totalDuration := endSec - startSec
	if totalDuration <= 0 {
		totalDuration = 300
	}
	remainingTime := math.Max(0, endSec-nowSec)
	if totalDuration < 60 {
		totalDuration = 60
	}

	isNearEnd := totalDuration > 0 && (remainingTime/totalDuration) <= 0.2
	baseFinalPeople := currentPeople
	if !isNearEnd {
		elapsedTime := totalDuration - remainingTime
		elapsedRatio := 0.0
		if totalDuration > 0 {
			elapsedRatio = elapsedTime / totalDuration
		}
		growth := 1 - math.Pow(1-elapsedRatio, 2)
		baseRatio := 0.2
		if elapsedRatio > 0 {
			baseRatio = growth
		}
		if baseRatio < 0.08 {
			baseRatio = 0.08
		}
		baseFinalPeople = math.Ceil(currentPeople / baseRatio)
	}

	saturationCap := math.Ceil(onlinePeople * 0.85)
	if saturationCap <= 0 {
		saturationCap = currentPeople
	}
	if saturationCap > 0 {
		baseFinalPeople = math.Min(baseFinalPeople, saturationCap)
	}

	potentialNewPeople := 0.0
	if !isNearEnd {
		remainingMinutes := remainingTime / 60
		timeDecayRatio := 0.0
		if totalDuration > 0 {
			timeDecayRatio = remainingTime / totalDuration
		}
		totalMinutes := totalDuration / 60
		convertRatio := 0.4 - totalMinutes*0.01
		if convertRatio < 0.1 {
			convertRatio = 0.1
		}
		if convertRatio > 0.35 {
			convertRatio = 0.35
		}
		elapsedTime := totalDuration - remainingTime
		stageDecayFactor := 1.0
		if elapsedTime > 3*60 && elapsedTime <= 6*60 {
			stageDecayFactor = 0.2
		} else if elapsedTime > 6*60 {
			stageDecayFactor = 0.05
		}
		convertRatio *= stageDecayFactor
		maxPotential := currentPeople * 0.5
		potentialNewPeople = math.Min(math.Ceil(onlinePeople*convertRatio*remainingMinutes*timeDecayRatio), maxPotential)
	}

	finalPeople := math.Max(baseFinalPeople+potentialNewPeople, currentPeople)
	if saturationCap > 0 {
		finalPeople = math.Min(finalPeople, saturationCap)
	}
	if finalPeople <= 0 {
		finalPeople = currentPeople
	}
	if finalPeople <= 0 {
		finalPeople = 1
	}
	probability := 0.0
	if bagCount > 0 && finalPeople > 0 {
		probability = math.Min(bagCount/finalPeople, 1)
	}
	return finalPeople, probability
}

type RedPacketInfo struct {
	IsRedPacket  bool    `json:"isRedPacket"`
	Known        bool    `json:"known"`
	AvgPerWinner float64 `json:"avgPerWinner"`
	TotalValue   float64 `json:"totalValue"`
	IsBig        bool    `json:"isBig"`
}

// redPacketInfo 方法：提取并计算红包类福袋的人均金额与大包标记。
func redPacketInfo(c Candidate, threshold float64) RedPacketInfo {
	if isPhysicalPrize(c) {
		return RedPacketInfo{}
	}
	winners := c.LuckyCount
	name := c.LotteryName + " " + asString(c.PrizeInfo["name"])
	isRedLike := redpackNameRE.MatchString(name)
	if winners <= 0 {
		return RedPacketInfo{IsRedPacket: isRedLike}
	}

	total := firstFinite(
		c.TotalAmount,
		asFloat(c.PrizeInfo["total_amount"], 0),
		asFloat(c.PrizeInfo["totalAmount"], 0),
		asFloat(c.PrizeInfo["total_diamond_count"], 0),
		asFloat(c.PrizeInfo["total_coin_count"], 0),
		asFloat(c.PrizeInfo["diamond_count_total"], 0),
	)
	if total <= 0 {
		unit := firstFinite(
			asFloat(c.PrizeInfo["diamond_count"], 0),
			asFloat(c.PrizeInfo["coin_count"], 0),
			asFloat(c.PrizeInfo["amount"], 0),
			asFloat(c.PrizeInfo["value"], 0),
		)
		if unit > 0 && c.LotteryTotal > 0 {
			total = unit * c.LotteryTotal
		}
	}
	if total <= 0 {
		if m := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(抖币|钻石|元)`).FindStringSubmatch(name); len(m) == 3 {
			total, _ = strconv.ParseFloat(m[1], 64)
		}
	}
	if total <= 0 {
		return RedPacketInfo{
			IsRedPacket: isRedLike,
			Known:       false,
		}
	}
	avg := total / winners
	return RedPacketInfo{
		IsRedPacket:  isRedLike || total > 0,
		Known:        true,
		AvgPerWinner: avg,
		TotalValue:   total,
		IsBig:        avg >= threshold,
	}
}

// normalizeTimeMS 方法：归一化时间。
func normalizeTimeMS(v any) int64 {
	x, ok := toFloat(v)
	if !ok {
		return 0
	}
	if x > 1e12 {
		return int64(x)
	}
	if x > 1e10 {
		return int64(x)
	}
	return int64(x * 1000)
}

// firstAny 方法：处理首个值。
func firstAny(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

// asMap 方法：处理映射。
func asMap(v any) map[string]any {
	if v == nil {
		return map[string]any{}
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// asString 方法：处理字符串。
func asString(v any) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

// asBool 方法：处理布尔值。
func asBool(v any, fallback bool) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		x = strings.TrimSpace(strings.ToLower(x))
		if x == "1" || x == "true" || x == "yes" || x == "on" {
			return true
		}
		if x == "0" || x == "false" || x == "no" || x == "off" {
			return false
		}
	}
	return fallback
}

// toFloat 方法：将输入转换为浮点数。
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case nil:
		return 0, false
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	case uint64:
		return float64(x), true
	case uint32:
		return float64(x), true
	case json.Number:
		n, err := x.Float64()
		return n, err == nil
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0, false
		}
		n, err := strconv.ParseFloat(s, 64)
		return n, err == nil
	default:
		return 0, false
	}
}

// asFloat 方法：处理浮点数。
func asFloat(v any, fallback float64) float64 {
	if n, ok := toFloat(v); ok {
		return n
	}
	return fallback
}

// firstFinite 方法：处理首个值有限值。
func firstFinite(vals ...float64) float64 {
	for _, v := range vals {
		if !math.IsNaN(v) && !math.IsInf(v, 0) && v > 0 {
			return v
		}
	}
	return 0
}

// firstNonEmpty 方法：处理首个值空值。
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// maxFloat 方法：处理最大值浮点数。
func maxFloat(a, b float64) float64 {
	if a >= b {
		return a
	}
	return b
}

// maxInt 方法：返回两个整数中的较大值。
func maxInt(a, b int) int {
	if a >= b {
		return a
	}
	return b
}

// minInt 方法：返回两个整数中的较小值。
func minInt(a, b int) int {
	if a <= b {
		return a
	}
	return b
}

// round 方法：处理轮次。
func round(v float64, n int) float64 {
	pow := math.Pow(10, float64(n))
	return math.Round(v*pow) / pow
}
