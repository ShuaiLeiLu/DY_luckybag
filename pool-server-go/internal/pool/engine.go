package pool

type Engine interface {
	Profile() (FilterProfile, int64)
	UpdateProfile(patch map[string]any) (FilterProfile, int64)
	UpsertBatch(sourceID string, raws []map[string]any) BatchResult
	SweepExpired(nowMS int64)
	RefreshTop(force bool)
	Top(limit int) (items []ScoredCandidate, meta TopMeta, profileVersion int64)
	Stats() (Stats, TopMeta, int64)
	Close() error
}

