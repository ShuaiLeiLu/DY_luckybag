package pool

import (
	"math"
	"sort"
	"strings"
)

type LearningLookupFunc func(bucketKey string) (LearningBucket, LearningSummary, bool)

// buildCandidateKey 方法：根据 roomId 和 lotteryId 生成统一候选键。
func buildCandidateKey(roomID, lotteryID string) string {
	roomID = stringsTrim(roomID)
	lotteryID = stringsTrim(lotteryID)
	if roomID == "" || lotteryID == "" {
		return ""
	}
	return roomID + ":" + lotteryID
}

// normalizeFeedbackEvent 方法：规范化反馈事件名称。
func normalizeFeedbackEvent(event string) string {
	switch strings.TrimSpace(strings.ToLower(event)) {
	case "join_success", "joined", "success":
		return "join_success"
	case "join_failed", "join_fail", "failed":
		return "join_failed"
	case "draw_won", "won", "win":
		return "draw_won"
	case "draw_lost", "lost", "lose":
		return "draw_lost"
	default:
		return ""
	}
}

// normalizeProbabilityUnit 方法：将概率统一归一到 0~1。
func normalizeProbabilityUnit(prob float64) float64 {
	if prob > 1 {
		prob = prob / 100
	}
	if prob < 0 {
		return 0
	}
	if prob > 1 {
		return 1
	}
	return prob
}

