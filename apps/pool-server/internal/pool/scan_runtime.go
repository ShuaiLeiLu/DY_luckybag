package pool

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	DefaultAllScanLeaseTTLMS        int64 = 18000
	DefaultAllScanRestartCooldownMS int64 = 12000
	DefaultScanPermitMinRetryMS     int64 = 400
)

type scanPermitState struct {
	Tokens      float64 `json:"tokens"`
	UpdatedAtMS int64   `json:"updatedAtMs"`
}

type allScanCursorLease struct {
	SlotID        string `json:"slotId"`
	ClientID      string `json:"clientId"`
	AccountID     string `json:"accountId"`
	CursorMaxTime int64  `json:"cursorMaxTime"`
	Depth         int    `json:"depth"`
	ClaimedAtMS   int64  `json:"claimedAtMs"`
	ExpiresAtMS   int64  `json:"expiresAtMs"`
}

type allScanCursorState struct {
	NextCursorMaxTime int64               `json:"nextCursorMaxTime"`
	Depth             int                 `json:"depth"`
	Cycle             int                 `json:"cycle"`
	Exhausted         bool                `json:"exhausted"`
	LastAdvancedAtMS  int64               `json:"lastAdvancedAtMs"`
	LastIssuedAtMS    int64               `json:"lastIssuedAtMs"`
	Lease             *allScanCursorLease `json:"lease,omitempty"`
}

func normalizeScanPermitKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case "all", "all_scan", "all-scan":
		return "all"
	case "detail", "details", "lottery_detail":
		return "detail"
	default:
		return "category"
	}
}

func normalizeScanPermitOptions(options ScanPermitOptions) ScanPermitOptions {
	return ScanPermitOptions{
		ClientID:  stringsTrim(options.ClientID),
		AccountID: stringsTrim(options.AccountID),
		Kind:      normalizeScanPermitKind(options.Kind),
		Cost:      maxInt(1, options.Cost),
	}
}

func normalizeAllScanClaimOptions(options AllScanClaimOptions) AllScanClaimOptions {
	out := AllScanClaimOptions{
		ClientID:   stringsTrim(options.ClientID),
		AccountID:  stringsTrim(options.AccountID),
		LeaseTTLMS: options.LeaseTTLMS,
	}
	if out.LeaseTTLMS < 10000 {
		out.LeaseTTLMS = DefaultAllScanLeaseTTLMS
	}
	if out.LeaseTTLMS > 30000 {
		out.LeaseTTLMS = 30000
	}
	return out
}

func normalizeAllScanReportOptions(options AllScanReportOptions) AllScanReportOptions {
	return AllScanReportOptions{
		ClientID:          stringsTrim(options.ClientID),
		AccountID:         stringsTrim(options.AccountID),
		SlotID:            stringsTrim(options.SlotID),
		UsedCursorMaxTime: maxInt64(0, options.UsedCursorMaxTime),
		NextCursorMaxTime: maxInt64(0, options.NextCursorMaxTime),
		HasMore:           options.HasMore,
		RawRooms:          maxInt(0, options.RawRooms),
		HintedRooms:       maxInt(0, options.HintedRooms),
		QualifiedRooms:    maxInt(0, options.QualifiedRooms),
		Error:             stringsTrim(options.Error),
	}
}

func buildScanPermitPolicy(kind string, active map[string]scanClientState, summary scanPoolSummary) (float64, float64, int, float64) {
	clusterRiskLevel, clusterRiskScore := buildClusterRisk(active)
	activeClients := maxInt(len(active), 1)
	refillPerSec := 1.0
	burst := 3.0

	switch normalizeScanPermitKind(kind) {
	case "all":
		refillPerSec = 0.34
		burst = 1.6
	case "detail":
		refillPerSec = 5.6
		burst = 18
	default:
		refillPerSec = 1.35
		burst = 6.0
	}

	if summary.AvailableCandidates <= 8 {
		switch normalizeScanPermitKind(kind) {
		case "all":
			refillPerSec *= 1.35
			burst += 0.8
		case "detail":
			refillPerSec *= 1.3
			burst += 4
		default:
			refillPerSec *= 1.32
			burst += 2
		}
	}
	if summary.AvailableCandidates <= 20 && summary.AvailableCandidates > 8 {
		switch normalizeScanPermitKind(kind) {
		case "all":
			refillPerSec *= 1.18
			burst += 0.4
		case "detail":
			refillPerSec *= 1.18
			burst += 2
		default:
			refillPerSec *= 1.18
			burst += 1
		}
	}
	if summary.AvailableCandidates >= 45 {
		switch normalizeScanPermitKind(kind) {
		case "all":
			refillPerSec *= 0.92
		case "detail":
			refillPerSec *= 0.95
		default:
			refillPerSec *= 0.94
		}
	}

	if activeClients >= 2 {
		refillPerSec *= 1 + math.Min(float64(activeClients-1)*0.1, 0.36)
		burst += math.Min(float64(activeClients-1)*0.55, 1.6)
	}
	if clusterRiskLevel >= 1 {
		refillPerSec *= 0.88
		burst *= 0.94
	}
	if clusterRiskLevel >= 2 {
		refillPerSec *= 0.74
		burst *= 0.86
	}
	if clusterRiskLevel >= 3 || clusterRiskScore >= 1.05 {
		refillPerSec *= 0.6
		burst *= 0.78
	}

	refillPerSec = round(math.Max(refillPerSec, 0.12), 4)
	burst = round(math.Max(burst, 1), 4)
	return refillPerSec, burst, clusterRiskLevel, clusterRiskScore
}

