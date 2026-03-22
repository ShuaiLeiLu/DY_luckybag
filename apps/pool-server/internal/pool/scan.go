package pool

import "sort"

const DefaultScanHeartbeatTTLMS int64 = 25000

type ScanTelemetry struct {
	RiskLevel        int   `json:"riskLevel"`
	CooldownRemainMS int64 `json:"cooldownRemainMs"`
	HardRiskCount    int   `json:"hardRiskCount"`
	BusyAccounts     int   `json:"busyAccounts"`
	IdleAccounts     int   `json:"idleAccounts"`
	ActiveScanners   int   `json:"activeScanners"`
}

type ScanBudget struct {
	MaxConcurrentScanners int `json:"maxConcurrentScanners"`
	CountPerPage          int `json:"countPerPage"`
	DetailConcurrency     int `json:"detailConcurrency"`
	DetailRoomCap         int `json:"detailRoomCap"`
	AllTimes              int `json:"allTimes"`
	MaxAllRounds          int `json:"maxAllRounds"`
	PagesPerCategory      int `json:"pagesPerCategory"`
	MaxCategoryPages      int `json:"maxCategoryPages"`
	CategoryNoGrowthBreak int `json:"categoryNoGrowthBreakPages"`
	ItemGapMS             int `json:"itemGapMs"`
	CycleDelayMinMS       int `json:"cycleDelayMinMs"`
	CycleDelayMaxMS       int `json:"cycleDelayMaxMs"`
	CategoryOffsetStride  int `json:"categoryOffsetStride"`
}

type ScanCategoryPlan struct {
	CategoryID   string `json:"categoryId"`
	StartOffset  int    `json:"startOffset"`
	OffsetStride int    `json:"offsetStride"`
	Count        int    `json:"count"`
	MaxPages     int    `json:"maxPages"`
}

type ReviewWindow struct {
	Name                string `json:"name"`
	TriggerRemainingSec int64  `json:"triggerRemainingSec"`
}

type ScanAssignment struct {
	ClientID          string             `json:"clientId"`
	Mode              string             `json:"mode"`
	Rank              int                `json:"rank"`
	ActiveClients     int                `json:"activeClients"`
	AllScanEnabled    bool               `json:"allScanEnabled"`
	CategoryIDs       []string           `json:"categoryIds"`
	CategoryPlans     []ScanCategoryPlan `json:"categoryPlans"`
	Budget            ScanBudget         `json:"budget"`
	ReviewWindows     []ReviewWindow     `json:"reviewWindows"`
	ClusterRiskLevel  int                `json:"clusterRiskLevel"`
	ClusterRiskScore  float64            `json:"clusterRiskScore"`
	DeepPagingEnabled bool               `json:"deepPagingEnabled"`
	AssignedAtMS      int64              `json:"assignedAt"`
	ExpiresAtMS       int64              `json:"expiresAt"`
	HeartbeatTTLMS    int64              `json:"heartbeatTtl"`
}

type scanClientState struct {
	ClientID    string        `json:"clientId"`
	UpdatedAtMS int64         `json:"updatedAt"`
	Telemetry   ScanTelemetry `json:"telemetry"`
}

type scanPoolSummary struct {
	ValidCandidates     int
	AvailableCandidates int
	LeaseCount          int
}