// clonePrizeInfo 方法：复制 prizeInfo，避免外部写入污染内部状态。
func clonePrizeInfo(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

// cloneConditions 方法：复制条件切片，避免引用共享。
func cloneConditions(input []Condition) []Condition {
	if len(input) == 0 {
		return nil
	}
	out := make([]Condition, len(input))
	copy(out, input)
	return out
}

// normalizeTaskFeedback 方法：统一任务反馈结构。
func normalizeTaskFeedback(feedback TaskFeedback) TaskFeedback {
	out := feedback
	out.Owner = normalizeClaimOwner(feedback.Owner)
	out.Event = normalizeFeedbackEvent(feedback.Event)
	out.RoomID = stringsTrim(feedback.RoomID)
	out.LotteryID = stringsTrim(feedback.LotteryID)
	out.CandidateKey = stringsTrim(feedback.CandidateKey)
	if out.CandidateKey == "" {
		out.CandidateKey = buildCandidateKey(out.RoomID, out.LotteryID)
	}
	out.LotteryName = stringsTrim(feedback.LotteryName)
	out.AuthorNickname = stringsTrim(feedback.AuthorNickname)
	out.JoinMode = stringsTrim(feedback.JoinMode)
	out.Reason = stringsTrim(feedback.Reason)
	out.JoinTotal = math.Max(feedback.JoinTotal, 0)
	out.LuckyCount = math.Max(feedback.LuckyCount, 0)
	out.OnlineTotal = math.Max(feedback.OnlineTotal, 0)
	out.TotalAmount = math.Max(feedback.TotalAmount, 0)
	out.PredictedProbability = normalizeProbabilityUnit(feedback.PredictedProbability)
	out.PredictedJoinTotal = math.Max(feedback.PredictedJoinTotal, 0)
	if out.PredictedProbability <= 0 && out.LuckyCount > 0 && out.JoinTotal > 0 {
		out.PredictedProbability = math.Min(out.LuckyCount/math.Max(out.JoinTotal, 1), 1)
	}
	if out.PredictedJoinTotal <= 0 {
		out.PredictedJoinTotal = math.Max(out.JoinTotal, 0)
	}
	if out.RemainingSec < 0 {
		out.RemainingSec = 0
	}
	out.RewardAmount = math.Max(feedback.RewardAmount, 0)
	out.Conditions = cloneConditions(feedback.Conditions)
	out.PrizeInfo = clonePrizeInfo(feedback.PrizeInfo)
	return out
}

// candidateToFeedbackSample 方法：将候选项转换为学习样本，用于获取学习倍率。
func candidateToFeedbackSample(candidate Candidate, profile FilterProfile, nowMS int64) TaskFeedback {
	predictedJoinTotal, predictedProbability := predictFinalJoinAndProbability(candidate, nowMS)
	remainingSec := int64(0)
	if candidate.EndTimeMS > 0 && candidate.EndTimeMS > nowMS {
		remainingSec = int64((candidate.EndTimeMS - nowMS) / 1000)
	}
	return normalizeTaskFeedback(TaskFeedback{
		CandidateKey:         candidate.Key,
		RoomID:               candidate.RoomID,
		LotteryID:            candidate.LotteryID,
		LotteryName:          candidate.LotteryName,
		AuthorNickname:       candidate.AuthorNickname,
		Conditions:           cloneConditions(candidate.Conditions),
		JoinTotal:            candidate.JoinTotal,
		LuckyCount:           candidate.LuckyCount,
		OnlineTotal:          candidate.OnlineTotal,
		TotalAmount:          candidate.TotalAmount,
		PrizeType:            candidate.PrizeType,
		PrizeInfo:            clonePrizeInfo(candidate.PrizeInfo),
		PredictedProbability: predictedProbability,
		PredictedJoinTotal:   predictedJoinTotal,
		RemainingSec:         remainingSec,
		EndTimeMS:            candidate.EndTimeMS,
		StartTimeMS:          candidate.StartTimeMS,
	})
}

// feedbackPrizeClass 方法：按奖品类型将反馈样本归类到学习桶。
func feedbackPrizeClass(feedback TaskFeedback) string {
	candidate := Candidate{
		LotteryName:  feedback.LotteryName,
		PrizeInfo:    clonePrizeInfo(feedback.PrizeInfo),
		PrizeType:    feedback.PrizeType,
		LuckyCount:   feedback.LuckyCount,
		TotalAmount:  feedback.TotalAmount,
		LotteryTotal: feedback.TotalAmount,
	}
	if isPhysicalPrize(candidate) {
		return "physical"
	}
	redInfo := redPacketInfo(candidate, DefaultFilterProfile().BigRedPacketThreshold)
	if redInfo.IsBig {
		return "big_red"
	}
	if redInfo.IsRedPacket {
		return "red_packet"
	}
	return "virtual"
}

// remainBucket 方法：按剩余时间分桶。
func remainBucket(remainingSec int64) string {
	switch {
	case remainingSec <= 40:
		return "r1_25_40"
	case remainingSec <= 80:
		return "r2_41_80"
	case remainingSec <= 150:
		return "r3_81_150"
	default:
		return "r4_151_plus"
	}
}

// probabilityBucket 方法：按预测概率分桶。
func probabilityBucket(probability float64) string {
	p := normalizeProbabilityUnit(probability) * 100
	switch {
	case p < 2:
		return "p1_lt2"
	case p < 5:
		return "p2_2_5"
	case p < 10:
		return "p3_5_10"
	case p < 18:
		return "p4_10_18"
	default:
		return "p5_18_plus"
	}
}

// onlineBucket 方法：按房间在线人数分桶。
func onlineBucket(onlineTotal float64) string {
	switch {
	case onlineTotal <= 200:
		return "o1_0_200"
	case onlineTotal <= 1000:
		return "o2_201_1000"
	case onlineTotal <= 5000:
		return "o3_1001_5000"
	default:
		return "o4_5000_plus"
	}
}

// crowdBucket 方法：按预测最终参与人数分桶。
func crowdBucket(predictedJoinTotal float64) string {
	switch {
	case predictedJoinTotal <= 80:
		return "c1_0_80"
	case predictedJoinTotal <= 220:
		return "c2_81_220"
	case predictedJoinTotal <= 600:
		return "c3_221_600"
	default:
		return "c4_600_plus"
	}
}

// buildLearningBucketKey 方法：为任务反馈生成稳定学习桶键。
func buildLearningBucketKey(feedback TaskFeedback) string {
	normalized := normalizeTaskFeedback(feedback)
	parts := []string{
		"prize=" + feedbackPrizeClass(normalized),
		"remain=" + remainBucket(normalized.RemainingSec),
		"prob=" + probabilityBucket(normalized.PredictedProbability),
		"online=" + onlineBucket(normalized.OnlineTotal),
		"crowd=" + crowdBucket(normalized.PredictedJoinTotal),
	}
	return strings.Join(parts, "|")
}

// newLearningBucketFromFeedback 方法：创建学习桶的初始维度信息。
func newLearningBucketFromFeedback(feedback TaskFeedback, bucketKey string) LearningBucket {
	normalized := normalizeTaskFeedback(feedback)
	return LearningBucket{
		Key:           bucketKey,
		PrizeClass:    feedbackPrizeClass(normalized),
		RemainBucket:  remainBucket(normalized.RemainingSec),
		ProbBucket:    probabilityBucket(normalized.PredictedProbability),
		OnlineBucket:  onlineBucket(normalized.OnlineTotal),
		CrowdBucket:   crowdBucket(normalized.PredictedJoinTotal),
		FeedbackCount: 0,
	}
}

// applyTaskFeedback 方法：将一次执行反馈累加到学习桶。
func applyTaskFeedback(bucket *LearningBucket, feedback TaskFeedback, nowMS int64) {
	if bucket == nil {
		return
	}
	normalized := normalizeTaskFeedback(feedback)
	if normalized.Event == "" {
		return
	}
	bucket.FeedbackCount++
	bucket.UpdatedAtMS = nowMS
	switch normalized.Event {
	case "join_success":
		bucket.JoinSuccess++
	case "join_failed":
		bucket.JoinFailed++
	case "draw_won":
		bucket.DrawWon++
		bucket.ExpectedWins += normalized.PredictedProbability
		bucket.ActualWins += 1
		bucket.RewardSum += normalized.RewardAmount
	case "draw_lost":
		bucket.DrawLost++
		bucket.ExpectedWins += normalized.PredictedProbability
	}
}

// summarizeLearningBuckets 方法：汇总学习桶并生成全局校准参数。
func summarizeLearningBuckets(buckets []LearningBucket) LearningSummary {
	summary := LearningSummary{
		BucketCount: len(buckets),
		JoinWeight:  0.38,
		WinWeight:   0.62,
	}
	for _, bucket := range buckets {
		summary.FeedbackCount += bucket.FeedbackCount
		summary.JoinSuccess += bucket.JoinSuccess
		summary.JoinFailed += bucket.JoinFailed
		summary.DrawWon += bucket.DrawWon
		summary.DrawLost += bucket.DrawLost
		summary.ExpectedWins += bucket.ExpectedWins
		summary.ActualWins += bucket.ActualWins
		summary.RewardSum += bucket.RewardSum
	}
	joinEvents := summary.JoinSuccess + summary.JoinFailed
	drawEvents := summary.DrawWon + summary.DrawLost
	if joinEvents > 0 {
		summary.GlobalJoinSuccessRate = float64(summary.JoinSuccess+6) / float64(joinEvents+12)
	}
	if summary.ExpectedWins > 0.2 {
		summary.GlobalWinLift = clampFloat(summary.ActualWins/math.Max(summary.ExpectedWins, 0.2), 0.86, 1.14)
	} else {
		summary.GlobalWinLift = 1
	}
	confidenceSeed := float64(joinEvents+drawEvents) / 120.0
	summary.CalibrationConfidence = round(clampFloat(confidenceSeed, 0.12, 1), 4)
	if drawEvents > joinEvents && drawEvents > 20 {
		summary.WinWeight = 0.7
		summary.JoinWeight = 0.3
	}
	if joinEvents > drawEvents*2 && joinEvents > 24 {
		summary.JoinWeight = 0.44
		summary.WinWeight = 0.56
	}
	return summary
}

func applyLearningSummaryWeights(summary LearningSummary, joinWeight float64, winWeight float64) LearningSummary {
	total := joinWeight + winWeight
	if total <= 0 {
		return summary
	}
	summary.JoinWeight = round(clampFloat(joinWeight/total, 0.1, 0.9), 4)
	summary.WinWeight = round(clampFloat(winWeight/total, 0.1, 0.9), 4)
	return summary
}

// learningMultiplierFromBucket 方法：根据历史反馈和全局校准参数计算学习倍率。
func learningMultiplierFromBucket(bucket LearningBucket, summary LearningSummary) float64 {
	joinEvents := bucket.JoinSuccess + bucket.JoinFailed
	drawEvents := bucket.DrawWon + bucket.DrawLost
	if joinEvents == 0 && drawEvents == 0 {
		return 1
	}

	joinLift := 1.0
	if joinEvents > 0 {
		joinRate := float64(bucket.JoinSuccess+3) / float64(joinEvents+6)
		baseline := summary.GlobalJoinSuccessRate
		if baseline <= 0 {
			baseline = 0.5
		}
		joinLift = clampFloat(joinRate/math.Max(baseline, 0.15), 0.9, 1.12)
	}

	winLift := 1.0
	if bucket.ExpectedWins > 0.2 {
		winLift = clampFloat(bucket.ActualWins/math.Max(bucket.ExpectedWins, 0.2), 0.82, 1.24)
		if summary.GlobalWinLift > 0 {
			winLift = clampFloat((winLift / summary.GlobalWinLift), 0.86, 1.18)
		}
	}

	confidence := clampFloat((float64(joinEvents+drawEvents)/24.0)*summary.CalibrationConfidence, 0, 1)
	multiplier := 1 + ((joinLift-1)*summary.JoinWeight+(winLift-1)*summary.WinWeight)*confidence
	return round(clampFloat(multiplier, 0.86, 1.18), 4)
}

// learningMultiplierForCandidate 方法：根据候选项查找学习倍率。
func learningMultiplierForCandidate(candidate Candidate, profile FilterProfile, nowMS int64, lookup LearningLookupFunc) (float64, string) {
	if lookup == nil {
		return 1, ""
	}
	sample := candidateToFeedbackSample(candidate, profile, nowMS)
	bucketKey := buildLearningBucketKey(sample)
	bucket, summary, ok := lookup(bucketKey)
	if !ok {
		return 1, bucketKey
	}
	return learningMultiplierFromBucket(bucket, summary), bucketKey
}

// maxLeaseSlotsForCandidate 方法：根据候选质量决定是否允许多账号同时压一个高价值福袋。
func maxLeaseSlotsForCandidate(candidate Candidate, scored ScoredCandidate, threshold float64) int {
	if scored.RemainingSec < 35 || scored.RemainingSec > 180 {
		return 1
	}

	score := math.Max(scored.ReviewScore, scored.EVScore)
	probability := scored.Probability
	redInfo := redPacketInfo(candidate, threshold)
	physical := isPhysicalPrize(candidate)

	maxSlots := 1
	if score >= 72 && probability >= 4.5 {
		if redInfo.IsBig || physical || candidate.TotalAmount >= 80 || candidate.LuckyCount >= 40 {
			maxSlots = 2
		}
	}
	if score >= 86 && probability >= 8 && scored.RemainingSec >= 45 && scored.RemainingSec <= 150 {
		if redInfo.IsBig || candidate.TotalAmount >= 180 || candidate.LotteryTotal >= 200 {
			maxSlots = 3
		}
	}
	if physical && maxSlots > 2 {
		maxSlots = 2
	}
	return maxSlots
}

// applyClaimReviewScore 方法：在 claim 时根据时效、尾盘不确定性和当前占位情况做二次复评分。
func applyClaimReviewScore(candidate Candidate, scored ScoredCandidate, nowMS int64) ScoredCandidate {
	ageSec := 999.0
	if candidate.FetchedAtMS > 0 && nowMS >= candidate.FetchedAtMS {
		ageSec = float64(nowMS-candidate.FetchedAtMS) / 1000
	}
	freshnessFactor := 0.92
	switch {
	case ageSec <= 5:
		freshnessFactor = 1.05
	case ageSec <= 15:
		freshnessFactor = 1.02
	case ageSec <= 30:
		freshnessFactor = 0.98
	}

	timeFactor := 0.9
	switch {
	case scored.RemainingSec >= 45 && scored.RemainingSec <= 120:
		timeFactor = 1.08
	case scored.RemainingSec >= 35 && scored.RemainingSec < 45:
		timeFactor = 1.02
	case scored.RemainingSec > 120 && scored.RemainingSec <= 200:
		timeFactor = 0.96
	case scored.RemainingSec >= 25 && scored.RemainingSec < 35:
		timeFactor = 0.93
	}

	uncertaintyFactor := 1.0
	if scored.PredictedJoinTotal > 0 {
		gapRatio := math.Max(scored.PredictedJoinTotal-scored.JoinTotal, 0) / math.Max(scored.JoinTotal, 1)
		uncertaintyFactor = 1 - clampFloat(gapRatio, 0, 4)*0.03
	}

	executionFactor := 1.0
	if len(candidate.Conditions) > 2 {
		executionFactor -= 0.02
	}
	if hasMemberJoinRequirement(candidate.Conditions) {
		executionFactor -= 0.05
	}

	slotPressureFactor := 1.0
	if scored.MaxLeaseSlots > 1 && scored.LeaseCount > 0 {
		slotPressureFactor -= clampFloat(float64(scored.LeaseCount)/float64(scored.MaxLeaseSlots), 0, 0.9) * 0.06
	}

	reviewScore := scored.Score * freshnessFactor * timeFactor * uncertaintyFactor * executionFactor * slotPressureFactor
	if scored.MaxLeaseSlots > 1 {
		reviewScore += float64(scored.MaxLeaseSlots-1) * 1.4
	}
	scored.ReviewScore = round(reviewScore, 4)
	scored.Score = scored.ReviewScore
	return scored
}

// normalizeReviewStage 方法：将复检阶段统一映射到固定枚举。
func normalizeReviewStage(stage string, remainingSec int64) string {
	switch strings.TrimSpace(strings.ToLower(stage)) {
	case "t20", "20":
		return "t20"
	case "t30", "30":
		return "t30"
	}
	if remainingSec <= 22 {
		return "t20"
	}
	return "t30"
}

// applyStageReviewScore 方法：在 claim 复评分基础上叠加临开奖阶段偏好，稳定同房保留与 T-30/T-20 复排。
func applyStageReviewScore(candidate Candidate, scored ScoredCandidate, nowMS int64, stage string, currentKey string, currentRoomID string) ScoredCandidate {
	scored = applyClaimReviewScore(candidate, scored, nowMS)
	stage = normalizeReviewStage(stage, scored.RemainingSec)
	reviewScore := scored.ReviewScore

	if scored.Key == currentKey {
		if stage == "t20" {
			reviewScore += 8.4
		} else {
			reviewScore += 5.2
		}
	}
	if currentRoomID != "" && candidate.RoomID == currentRoomID {
		if stage == "t20" {
			reviewScore += 6.8
		} else {
			reviewScore += 3.6
		}
	}
	if currentRoomID != "" && candidate.RoomID != currentRoomID {
		if stage == "t20" {
			reviewScore *= 0.84
			if scored.RemainingSec <= 45 {
				reviewScore *= 0.88
			}
		} else {
			reviewScore *= 0.92
			if scored.RemainingSec <= 80 {
				reviewScore *= 0.9
			}
		}
	}
	if stage == "t20" {
		if scored.RemainingSec >= 18 && scored.RemainingSec <= 32 {
			reviewScore *= 1.03
		}
	} else if scored.RemainingSec >= 24 && scored.RemainingSec <= 45 {
		reviewScore *= 1.02
	}

	scored.ReviewScore = round(reviewScore, 4)
	scored.Score = scored.ReviewScore
	return scored
}

// rankClaimCandidates 方法：对基础候选集做服务端二次复评分并排序。
func rankClaimCandidates(items []ScoredCandidate, candidateMap map[string]Candidate, nowMS int64, limit int) []ScoredCandidate {
	if len(items) == 0 {
		return []ScoredCandidate{}
	}
	out := make([]ScoredCandidate, 0, len(items))
	for _, item := range items {
		candidate, ok := candidateMap[item.Key]
		if !ok {
			continue
		}
		out = append(out, applyClaimReviewScore(candidate, item, nowMS))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ReviewScore == out[j].ReviewScore {
			if out[i].Score == out[j].Score {
				return out[i].EndTime < out[j].EndTime
			}
			return out[i].Score > out[j].Score
		}
		return out[i].ReviewScore > out[j].ReviewScore
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

// rankReviewCandidates 方法：按复检阶段对候选做更强的临开奖重排。
func rankReviewCandidates(items []ScoredCandidate, candidateMap map[string]Candidate, nowMS int64, stage string, currentKey string, currentRoomID string, limit int) []ScoredCandidate {
	if len(items) == 0 {
		return []ScoredCandidate{}
	}
	out := make([]ScoredCandidate, 0, len(items))
	for _, item := range items {
		candidate, ok := candidateMap[item.Key]
		if !ok {
			continue
		}
		out = append(out, applyStageReviewScore(candidate, item, nowMS, stage, currentKey, currentRoomID))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ReviewScore == out[j].ReviewScore {
			if out[i].Score == out[j].Score {
				return out[i].EndTime < out[j].EndTime
			}
			return out[i].Score > out[j].Score
		}
		return out[i].ReviewScore > out[j].ReviewScore
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

// decideReviewSwitch 方法：根据当前候选与最佳候选的重排结果决定 keep/switch/drop。
func decideReviewSwitch(current *ScoredCandidate, best *ScoredCandidate, stage string, currentRoomID string) (string, string) {
	stage = normalizeReviewStage(stage, 0)
	if current == nil && best == nil {
		return "drop", "no_available_candidate"
	}
	if current == nil && best != nil {
		return "switch", "current_missing"
	}
	if current != nil && best == nil {
		return "keep", "fallback_current"
	}
	if current != nil && best != nil && current.Key == best.Key {
		return "keep", "same_candidate"
	}

	sameRoom := currentRoomID != "" && best != nil && best.RoomID == currentRoomID
	currentScore := math.Max(current.ReviewScore, 1)
	bestScore := math.Max(best.ReviewScore, 1)
	ratio := bestScore / currentScore
	switchThreshold := 1.22
	if sameRoom {
		switchThreshold = 1.06
	}
	if stage == "t20" {
		if sameRoom {
			switchThreshold = 1.04
		} else {
			switchThreshold = 1.52
		}
	} else if !sameRoom {
		switchThreshold = 1.34
	}
	if !sameRoom && best != nil && best.RemainingSec < 86 {
		return "keep", "cross_room_too_late"
	}
	if !sameRoom && current != nil && current.RemainingSec <= 90 {
		switchThreshold += 0.08
	}
	probDelta := 0.0
	if current != nil && best != nil {
		probDelta = best.Probability - current.Probability
	}
	requiredProbDelta := 0.03
	if stage == "t20" {
		requiredProbDelta = 0.05
	}
	if ratio >= switchThreshold {
		if !sameRoom && probDelta < requiredProbDelta && ratio < switchThreshold+0.14 {
			return "keep", "prob_gain_too_small"
		}
		return "switch", "better_candidate"
	}
	return "keep", "stickiness"
}

// sortLearningBuckets 方法：按反馈量和最近更新时间排序学习桶。
func sortLearningBuckets(buckets []LearningBucket, limit int) []LearningBucket {
	out := make([]LearningBucket, len(buckets))
	copy(out, buckets)
	sort.Slice(out, func(i, j int) bool {
		if out[i].FeedbackCount == out[j].FeedbackCount {
			return out[i].UpdatedAtMS > out[j].UpdatedAtMS
		}
		return out[i].FeedbackCount > out[j].FeedbackCount
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

// clampFloat 方法：约束浮点数区间。
func clampFloat(value, minValue, maxValue float64) float64 {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
