package toolbox

import "kiao/worker/internal/core"

// Per-subsystem loggers, one per concern, so a line stays filterable with `component=<name>`.
var (
	logToolbox = core.Component("toolbox")         // the ledger, the platform, what is registered
	logInstall = core.Component("toolbox-install") // one install or uninstall job, step by step
)
