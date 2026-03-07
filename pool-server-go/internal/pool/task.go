package pool

type ClaimOwner struct {
	ClientID  string `json:"clientId"`
	AccountID string `json:"accountId"`
}

type LeaseInfo struct {
	LeaseID      string `json:"leaseId"`
	CandidateKey string `json:"candidateKey"`
	RoomID       string `json:"roomId"`
	LotteryID    string `json:"lotteryId"`
	ClientID     string `json:"clientId"`
	AccountID    string `json:"accountId"`
	SlotLimit    int    `json:"slotLimit,omitempty"`
	ClaimedAtMS  int64  `json:"claimedAt"`
	UpdatedAtMS  int64  `json:"updatedAt"`
	ExpiresAtMS  int64  `json:"expiresAt"`
	Reason       string `json:"reason,omitempty"`
	Result       string `json:"result,omitempty"`
}

type ClaimOptions struct {
	Owner       ClaimOwner
	LeaseSec    int64
	Profile     FilterProfile
	PreferKeys  []string
	ExcludeKeys []string
}

type ClaimResult struct {
	Claimed        bool             `json:"claimed"`
	Reason         string           `json:"reason,omitempty"`
	Item           *ScoredCandidate `json:"item,omitempty"`
	Lease          *LeaseInfo       `json:"lease,omitempty"`
	ProfileVersion int64            `json:"profileVersion"`
	GeneratedAtMS  int64            `json:"generatedAt"`
}

type ReviewOptions struct {
	Owner               ClaimOwner
	Profile             FilterProfile
	CurrentCandidateKey string
	CurrentRoomID       string
	ExcludeKeys         []string
	Stage               string
	Limit               int
}

type ReviewResult struct {
	Reviewed       bool              `json:"reviewed"`
	Stage          string            `json:"stage"`
	Decision       string            `json:"decision"`
	Reason         string            `json:"reason,omitempty"`
	Item           *ScoredCandidate  `json:"item,omitempty"`
	Current        *ScoredCandidate  `json:"current,omitempty"`
	Alternatives   []ScoredCandidate `json:"alternatives,omitempty"`
	ProfileVersion int64             `json:"profileVersion"`
	GeneratedAtMS  int64             `json:"generatedAt"`
}

type TaskFeedback struct {
	Owner                ClaimOwner        `json:"owner"`
	Event                string            `json:"event"`
	CandidateKey         string            `json:"candidateKey"`
	RoomID               string            `json:"roomId"`
	LotteryID            string            `json:"lotteryId"`
	LotteryName          string            `json:"lotteryName"`
	AuthorNickname       string            `json:"authorNickname,omitempty"`
	Conditions           []Condition       `json:"conditions,omitempty"`
	JoinTotal            float64           `json:"joinTotal,omitempty"`
	LuckyCount           float64           `json:"luckyCount,omitempty"`
	OnlineTotal          float64           `json:"onlineTotal,omitempty"`
	TotalAmount          float64           `json:"totalAmount,omitempty"`
	PrizeType            any               `json:"prizeType,omitempty"`
	PrizeInfo            map[string]any    `json:"prizeInfo,omitempty"`
	PredictedProbability float64           `json:"predictedProbability,omitempty"`
	PredictedJoinTotal   float64           `json:"predictedJoinTotal,omitempty"`
	RemainingSec         int64             `json:"remainingSec,omitempty"`
	EndTimeMS            int64             `json:"endTime,omitempty"`
	StartTimeMS          int64             `json:"startTime,omitempty"`
	JoinedAtMS           int64             `json:"joinedAt,omitempty"`
	RewardAmount         float64           `json:"rewardAmount,omitempty"`
	JoinMode             string            `json:"joinMode,omitempty"`
	Reason               string            `json:"reason,omitempty"`
	Extra                map[string]string `json:"extra,omitempty"`
}

type LearningBucket struct {
	Key           string  `json:"key"`
	PrizeClass    string  `json:"prizeClass,omitempty"`
	RemainBucket  string  `json:"remainBucket,omitempty"`
	ProbBucket    string  `json:"probBucket,omitempty"`
	OnlineBucket  string  `json:"onlineBucket,omitempty"`
	CrowdBucket   string  `json:"crowdBucket,omitempty"`
	FeedbackCount int64   `json:"feedbackCount"`
	JoinSuccess   int64   `json:"joinSuccess"`
	JoinFailed    int64   `json:"joinFailed"`
	DrawWon       int64   `json:"drawWon"`
	DrawLost      int64   `json:"drawLost"`
	ExpectedWins  float64 `json:"expectedWins"`
	ActualWins    float64 `json:"actualWins"`
	RewardSum     float64 `json:"rewardSum"`
	UpdatedAtMS   int64   `json:"updatedAt"`
}