func normalizeCategoryIDs(ids []string) []string {
	if len(ids) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		trimmed := stringsTrim(id)
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

func normalizeScanTelemetry(input ScanTelemetry) ScanTelemetry {
	output := input
	if output.RiskLevel < 0 {
		output.RiskLevel = 0
	}
	if output.RiskLevel > 3 {
		output.RiskLevel = 3
	}
	if output.CooldownRemainMS < 0 {
		output.CooldownRemainMS = 0
	}
	if output.HardRiskCount < 0 {
		output.HardRiskCount = 0
	}
	if output.BusyAccounts < 0 {
		output.BusyAccounts = 0
	}
	if output.IdleAccounts < 0 {
		output.IdleAccounts = 0
	}
	if output.ActiveScanners < 0 {
		output.ActiveScanners = 0
	}
	return output
}

func buildClusterRisk(active map[string]scanClientState) (int, float64) {
	if len(active) == 0 {
		return 0, 0
	}
	maxLevel := 0
	totalScore := 0.0
	for _, state := range active {
		level := state.Telemetry.RiskLevel
		if level > maxLevel {
			maxLevel = level
		}
		score := float64(level) * 0.38
		if state.Telemetry.CooldownRemainMS > 0 {
			score += 0.22
		}
		score += clampFloat(float64(state.Telemetry.HardRiskCount)*0.08, 0, 0.28)
		totalScore += clampFloat(score, 0, 1.6)
	}
	return maxLevel, round(totalScore/float64(len(active)), 4)
}

func buildScanBudget(current scanClientState, activeClients int, clusterRiskLevel int, clusterRiskScore float64, summary scanPoolSummary) ScanBudget {
	idleAccounts := maxInt(current.Telemetry.IdleAccounts, 1)
	available := maxInt(summary.AvailableCandidates, 0)
	countPerPage := 18
	detailConcurrency := 2
	detailRoomCap := 8
	pagesPerCategory := 32
	maxCategoryPages := 200
	categoryNoGrowthBreak := 10
	allTimes := 5
	maxAllRounds := 16
	itemGapMS := 320
	cycleDelayMinMS := 900
	cycleDelayMaxMS := 1800

	switch {
	case available <= 8:
		countPerPage = 20
		detailConcurrency = 3
		detailRoomCap = 12
		pagesPerCategory = 72
		maxCategoryPages = 520
		categoryNoGrowthBreak = 24
		allTimes = 8
		maxAllRounds = 32
		itemGapMS = 260
		cycleDelayMinMS = 700
		cycleDelayMaxMS = 1400
	case available <= 20:
		countPerPage = 18
		detailConcurrency = 3
		detailRoomCap = 10
		pagesPerCategory = 52
		maxCategoryPages = 360
		categoryNoGrowthBreak = 18
		allTimes = 7
		maxAllRounds = 26
		itemGapMS = 280
		cycleDelayMinMS = 800
		cycleDelayMaxMS = 1500
	case available <= 50:
		countPerPage = 18
		detailRoomCap = 9
		pagesPerCategory = 38
		maxCategoryPages = 260
		categoryNoGrowthBreak = 14
		allTimes = 6
		maxAllRounds = 20
	default:
		countPerPage = 16
		detailRoomCap = 7
		pagesPerCategory = 22
		maxCategoryPages = 140
		categoryNoGrowthBreak = 8
		allTimes = 4
		maxAllRounds = 12
	}

	maxConcurrentScanners := 1
	switch {
	case available <= 8:
		maxConcurrentScanners = minInt(idleAccounts, 4)
	case available <= 20:
		maxConcurrentScanners = minInt(idleAccounts, 3)
	default:
		maxConcurrentScanners = minInt(idleAccounts, 2)
	}
	if maxConcurrentScanners < 1 {
		maxConcurrentScanners = 1
	}
	if maxConcurrentScanners > 5 {
		maxConcurrentScanners = 5
	}
	if activeClients >= 3 && maxConcurrentScanners > 3 {
		maxConcurrentScanners = 3
	}
	if activeClients >= 5 && maxConcurrentScanners > 2 {
		maxConcurrentScanners = 2
	}
	if clusterRiskLevel >= 2 {
		detailConcurrency = 1
		detailRoomCap = minInt(detailRoomCap, 6)
		pagesPerCategory = maxInt(14, pagesPerCategory-8)
		maxCategoryPages = maxInt(100, maxCategoryPages-70)
		categoryNoGrowthBreak = maxInt(5, categoryNoGrowthBreak-2)
		itemGapMS = maxInt(itemGapMS, 520)
		cycleDelayMinMS = maxInt(cycleDelayMinMS, 1800)
		cycleDelayMaxMS = maxInt(cycleDelayMaxMS, 3000)
		maxConcurrentScanners = minInt(maxConcurrentScanners, 2)
	}
	if clusterRiskLevel >= 3 || clusterRiskScore >= 1.05 {
		detailConcurrency = 1
		detailRoomCap = minInt(detailRoomCap, 5)
		pagesPerCategory = maxInt(12, pagesPerCategory-6)
		maxCategoryPages = maxInt(80, maxCategoryPages-50)
		categoryNoGrowthBreak = maxInt(4, categoryNoGrowthBreak-1)
		itemGapMS = maxInt(itemGapMS, 680)
		cycleDelayMinMS = maxInt(cycleDelayMinMS, 2800)
		cycleDelayMaxMS = maxInt(cycleDelayMaxMS, 4400)
		maxConcurrentScanners = 1
	}

	return ScanBudget{
		MaxConcurrentScanners: maxConcurrentScanners,
		CountPerPage:          countPerPage,
		DetailConcurrency:     detailConcurrency,
		DetailRoomCap:         detailRoomCap,
		AllTimes:              allTimes,
		MaxAllRounds:          maxAllRounds,
		PagesPerCategory:      pagesPerCategory,
		MaxCategoryPages:      maxCategoryPages,
		CategoryNoGrowthBreak: categoryNoGrowthBreak,
		ItemGapMS:             itemGapMS,
		CycleDelayMinMS:       cycleDelayMinMS,
		CycleDelayMaxMS:       cycleDelayMaxMS,
		CategoryOffsetStride:  maxInt(activeClients, 1) * countPerPage,
	}
}

func buildReviewWindows() []ReviewWindow {
	return []ReviewWindow{
		{Name: "t30", TriggerRemainingSec: 30},
		{Name: "t20", TriggerRemainingSec: 20},
	}
}

func buildCategoryPlans(categoryIDs []string, budget ScanBudget, rank int, activeClients int) []ScanCategoryPlan {
	if len(categoryIDs) == 0 {
		return []ScanCategoryPlan{}
	}
	count := maxInt(budget.CountPerPage, 10)
	stride := maxInt(activeClients, 1) * count
	startOffset := maxInt(rank, 0) * count
	out := make([]ScanCategoryPlan, 0, len(categoryIDs))
	for _, categoryID := range categoryIDs {
		if categoryID == "" {
			continue
		}
		out = append(out, ScanCategoryPlan{
			CategoryID:   categoryID,
			StartOffset:  startOffset,
			OffsetStride: stride,
			Count:        count,
			MaxPages:     maxInt(budget.MaxCategoryPages, 1),
		})
	}
	return out
}

func buildScanAssignment(clientID string, activeClientStates map[string]scanClientState, categoryIDs []string, nowMS int64, ttlMS int64, summary scanPoolSummary) ScanAssignment {
	normalizedClientID := stringsTrim(clientID)
	active := make([]string, 0, len(activeClientStates))
	for item := range activeClientStates {
		active = append(active, item)
	}
	sort.Strings(active)
	categories := normalizeCategoryIDs(categoryIDs)

	rank := 0
	for i, item := range active {
		if item == normalizedClientID {
			rank = i
			break
		}
	}

	mode := "solo"
	allScanEnabled := true
	if len(active) > 1 {
		if rank == 0 {
			mode = "primary"
			allScanEnabled = true
		} else {
			mode = "secondary"
			allScanEnabled = false
		}
	}

	currentState, ok := activeClientStates[normalizedClientID]
	if !ok {
		currentState = scanClientState{
			ClientID:    normalizedClientID,
			UpdatedAtMS: nowMS,
			Telemetry:   normalizeScanTelemetry(ScanTelemetry{}),
		}
	}
	clusterRiskLevel, clusterRiskScore := buildClusterRisk(activeClientStates)
	budget := buildScanBudget(currentState, maxInt(len(active), 1), clusterRiskLevel, clusterRiskScore, summary)
	categoryPlans := buildCategoryPlans(categories, budget, rank, maxInt(len(active), 1))

	return ScanAssignment{
		ClientID:          normalizedClientID,
		Mode:              mode,
		Rank:              rank,
		ActiveClients:     len(active),
		AllScanEnabled:    allScanEnabled,
		CategoryIDs:       categories,
		CategoryPlans:     categoryPlans,
		Budget:            budget,
		ReviewWindows:     buildReviewWindows(),
		ClusterRiskLevel:  clusterRiskLevel,
		ClusterRiskScore:  clusterRiskScore,
		DeepPagingEnabled: true,
		AssignedAtMS:      nowMS,
		ExpiresAtMS:       nowMS + ttlMS,
		HeartbeatTTLMS:    ttlMS,
	}
}
