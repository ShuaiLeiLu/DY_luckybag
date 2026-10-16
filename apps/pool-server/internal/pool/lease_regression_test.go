package pool

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

type leaseStore interface {
	ClaimTask(ClaimOptions) (ClaimResult, error)
	RenewTaskLease(ClaimOwner, string, int64) (*LeaseInfo, bool, error)
	ReleaseTaskLease(ClaimOwner, string, string) (bool, error)
	FinishTaskLease(ClaimOwner, string, string, bool) (bool, error)
	UpsertBatch(string, []map[string]any) BatchResult
	RecordTaskFeedback(TaskFeedback) error
	LearningDebug(int) (LearningDebugSnapshot, error)
	Close() error
}

func testLeaseStores(t *testing.T, run func(*testing.T, leaseStore)) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.FeedbackLogPath = filepath.Join(t.TempDir(), "feedback.jsonl")
			var service leaseStore
			if backend == "memory" {
				service = NewService(cfg)
			} else {
				redisServer := miniredis.RunT(t)
				rcfg := DefaultRedisConfig()
				rcfg.Addr = redisServer.Addr()
				var err error
				service, err = NewRedisService(cfg, rcfg)
				if err != nil {
					t.Fatal(err)
				}
			}
			t.Cleanup(func() { _ = service.Close() })
			run(t, service)
		})
	}
}

func seedLeaseCandidate(t *testing.T, service leaseStore) {
	t.Helper()
	result := service.UpsertBatch("test", []map[string]any{{
		"roomId": "123", "lotteryId": "456", "endTime": time.Now().Add(2 * time.Minute).UnixMilli(),
		"lotteryName": "礼品", "conditions": []any{map[string]any{"type": 3}, map[string]any{"type": 6}},
	}})
	if result.Inserted != 1 {
		t.Fatalf("candidate not inserted: %+v", result)
	}
}

func TestLeaseOwnershipIdempotenceAndRelease(t *testing.T) {
	testLeaseStores(t, func(t *testing.T, service leaseStore) {
		seedLeaseCandidate(t, service)
		owner := ClaimOwner{ClientID: "client", AccountID: "account"}
		options := ClaimOptions{Owner: owner, Profile: DefaultFilterProfile(), LeaseSec: 30}
		first, err := service.ClaimTask(options)
		if err != nil || !first.Claimed {
			t.Fatalf("claim: %+v %v", first, err)
		}
		repeat, err := service.ClaimTask(options)
		if err != nil || !repeat.Claimed || first.Lease.LeaseID != repeat.Lease.LeaseID {
			t.Fatalf("repeat claim: %+v %v", repeat, err)
		}
		stranger := ClaimOwner{ClientID: "client", AccountID: "stranger"}
		if _, ok, err := service.RenewTaskLease(stranger, first.Lease.LeaseID, 30); err != nil || ok {
			t.Fatal("stranger renewed lease", err)
		}
		if ok, err := service.ReleaseTaskLease(stranger, first.Lease.LeaseID, "test"); err != nil || ok {
			t.Fatal("stranger released lease", err)
		}
		if ok, err := service.FinishTaskLease(stranger, first.Lease.LeaseID, "join_success", true); err != nil || ok {
			t.Fatal("stranger finished lease", err)
		}
		if _, ok, err := service.RenewTaskLease(owner, first.Lease.LeaseID, 60); err != nil || !ok {
			t.Fatal("owner renewal failed", err)
		}
		if ok, err := service.ReleaseTaskLease(owner, first.Lease.LeaseID, "test"); err != nil || !ok {
			t.Fatal("owner release failed", err)
		}
		next, err := service.ClaimTask(ClaimOptions{Owner: stranger, Profile: DefaultFilterProfile()})
		if err != nil || !next.Claimed {
			t.Fatal("released task unavailable", err)
		}
	})
}

func TestConcurrentClaimRespectsCapacity(t *testing.T) {
	testLeaseStores(t, func(t *testing.T, service leaseStore) {
		seedLeaseCandidate(t, service)
		var wg sync.WaitGroup
		claims := make(chan ClaimResult, 24)
		for i := 0; i < 24; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				result, err := service.ClaimTask(ClaimOptions{Owner: ClaimOwner{ClientID: "client", AccountID: fmt.Sprint(i)}, Profile: DefaultFilterProfile()})
				if err != nil {
					t.Error(err)
				}
				if result.Claimed {
					claims <- result
				}
			}(i)
		}
		wg.Wait()
		close(claims)
		count, capacity := 0, 0
		for result := range claims {
			count++
			capacity = result.Lease.SlotLimit
		}
		if count == 0 || count > capacity {
			t.Fatalf("claimed %d with capacity %d", count, capacity)
		}
	})
}

