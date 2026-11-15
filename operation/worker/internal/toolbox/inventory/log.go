package inventory

import (
	"kiao/worker/internal/core/logging"
)

// Per-subsystem loggers, one per concern, so a line stays filterable with `component=<name>`.
var (
	LogToolbox = logging.Component("toolbox")         // the ledger, the platform, what is registered
	LogInstall = logging.Component("toolbox-install") // one install or uninstall job, step by step
)
