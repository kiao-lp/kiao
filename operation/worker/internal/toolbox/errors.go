package toolbox

import "kiao/worker/internal/core"

// Sentinels map to HTTP 400 via core.StatusForError; their text is user-facing.
var (
	errUnknownComponent = core.Invalid("unknown component")
	// A catalogue build error, surfaced by the request that traverses the cycle.
	errCatalogCycle    = core.Invalid("the catalogue declares a dependency cycle")
	errToolboxDisabled = core.Invalid("this deployment has no toolbox: KIAO_WORKER_TOOLBOX_PATH is not set")
	// Serialize package-manager jobs to avoid races in shared caches.
	errJobRunning    = core.Invalid("an install is already running")
	errNotHere       = core.Invalid("this component cannot be installed on this system")
	errStillRequired = core.Invalid("still required by another installed component")
	// The ledger prevents removal of tools installed outside this service.
	errNotInstalled = core.Invalid("not installed by this service")
	// Failed probes prevent handing a broken server to every turn.
	errNotAnswering = core.Invalid("this server did not answer when it was last started; install it again")
	// Only the current or last job is retained.
	errNoJob = core.Invalid("unknown job")
)