func applyScanPermitState(state scanPermitState, options ScanPermitOptions, nowMS int64, refillPerSec float64, burst float64, clusterRiskLevel int, clusterRiskScore float64) (scanPermitState, ScanPermitResult) {
	if state.UpdatedAtMS <= 0 {
		state.UpdatedAtMS = nowMS
		if state.Tokens <= 0 {
			state.Tokens = burst
		}
	}
	if state.Tokens > burst {
		state.Tokens = burst
	}
	if state.UpdatedAtMS > nowMS {
		state.UpdatedAtMS = nowMS
	}
	elapsedSec := float64(maxInt64(0, nowMS-state.UpdatedAtMS)) / 1000.0
	tokens := math.Min(burst, state.Tokens+elapsedSec*refillPerSec)
	allowed := tokens >= float64(options.Cost)
	retryAfterMS := int64(0)
	if allowed {
		tokens -= float64(options.Cost)
	} else if refillPerSec > 0 {
		retryAfterMS = int64(math.Ceil(((float64(options.Cost) - tokens) / refillPerSec) * 1000))
		if retryAfterMS < DefaultScanPermitMinRetryMS {
			retryAfterMS = DefaultScanPermitMinRetryMS
		}
	} else {
		retryAfterMS = 2000
	}
	state.Tokens = round(clampFloat(tokens, 0, burst), 4)
	state.UpdatedAtMS = nowMS
	return state, ScanPermitResult{
		Allowed:          allowed,
		Kind:             options.Kind,
		Cost:             options.Cost,
		RetryAfterMS:     retryAfterMS,
		TokensLeft:       state.Tokens,
		Burst:            burst,
		RefillPerSec:     refillPerSec,
		ClusterRiskLevel: clusterRiskLevel,
		ClusterRiskScore: clusterRiskScore,
		GeneratedAtMS:    nowMS,
		Reason:           map[bool]string{true: "granted", false: "rate_limited"}[allowed],
	}
}

func defaultAllScanCursorState(nowMS int64) allScanCursorState {
	return allScanCursorState{
		NextCursorMaxTime: 0,
		Depth:             0,
		Cycle:             1,
		Exhausted:         false,
		LastAdvancedAtMS:  nowMS,
		LastIssuedAtMS:    0,
		Lease:             nil,
	}
}

