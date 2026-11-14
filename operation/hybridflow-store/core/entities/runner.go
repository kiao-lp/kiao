package entities

import (
	"time"
)

// Runner is a machine that plays cards. Tasks may pin its ID or run where Play is pressed.
// Task references have no foreign key: deleting a runner preserves the requested ID
// so the task can still open and report the missing runner at play time.
type Runner struct {
	// ID is service-generated.
	ID string
	// Name is unique across the store, case-insensitively.
	Name string
	// LastSeen is heartbeat-only; nil means never seen. Renaming must not change it.
	LastSeen  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
	Revision  int64
}

// RunnerPatch excludes the stable ID and heartbeat-owned LastSeen.
type RunnerPatch struct {
	Name *string
}

func (p RunnerPatch) Empty() bool {
	return p.Name == nil
}
