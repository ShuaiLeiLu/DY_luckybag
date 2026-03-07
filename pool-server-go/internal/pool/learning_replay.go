package pool

import (
	"math"
	"sort"
)

type LearningReplayOptions struct {
	TrainRatio float64 `json:"trainRatio"`
}

type LearningReplayMetrics struct {
	Count          int     `json:"count"`
	JoinEvents     int     `json:"joinEvents"`
	DrawEvents     int     `json:"drawEvents"`
	JoinBrier      float64 `json:"joinBrier"`
	DrawBrier      float64 `json:"drawBrier"`
	CompositeLoss  float64 `json:"compositeLoss"`
	ExpectedReward float64 `json:"expectedReward"`
	ActualReward   float64 `json:"actualReward"`
}

type LearningReplayCandidate struct {
	JoinWeight  float64               `json:"joinWeight"`
	WinWeight   float64               `json:"winWeight"`
	Metrics     LearningReplayMetrics `json:"metrics"`
	Improvement float64               `json:"improvement"`
}

type LearningReplayResult struct {
	TrainCount   int                       `json:"trainCount"`
	TestCount    int                       `json:"testCount"`
	TrainSummary LearningSummary           `json:"trainSummary"`
	Baseline     LearningReplayMetrics     `json:"baseline"`
	Best         LearningReplayCandidate   `json:"best"`
	Candidates   []LearningReplayCandidate `json:"candidates"`
}

func replayEventTime(feedback TaskFeedback) int64 {
	if feedback.JoinedAtMS > 0 {
		return feedback.JoinedAtMS
	}
	if feedback.EndTimeMS > 0 {
		return feedback.EndTimeMS
	}
	if feedback.StartTimeMS > 0 {
		return feedback.StartTimeMS
	}
	return 0
}

func summarizeLearningBucketsWithWeights(buckets []LearningBucket, joinWeight float64, winWeight float64) LearningSummary {
	return applyLearningSummaryWeights(summarizeLearningBuckets(buckets), joinWeight, winWeight)
}

func predictReplayProbabilities(feedback TaskFeedback, lookup map[string]LearningBucket, summary LearningSummary) (float64, float64) {
	baseJoinProb := summary.GlobalJoinSuccessRate
	if baseJoinProb <= 0 {
		baseJoinProb = 0.5
	}
	baseWinProb := normalizeProbabilityUnit(feedback.PredictedProbability)
	if baseWinProb <= 0 && feedback.LuckyCount > 0 && feedback.JoinTotal > 0 {
		baseWinProb = normalizeProbabilityUnit(feedback.LuckyCount / math.Max(feedback.JoinTotal, 1))
	}
	if baseWinProb <= 0 {
		baseWinProb = 0.05
	}
	bucketKey := buildLearningBucketKey(feedback)
	if bucket, ok := lookup[bucketKey]; ok {
		multiplier := learningMultiplierFromBucket(bucket, summary)
		baseJoinProb = clampFloat(baseJoinProb*multiplier, 0.05, 0.98)
		baseWinProb = clampFloat(baseWinProb*multiplier, 0.001, 0.98)
	}
	return baseJoinProb, baseWinProb
}

func evaluateReplayMetrics(feedbacks []TaskFeedback, lookup map[string]LearningBucket, summary LearningSummary, useLearning bool) LearningReplayMetrics {
	metrics := LearningReplayMetrics{Count: len(feedbacks)}
	for _, raw := range feedbacks {
		feedback := normalizeTaskFeedback(raw)
		switch feedback.Event {
		case "join_success", "join_failed":
			metrics.JoinEvents++
			predicted := summary.GlobalJoinSuccessRate
			if predicted <= 0 {
				predicted = 0.5
			}
			if useLearning {
				predicted, _ = predictReplayProbabilities(feedback, lookup, summary)
			}
			actual := 0.0
			if feedback.Event == "join_success" {
				actual = 1
			}
			metrics.JoinBrier += math.Pow(predicted-actual, 2)
		case "draw_won", "draw_lost":
			metrics.DrawEvents++
			predicted := normalizeProbabilityUnit(feedback.PredictedProbability)
			if predicted <= 0 && feedback.LuckyCount > 0 && feedback.JoinTotal > 0 {
				predicted = normalizeProbabilityUnit(feedback.LuckyCount / math.Max(feedback.JoinTotal, 1))
			}
			if predicted <= 0 {
				predicted = 0.05
			}
			if useLearning {
				_, predicted = predictReplayProbabilities(feedback, lookup, summary)
			}
			actual := 0.0
			if feedback.Event == "draw_won" {
				actual = 1
				metrics.ActualReward += feedback.RewardAmount
			}
			metrics.ExpectedReward += predicted * math.Max(feedback.RewardAmount, 0)
			metrics.DrawBrier += math.Pow(predicted-actual, 2)
		}
	}
	if metrics.JoinEvents > 0 {
		metrics.JoinBrier = round(metrics.JoinBrier/float64(metrics.JoinEvents), 6)
	}
	if metrics.DrawEvents > 0 {
		metrics.DrawBrier = round(metrics.DrawBrier/float64(metrics.DrawEvents), 6)
	}
	joinWeight := summary.JoinWeight
	winWeight := summary.WinWeight
	if joinWeight <= 0 || winWeight <= 0 {
		joinWeight = 0.38
		winWeight = 0.62
	}
	metrics.CompositeLoss = round(metrics.JoinBrier*joinWeight+metrics.DrawBrier*winWeight, 6)
	metrics.ExpectedReward = round(metrics.ExpectedReward, 4)
	metrics.ActualReward = round(metrics.ActualReward, 4)
	return metrics
}

