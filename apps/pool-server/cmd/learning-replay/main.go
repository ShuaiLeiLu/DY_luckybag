package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"dy_fudai/pool-server-go/internal/pool"
)

func main() {
	inputPath := flag.String("input", "", "JSONL feedback file path")
	trainRatio := flag.Float64("train-ratio", 0.72, "training split ratio")
	outputFormat := flag.String("format", "text", "text or json")
	flag.Parse()

	if strings.TrimSpace(*inputPath) == "" {
		fmt.Fprintln(os.Stderr, "missing -input")
		os.Exit(2)
	}

	file, err := os.Open(*inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open input failed: %v\n", err)
		os.Exit(1)
	}
	defer file.Close()

	feedbacks := make([]pool.TaskFeedback, 0, 1024)
	seen := make(map[string]bool)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var feedback pool.TaskFeedback
		if err := json.Unmarshal([]byte(line), &feedback); err != nil {
			fmt.Fprintf(os.Stderr, "skip invalid line: %v\n", err)
			continue
		}
		if feedback.EventID != "" && seen[feedback.EventID] {
			continue
		}
		seen[feedback.EventID] = true
		feedbacks = append(feedbacks, feedback)
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "read input failed: %v\n", err)
		os.Exit(1)
	}

	result := pool.RunLearningReplay(feedbacks, pool.LearningReplayOptions{
		TrainRatio: *trainRatio,
	})

	if strings.EqualFold(strings.TrimSpace(*outputFormat), "json") {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(result)
		return
	}

	fmt.Printf("train=%d test=%d buckets=%d feedback=%d\n",
		result.TrainCount,
		result.TestCount,
		result.TrainSummary.BucketCount,
		result.TrainSummary.FeedbackCount,
	)
	fmt.Printf("baseline composite=%.6f joinBrier=%.6f drawBrier=%.6f\n",
		result.Baseline.CompositeLoss,
		result.Baseline.JoinBrier,
		result.Baseline.DrawBrier,
	)
	fmt.Printf("best joinWeight=%.4f winWeight=%.4f composite=%.6f improvement=%.6f expectedReward=%.4f actualReward=%.4f\n",
		result.Best.JoinWeight,
		result.Best.WinWeight,
		result.Best.Metrics.CompositeLoss,
		result.Best.Improvement,
		result.Best.Metrics.ExpectedReward,
		result.Best.Metrics.ActualReward,
	)
}
