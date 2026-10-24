package faults

import (
	"kiao/worker/internal/core/errors"
)

// Sentinels map to HTTP 400 via core.StatusForError; their text is user-facing.
var (
	ErrUnknownComponent = faults.Invalid("unknown component")
	// A catalogue build error, surfaced by the request that traverses the cycle.
	ErrCatalogCycle    = faults.Invalid("the catalogue declares a dependency cycle")
	ErrToolboxDisabled = faults.Invalid("this deployment has no toolbox: KIAO_WORKER_TOOLBOX_PATH is not set")
	// Serialize package-manager jobs to avoid races in shared caches.
	ErrJobRunning    = faults.Invalid("an install is already running")
	ErrNotHere       = faults.Invalid("this component cannot be installed on this system")
	ErrStillRequired = faults.Invalid("still required by another installed component")
	// The ledger prevents removal of tools installed outside this service.
	ErrNotInstalled = faults.Invalid("not installed by this service")
	// Failed probes prevent handing a broken server to every turn.
	ErrNotAnswering = faults.Invalid("this server did not answer when it was last started; install it again")
	// Only the current or last job is retained.
	ErrNoJob = faults.Invalid("unknown job")
)
