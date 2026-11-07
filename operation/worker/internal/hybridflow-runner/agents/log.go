package agents

import (
	"kiao/worker/internal/core/logging"
)

// Per-subsystem loggers, one per former bracketed prefix, so a line stays filterable with
// `component=<name>`. Package-level vars, so a call site is a single method invocation with no
// per-call allocation.
var LogClaudeWS = logging.Component("claude-ws")

var LogUsage = logging.Component("claude-usage")

var LogLogin = logging.Component("claude-login")

var LogAgentLogin = logging.Component("agent-login")
