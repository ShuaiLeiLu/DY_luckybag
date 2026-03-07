package pool

type Engine interface {
	Profile() (FilterProfile, int64)
	UpdateProfile(patch map[string]any) (FilterProfile, int64)
	UpsertBatch(sourceID string, raws []map[string]any) BatchResult
	SweepExpired(nowMS int64)
	RefreshTop(force bool)
	Top(limit int) (items []ScoredCandidate, meta TopMeta, profileVersion int64)
	TopWithProfile(limit int, profile FilterProfile) (items []ScoredCandidate, meta TopMeta, profileVersion int64)
	TopAvailable(limit int, profile FilterProfile, owner ClaimOwner, includeClaimedSelf bool) (items []ScoredCandidate, meta TopMeta, profileVersion int64)
	ClaimTask(options ClaimOptions) (ClaimResult, error)
	ReviewTask(options ReviewOptions) (ReviewResult, error)
	RenewTaskLease(owner ClaimOwner, leaseID string, leaseSec int64) (*LeaseInfo, bool, error)
	ReleaseTaskLease(owner ClaimOwner, leaseID string, reason string) (bool, error)
	FinishTaskLease(owner ClaimOwner, leaseID string, result string, removeCandidate bool) (bool, error)
	RecordTaskFeedback(feedback TaskFeedback) error
	ScanPermit(options ScanPermitOptions) (ScanPermitResult, error)
	ClaimAllScanCursor(options AllScanClaimOptions) (AllScanClaimResult, error)
	ReportAllScanCursor(options AllScanReportOptions) (AllScanReportResult, error)
	ScanAssignment(clientID string, categoryIDs []string, telemetry ScanTelemetry) (ScanAssignment, error)
	TaskDebug(profile FilterProfile, owner ClaimOwner, leaseLimit int) (TaskDebugSnapshot, int64)
	LearningDebug(limit int) (LearningDebugSnapshot, error)
	Stats() (Stats, TopMeta, int64)
	Close() error
}