func claimAllScanCursorState(state allScanCursorState, options AllScanClaimOptions, nowMS int64) (allScanCursorState, AllScanClaimResult) {
	options = normalizeAllScanClaimOptions(options)
	if state.Cycle <= 0 {
		state = defaultAllScanCursorState(nowMS)
	}

	if state.Lease != nil && state.Lease.ExpiresAtMS > nowMS {
		if state.Lease.ClientID == options.ClientID && state.Lease.AccountID == options.AccountID {
			return state, AllScanClaimResult{
				Claimed:       true,
				SlotID:        state.Lease.SlotID,
				CursorMaxTime: state.Lease.CursorMaxTime,
				Depth:         state.Lease.Depth,
				Cycle:         state.Cycle,
				RetryAfterMS:  0,
				LeaseTTLMS:    maxInt64(0, state.Lease.ExpiresAtMS-nowMS),
				FromHead:      state.Lease.CursorMaxTime <= 0 && state.Lease.Depth == 0,
				GeneratedAtMS: nowMS,
				Reason:        "already_claimed",
			}
		}
		return state, AllScanClaimResult{
			Claimed:       false,
			RetryAfterMS:  maxInt64(DefaultScanPermitMinRetryMS, state.Lease.ExpiresAtMS-nowMS),
			GeneratedAtMS: nowMS,
			Reason:        "leased",
		}
	}

	if state.Exhausted && state.LastAdvancedAtMS+DefaultAllScanRestartCooldownMS > nowMS {
		return state, AllScanClaimResult{
			Claimed:       false,
			RetryAfterMS:  maxInt64(DefaultScanPermitMinRetryMS, state.LastAdvancedAtMS+DefaultAllScanRestartCooldownMS-nowMS),
			GeneratedAtMS: nowMS,
			Reason:        "exhausted_cooldown",
		}
	}
	if state.Exhausted {
		state.NextCursorMaxTime = 0
		state.Depth = 0
		state.Cycle += 1
		state.Exhausted = false
	}

	slotID := "all-" + strconv.Itoa(state.Cycle) + "-" + strconv.FormatInt(nowMS, 10)
	state.Lease = &allScanCursorLease{
		SlotID:        slotID,
		ClientID:      options.ClientID,
		AccountID:     options.AccountID,
		CursorMaxTime: state.NextCursorMaxTime,
		Depth:         state.Depth,
		ClaimedAtMS:   nowMS,
		ExpiresAtMS:   nowMS + options.LeaseTTLMS,
	}
	state.LastIssuedAtMS = nowMS
	return state, AllScanClaimResult{
		Claimed:       true,
		SlotID:        slotID,
		CursorMaxTime: state.NextCursorMaxTime,
		Depth:         state.Depth,
		Cycle:         state.Cycle,
		RetryAfterMS:  0,
		LeaseTTLMS:    options.LeaseTTLMS,
		FromHead:      state.NextCursorMaxTime <= 0 && state.Depth == 0,
		GeneratedAtMS: nowMS,
		Reason:        "claimed",
	}
}

func reportAllScanCursorState(state allScanCursorState, options AllScanReportOptions, nowMS int64) (allScanCursorState, AllScanReportResult) {
	options = normalizeAllScanReportOptions(options)
	if state.Cycle <= 0 {
		state = defaultAllScanCursorState(nowMS)
	}
	if state.Lease == nil {
		return state, AllScanReportResult{
			Accepted:      false,
			GeneratedAtMS: nowMS,
			Reason:        "lease_missing",
		}
	}
	lease := state.Lease
	if lease.SlotID != options.SlotID || lease.ClientID != options.ClientID || lease.AccountID != options.AccountID {
		return state, AllScanReportResult{
			Accepted:      false,
			GeneratedAtMS: nowMS,
			Reason:        "lease_mismatch",
		}
	}

	state.Lease = nil
	if options.Error != "" {
		return state, AllScanReportResult{
			Accepted:      true,
			Continue:      true,
			NextQueued:    false,
			GeneratedAtMS: nowMS,
			Reason:        "retry_current_cursor",
		}
	}

	if options.HasMore && options.NextCursorMaxTime > 0 && options.NextCursorMaxTime != lease.CursorMaxTime {
		state.NextCursorMaxTime = options.NextCursorMaxTime
		state.Depth = lease.Depth + 1
		state.Exhausted = false
		state.LastAdvancedAtMS = nowMS
		return state, AllScanReportResult{
			Accepted:      true,
			Continue:      true,
			NextQueued:    true,
			GeneratedAtMS: nowMS,
			Reason:        "advanced",
		}
	}

	state.NextCursorMaxTime = 0
	state.Depth = 0
	state.Exhausted = true
	state.LastAdvancedAtMS = nowMS
	return state, AllScanReportResult{
		Accepted:      true,
		Continue:      false,
		NextQueued:    false,
		GeneratedAtMS: nowMS,
		Reason:        "exhausted",
	}
}

func sortScanPlansByOffset(plans []ScanCategoryPlan) []ScanCategoryPlan {
	out := append([]ScanCategoryPlan(nil), plans...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].CategoryID == out[j].CategoryID {
			if out[i].StartOffset == out[j].StartOffset {
				return out[i].OffsetStride < out[j].OffsetStride
			}
			return out[i].StartOffset < out[j].StartOffset
		}
		return out[i].CategoryID < out[j].CategoryID
	})
	return out
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
