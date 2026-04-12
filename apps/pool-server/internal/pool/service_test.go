package pool

import (
	"testing"
	"time"
)

func TestRefreshTopSkipsSnapshotWhenClean(t *testing.T) {
	cfg := DefaultConfig()
	cfg.TopRefreshMS = 1
	cfg.TopCacheMax = 1
	cfg.MinHeapShards = 1

	s := NewService(cfg)
	_, _ = s.UpdateProfile(map[string]any{
		"requireType3And6": false,
		"filterFanClub":    false,
	})
	now := time.Now()
	raw := map[string]any{
		"roomId":    "room-skips",
		"lotteryId": "lottery-a",
		"endTime":   now.Add(3 * time.Minute).UnixMilli(),
		"conditions": []map[string]any{
			{"type": 3, "content": "评论"},
			{"type": 6, "content": "参与"},
		},
	}

	result := s.UpsertBatch("test-src", []map[string]any{raw})
	if result.Inserted != 1 {
		t.Fatalf("expected inserted candidate, got %+v", result)
	}

	items1, meta1, _ := s.Top(1)
	if len(items1) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(items1))
	}
	initialEpoch := s.topEpoch.Load()
	if initialEpoch == 0 {
		t.Fatalf("expected topEpoch non-zero after initial refresh")
	}

	time.Sleep(5 * time.Millisecond)

	_, meta2, _ := s.Top(1)
	if meta2.BuiltAtMS <= meta1.BuiltAtMS {
		t.Fatalf("expected BuiltAt to advance after TTL, got %d <= %d", meta2.BuiltAtMS, meta1.BuiltAtMS)
	}
	if got := s.topEpoch.Load(); got != initialEpoch {
		t.Fatalf("expected topEpoch unchanged when clean, got %d != %d", got, initialEpoch)
	}

	raw2 := map[string]any{
		"roomId":    "room-skips",
		"lotteryId": "lottery-a",
		"endTime":   now.Add(5 * time.Minute).UnixMilli(),
		"fetchedAt": time.Now().Add(time.Millisecond).UnixMilli(),
		"conditions": []map[string]any{
			{"type": 3, "content": "评论"},
			{"type": 6, "content": "参与"},
		},
	}
	result2 := s.UpsertBatch("test-src", []map[string]any{raw2})
	if result2.Updated != 1 {
		t.Fatalf("expected update, got %+v", result2)
	}

	time.Sleep(time.Millisecond)
	_, meta3, _ := s.Top(1)
	if s.topEpoch.Load() <= initialEpoch {
		t.Fatalf("expected topEpoch to increase after change, got %d <= %d", s.topEpoch.Load(), initialEpoch)
	}
	if meta3.BuiltAtMS <= meta2.BuiltAtMS {
		t.Fatalf("expected BuiltAt to advance after rebuild, got %d <= %d", meta3.BuiltAtMS, meta2.BuiltAtMS)
	}
}
