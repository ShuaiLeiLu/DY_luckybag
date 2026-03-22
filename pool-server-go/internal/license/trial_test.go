package license

import (
	"database/sql"
	"testing"
	"time"
)

func TestNormalizeFeatureFlags(t *testing.T) {
	flags := normalizeFeatureFlags(map[string]any{
		"dashboard": true,
		"dispatch":  1,
		"executor":  "true",
		"disabled":  false,
		"empty":     "",
	})

	if !flags["dashboard"] || !flags["dispatch"] || !flags["executor"] {
		t.Fatalf("expected enabled flags to be normalized: %#v", flags)
	}
	if flags["disabled"] || flags["empty"] {
		t.Fatalf("expected disabled flags to be omitted: %#v", flags)
	}
}

func TestBuildTrialStatus(t *testing.T) {
	svc := &Service{}
	now := time.Date(2026, 3, 22, 10, 0, 0, 0, time.UTC)

	active := svc.buildTrialStatus(trialRow{
		Fingerprint: "fp-active",
		ClientID:    "client-active",
		Status:      "active",
		ExpireAt:    now.Add(48 * time.Hour),
	}, now)
	if !active.Authorized || active.AccessMode != "trial" || active.RequiresActivation {
		t.Fatalf("unexpected active trial status: %#v", active)
	}
	if active.TrialState != "active" {
		t.Fatalf("expected active trial state, got %q", active.TrialState)
	}

	expired := svc.buildTrialStatus(trialRow{
		Fingerprint: "fp-expired",
		ClientID:    "client-expired",
		Status:      "active",
		ExpireAt:    now.Add(-time.Hour),
	}, now)
	if expired.Authorized || expired.AccessMode != "locked" || !expired.RequiresActivation {
		t.Fatalf("unexpected expired trial status: %#v", expired)
	}
	if expired.TrialState != "expired" || expired.State != "trial_expired" {
		t.Fatalf("expected expired trial markers, got %#v", expired)
	}
}

func TestBuildLicensedStatusSetsAccessFields(t *testing.T) {
	svc := &Service{}
	now := time.Date(2026, 3, 22, 10, 0, 0, 0, time.UTC)
	status := svc.buildStatus(licenseRow{
		ID:           1,
		LicenseKey:   "DY-TEST-0001",
		CustomerName: "Tester",
		PlanName:     "pro",
		Status:       "active",
		ExpireAt:     now.Add(24 * time.Hour),
		MaxClients:   1,
		MaxAccounts:  10,
		FeaturesJSON: sql.NullString{String: `{"dispatch":true,"multiAccount":true}`, Valid: true},
	}, "client-1", "fp-1", now)

	if !status.Authorized || status.AccessMode != "licensed" {
		t.Fatalf("expected licensed authorized status, got %#v", status)
	}
	if status.LicensePlan != "pro" || !status.FeatureFlags["dispatch"] || !status.FeatureFlags["multiAccount"] {
		t.Fatalf("expected license metadata to be populated, got %#v", status)
	}
}
