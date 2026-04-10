package license

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const defaultTrialDays = 3

type trialRow struct {
	ID          int64
	Fingerprint string
	ClientID    string
	AppVersion  string
	Status      string
	StartedAt   time.Time
	ExpireAt    time.Time
	ActivatedAt sql.NullTime
}

func normalizeFeatureFlags(features map[string]any) map[string]bool {
	out := map[string]bool{}
	for key, raw := range features {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		if featureFlagEnabled(raw) {
			out[trimmed] = true
		}
	}
	return out
}

func featureFlagEnabled(raw any) bool {
	switch value := raw.(type) {
	case bool:
		return value
	case int:
		return value > 0
	case int32:
		return value > 0
	case int64:
		return value > 0
	case float32:
		return value > 0
	case float64:
		return value > 0
	case string:
		switch strings.TrimSpace(strings.ToLower(value)) {
		case "1", "true", "yes", "on", "enabled", "active":
			return true
		default:
			return false
		}
	default:
		return raw != nil
	}
}

func trialPlanName(days int) string {
	if days <= 0 {
		days = defaultTrialDays
	}
	return fmt.Sprintf("trial-%dd", days)
}

func defaultTrialFeatures(days int) map[string]any {
	features := defaultFullFeatures(days)
	features["trial"] = true
	features["dashboard"] = true
	features["dispatch"] = true
	features["multiAccount"] = true
	features["scanner"] = true
	features["executor"] = true
	return features
}

func (s *Service) StartTrial(ctx context.Context, req TrialRequest) (Status, error) {
	now := time.Now()
	base := Status{
		Enabled:            s != nil && s.cfg.Enabled,
		Available:          s != nil && s.db != nil,
		Authorized:         false,
		Unrestricted:       false,
		State:              "disabled",
		Message:            "未启用授权",
		CheckedAtMS:        now.UnixMilli(),
		Features:           map[string]any{},
		FeatureFlags:       map[string]bool{},
		AccessMode:         "disabled",
		TrialState:         "none",
		RequiresActivation: false,
	}
	if s == nil || !s.cfg.Enabled {
		return base, nil
	}
	if err := s.ensureRuntimeReady(ctx); err != nil {
		base.State = "backend_unavailable"
		base.Message = "授权服务不可用"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		base.Available = false
		return base, err
	}
	base.Available = true
	if unrestricted, err := s.IsUnrestricted(ctx); err == nil && unrestricted {
		return s.buildUnrestrictedStatus(now), nil
	} else if err != nil {
		base.State = "query_failed"
		base.Message = "授权查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	clientID := strings.TrimSpace(req.ClientID)
	fingerprint := normalizeMachineFingerprint(req.Fingerprint)
	if fingerprint == "" {
		base.State = "invalid_fingerprint"
		base.Message = "设备指纹无效，请重启客户端后重试"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, nil
	}

	if clientID != "" {
		status, err := s.Status(ctx, clientID, fingerprint)
		if err == nil && (status.Authorized || status.State == "trial_expired") {
			return status, nil
		}
		if err != nil && status.Available == false {
			return status, err
		}
	}

	row, err := s.findTrialByFingerprint(ctx, fingerprint)
	if err == sql.ErrNoRows {
		startedAt := now
		expireAt := now.Add(defaultTrialDays * 24 * time.Hour)
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO license_trials (
				fingerprint,
				client_id,
				app_version,
				status,
				started_at,
				expire_at,
				created_at,
				updated_at
			) VALUES (?, ?, ?, 'active', ?, ?, NOW(), NOW())
		`, fingerprint, clientID, strings.TrimSpace(req.AppVersion), startedAt, expireAt); err != nil {
			base.State = "trial_create_failed"
			base.Message = "试用创建失败"
			base.AccessMode = "locked"
			base.RequiresActivation = true
			return base, err
		}
		row, err = s.findTrialByFingerprint(ctx, fingerprint)
	}
	if err != nil {
		base.State = "query_failed"
		base.Message = "试用查询失败"
		base.AccessMode = "locked"
		base.RequiresActivation = true
		return base, err
	}

	_, _ = s.db.ExecContext(ctx, `
		UPDATE license_trials
		SET client_id = ?, app_version = ?, updated_at = NOW()
		WHERE id = ?
	`, clientID, strings.TrimSpace(req.AppVersion), row.ID)

	return s.buildTrialStatus(row, now), nil
}

func (s *Service) buildTrialStatus(row trialRow, now time.Time) Status {
	features := defaultTrialFeatures(defaultTrialDays)
	expireAtMS := row.ExpireAt.UnixMilli()
	remainingSec := maxTrialRemainingSec(0, row.ExpireAt.Unix()-now.Unix())
	state := strings.TrimSpace(strings.ToLower(row.Status))
	if state == "" {
		state = "active"
	}
	if row.ActivatedAt.Valid {
		state = "activated"
	}
	if !row.ExpireAt.IsZero() && !row.ExpireAt.After(now) && state != "activated" {
		state = "expired"
	}

	authorized := state == "active"
	message := "试用有效"
	accessMode := "trial"
	requiresActivation := false
	switch state {
	case "expired":
		message = "试用已过期，请激活授权"
		accessMode = "locked"
		requiresActivation = true
	case "activated":
		message = "试用已结束，请使用正式授权"
		accessMode = "locked"
		requiresActivation = true
	default:
		state = "trial_active"
	}
	if state == "expired" {
		state = "trial_expired"
	}

	return Status{
		Enabled:            true,
		Available:          true,
		Authorized:         authorized,
		Unrestricted:       false,
		State:              state,
		Message:            message,
		Features:           features,
		FeatureFlags:       normalizeFeatureFlags(features),
		AccessMode:         accessMode,
		TrialState:         strings.TrimPrefix(state, "trial_"),
		TrialExpireAtMS:    expireAtMS,
		TrialRemainingSec:  remainingSec,
		RequiresActivation: requiresActivation,
		LicensePlan:        trialPlanName(defaultTrialDays),
		Plan:               trialPlanName(defaultTrialDays),
		BoundClient:        strings.TrimSpace(row.ClientID),
		CheckedAtMS:        now.UnixMilli(),
	}
}

func (s *Service) findTrialByFingerprint(ctx context.Context, fingerprint string) (trialRow, error) {
	row := trialRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id,
			fingerprint,
			client_id,
			app_version,
			status,
			started_at,
			expire_at,
			activated_at
		FROM license_trials
		WHERE fingerprint = ?
		LIMIT 1
	`, strings.TrimSpace(fingerprint)).Scan(
		&row.ID,
		&row.Fingerprint,
		&row.ClientID,
		&row.AppVersion,
		&row.Status,
		&row.StartedAt,
		&row.ExpireAt,
		&row.ActivatedAt,
	)
	return row, err
}

func (s *Service) markTrialActivatedTx(ctx context.Context, tx *sql.Tx, fingerprint string) error {
	trimmed := strings.TrimSpace(fingerprint)
	if trimmed == "" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE license_trials
		SET status = 'activated',
		    activated_at = NOW(),
		    updated_at = NOW()
		WHERE fingerprint = ?
	`, trimmed)
	return err
}

func maxTrialRemainingSec(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