type LearningSummary struct {
	BucketCount           int     `json:"bucketCount"`
	FeedbackCount         int64   `json:"feedbackCount"`
	JoinSuccess           int64   `json:"joinSuccess"`
	JoinFailed            int64   `json:"joinFailed"`
	DrawWon               int64   `json:"drawWon"`
	DrawLost              int64   `json:"drawLost"`
	ExpectedWins          float64 `json:"expectedWins"`
	ActualWins            float64 `json:"actualWins"`
	RewardSum             float64 `json:"rewardSum"`
	CalibrationConfidence float64 `json:"calibrationConfidence"`
	JoinWeight            float64 `json:"joinWeight"`
	WinWeight             float64 `json:"winWeight"`
	GlobalJoinSuccessRate float64 `json:"globalJoinSuccessRate"`
	GlobalWinLift         float64 `json:"globalWinLift"`
}

type LearningDebugSnapshot struct {
	Summary LearningSummary  `json:"summary"`
	Items   []LearningBucket `json:"items"`
}

type ScanPermitOptions struct {
	ClientID  string `json:"clientId"`
	AccountID string `json:"accountId"`
	Kind      string `json:"kind"`
	Cost      int    `json:"cost"`
}

type ScanPermitResult struct {
	Allowed          bool    `json:"allowed"`
	Kind             string  `json:"kind"`
	Cost             int     `json:"cost"`
	RetryAfterMS     int64   `json:"retryAfterMs"`
	TokensLeft       float64 `json:"tokensLeft"`
	Burst            float64 `json:"burst"`
	RefillPerSec     float64 `json:"refillPerSec"`
	ClusterRiskLevel int     `json:"clusterRiskLevel"`
	ClusterRiskScore float64 `json:"clusterRiskScore"`
	GeneratedAtMS    int64   `json:"generatedAt"`
	Reason           string  `json:"reason,omitempty"`
}

type AllScanClaimOptions struct {
	ClientID   string `json:"clientId"`
	AccountID  string `json:"accountId"`
	LeaseTTLMS int64  `json:"leaseTtlMs"`
}

type AllScanClaimResult struct {
	Claimed       bool   `json:"claimed"`
	SlotID        string `json:"slotId,omitempty"`
	CursorMaxTime int64  `json:"cursorMaxTime"`
	Depth         int    `json:"depth"`
	Cycle         int    `json:"cycle"`
	RetryAfterMS  int64  `json:"retryAfterMs"`
	LeaseTTLMS    int64  `json:"leaseTtlMs"`
	FromHead      bool   `json:"fromHead"`
	GeneratedAtMS int64  `json:"generatedAt"`
	Reason        string `json:"reason,omitempty"`
}

type AllScanReportOptions struct {
	ClientID          string `json:"clientId"`
	AccountID         string `json:"accountId"`
	SlotID            string `json:"slotId"`
	UsedCursorMaxTime int64  `json:"usedCursorMaxTime"`
	NextCursorMaxTime int64  `json:"nextCursorMaxTime"`
	HasMore           bool   `json:"hasMore"`
	RawRooms          int    `json:"rawRooms"`
	HintedRooms       int    `json:"hintedRooms"`
	QualifiedRooms    int    `json:"qualifiedRooms"`
	Error             string `json:"error,omitempty"`
}

type AllScanReportResult struct {
	Accepted      bool   `json:"accepted"`
	Continue      bool   `json:"continue"`
	NextQueued    bool   `json:"nextQueued"`
	GeneratedAtMS int64  `json:"generatedAt"`
	Reason        string `json:"reason,omitempty"`
}

type TaskDebugSummary struct {
	GeneratedAtMS       int64 `json:"generatedAt"`
	ActiveCandidates    int   `json:"activeCandidates"`
	ValidCandidates     int   `json:"validCandidates"`
	AvailableCandidates int   `json:"availableCandidates"`
	SaturatedCandidates int   `json:"saturatedCandidates"`
	MultiSlotCandidates int   `json:"multiSlotCandidates"`
	LeaseCount          int   `json:"leaseCount"`
	ClientLeaseCount    int   `json:"clientLeaseCount"`
	AccountLeaseCount   int   `json:"accountLeaseCount"`
}

type TaskDebugSnapshot struct {
	Summary TaskDebugSummary `json:"summary"`
	Leases  []LeaseInfo      `json:"leases"`
}

func normalizeClaimOwner(owner ClaimOwner) ClaimOwner {
	return ClaimOwner{
		ClientID:  stringsTrim(owner.ClientID),
		AccountID: stringsTrim(owner.AccountID),
	}
}

func normalizeLeaseSec(leaseSec int64) int64 {
	if leaseSec < 10 {
		return 10
	}
	if leaseSec > 180 {
		return 180
	}
	return leaseSec
}

func ownerMatches(lease LeaseInfo, owner ClaimOwner) bool {
	return stringsTrim(lease.ClientID) == stringsTrim(owner.ClientID) &&
		stringsTrim(lease.AccountID) == stringsTrim(owner.AccountID)
}

func scoredCandidateKey(item ScoredCandidate) string {
	if item.Key != "" {
		return item.Key
	}
	if item.RoomID == "" || item.LotteryID == "" {
		return ""
	}
	return item.RoomID + ":" + item.LotteryID
}