func RunLearningReplay(feedbacks []TaskFeedback, options LearningReplayOptions) LearningReplayResult {
	normalized := make([]TaskFeedback, 0, len(feedbacks))
	for _, item := range feedbacks {
		next := normalizeTaskFeedback(item)
		if next.Event == "" {
			continue
		}
		normalized = append(normalized, next)
	}
	sort.SliceStable(normalized, func(i, j int) bool {
		return replayEventTime(normalized[i]) < replayEventTime(normalized[j])
	})
	if len(normalized) == 0 {
		return LearningReplayResult{}
	}

	trainRatio := options.TrainRatio
	if trainRatio <= 0 || trainRatio >= 1 {
		trainRatio = 0.72
	}
	trainCount := int(math.Round(float64(len(normalized)) * trainRatio))
	if trainCount < 1 {
		trainCount = 1
	}
	if trainCount >= len(normalized) {
		trainCount = len(normalized) - 1
	}
	trainSet := normalized[:trainCount]
	testSet := normalized[trainCount:]

	buckets := make(map[string]LearningBucket)
	for _, feedback := range trainSet {
		key := buildLearningBucketKey(feedback)
		bucket, ok := buckets[key]
		if !ok {
			bucket = newLearningBucketFromFeedback(feedback, key)
		}
		applyTaskFeedback(&bucket, feedback, replayEventTime(feedback))
		buckets[key] = bucket
	}

	bucketList := make([]LearningBucket, 0, len(buckets))
	for _, bucket := range buckets {
		bucketList = append(bucketList, bucket)
	}
	trainSummary := summarizeLearningBuckets(bucketList)
	baseline := evaluateReplayMetrics(testSet, buckets, trainSummary, false)

	candidates := make([]LearningReplayCandidate, 0, 8)
	best := LearningReplayCandidate{
		JoinWeight:  trainSummary.JoinWeight,
		WinWeight:   trainSummary.WinWeight,
		Metrics:     evaluateReplayMetrics(testSet, buckets, trainSummary, true),
		Improvement: round(baseline.CompositeLoss-evaluateReplayMetrics(testSet, buckets, trainSummary, true).CompositeLoss, 6),
	}

	for joinWeight := 0.22; joinWeight <= 0.5; joinWeight += 0.04 {
		winWeight := 1 - joinWeight
		summary := summarizeLearningBucketsWithWeights(bucketList, joinWeight, winWeight)
		metrics := evaluateReplayMetrics(testSet, buckets, summary, true)
		candidate := LearningReplayCandidate{
			JoinWeight:  round(summary.JoinWeight, 4),
			WinWeight:   round(summary.WinWeight, 4),
			Metrics:     metrics,
			Improvement: round(baseline.CompositeLoss-metrics.CompositeLoss, 6),
		}
		candidates = append(candidates, candidate)
		if candidate.Metrics.CompositeLoss < best.Metrics.CompositeLoss {
			best = candidate
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Metrics.CompositeLoss == candidates[j].Metrics.CompositeLoss {
			return candidates[i].Improvement > candidates[j].Improvement
		}
		return candidates[i].Metrics.CompositeLoss < candidates[j].Metrics.CompositeLoss
	})
	return LearningReplayResult{
		TrainCount:   len(trainSet),
		TestCount:    len(testSet),
		TrainSummary: trainSummary,
		Baseline:     baseline,
		Best:         best,
		Candidates:   candidates,
	}
}