func TestExpiredLeaseCannotRenewOrFinish(t *testing.T) {
	testLeaseStores(t, func(t *testing.T, service leaseStore) {
		seedLeaseCandidate(t, service)
		owner := ClaimOwner{ClientID: "client", AccountID: "account"}
		first, _ := service.ClaimTask(ClaimOptions{Owner: owner, Profile: DefaultFilterProfile()})
		if !first.Claimed {
			t.Fatal("initial claim failed")
		}
		expired := time.Now().Add(-time.Second).UnixMilli()
		switch s := service.(type) {
		case *Service:
			s.leaseMu.Lock()
			s.leases[first.Lease.LeaseID].ExpiresAtMS = expired
			s.leaseMu.Unlock()
		case *RedisService:
			first.Lease.ExpiresAtMS = expired
			raw, _ := json.Marshal(first.Lease)
			ctx := context.Background()
			s.rdb.HSet(ctx, s.keyLeases(), first.Lease.LeaseID, raw)
			s.rdb.ZAdd(ctx, s.keyLeaseExpire(), redis.Z{Score: float64(expired), Member: first.Lease.LeaseID})
		}
		if _, ok, err := service.RenewTaskLease(owner, first.Lease.LeaseID, 30); err != nil || ok {
			t.Fatal("expired lease renewed", err)
		}
		if ok, err := service.FinishTaskLease(owner, first.Lease.LeaseID, "join_success", true); err != nil || ok {
			t.Fatal("expired lease finished", err)
		}
	})
}

func TestCompletedLotteryCannotRegainSlotsWhenRescanned(t *testing.T) {
	testLeaseStores(t, func(t *testing.T, service leaseStore) {
		seedLeaseCandidate(t, service)
		owner := ClaimOwner{ClientID: "client", AccountID: "account"}
		first, err := service.ClaimTask(ClaimOptions{Owner: owner, Profile: DefaultFilterProfile()})
		if err != nil || !first.Claimed || first.Lease.SlotLimit != 1 {
			t.Fatal("expected one-slot fixture", first, err)
		}
		if ok, err := service.FinishTaskLease(owner, first.Lease.LeaseID, "join_success", true); err != nil || !ok {
			t.Fatal("finish failed", err)
		}
		if ok, err := service.FinishTaskLease(owner, first.Lease.LeaseID, "join_success", true); err != nil || ok {
			t.Fatal("finish repeated", err)
		}
		service.UpsertBatch("rescan", []map[string]any{{"roomId": "123", "lotteryId": "456", "endTime": time.Now().Add(2 * time.Minute).UnixMilli(), "conditions": []any{map[string]any{"type": 3}, map[string]any{"type": 6}}}})
		for _, accountID := range []string{"account", "other"} {
			result, err := service.ClaimTask(ClaimOptions{Owner: ClaimOwner{ClientID: "client", AccountID: accountID}, Profile: DefaultFilterProfile()})
			if err != nil || result.Claimed {
				t.Fatal("rescan restored completed capacity", result, err)
			}
		}
	})
}

func TestFeedbackIsDurableAndIdempotent(t *testing.T) {
	testLeaseStores(t, func(t *testing.T, service leaseStore) {
		feedback := TaskFeedback{Owner: ClaimOwner{ClientID: "client", AccountID: "account"}, LotteryID: "456", RoomID: "123", Event: "draw_won", RewardAmount: 10}
		for i := 0; i < 3; i++ {
			if err := service.RecordTaskFeedback(feedback); err != nil {
				t.Fatal(err)
			}
		}
		snapshot, err := service.LearningDebug(10)
		if err != nil || snapshot.Summary.FeedbackCount != 1 || snapshot.Summary.DrawWon != 1 {
			t.Fatalf("duplicate feedback counted: %+v %v", snapshot.Summary, err)
		}
		if s, ok := service.(*Service); ok {
			restored := NewService(s.cfg)
			defer restored.Close()
			replayed, _ := restored.LearningDebug(10)
			if replayed.Summary.FeedbackCount != 1 {
				t.Fatal("journal replay lost feedback", replayed)
			}
		}
	})
}
