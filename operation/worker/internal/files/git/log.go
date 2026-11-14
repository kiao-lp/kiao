package git

import (
	"kiao/worker/internal/core/logging"
)

// Per-subsystem loggers, one per former bracketed prefix, so a line stays filterable with
// `component=<name>`. Package-level vars, so a call site is a single method invocation with no
// per-call allocation.
var logGit = logging.Component("git")
