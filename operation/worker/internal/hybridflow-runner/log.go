package hybridflowrunner

import "kiao/worker/internal/core"

// Per-subsystem loggers, one per former bracketed prefix, so a line stays filterable with
// `component=<name>`. Package-level vars, so a call site is a single method invocation with no
// per-call allocation.
var (
	logClaudeWS  = core.Component("claude-ws")    // /ws/hybridflow-runner session and job events
	logUsage     = core.Component("claude-usage") // /hybridflow-runner/usage probe
	logLogin     = core.Component("claude-login") // /hybridflow-runner/auth/* sign-in flow
	logMuseLogin = core.Component("muse-login")   // POST /hybridflow-runner/auth/muse/key sign-in
	logConv      = core.Component("claude-conv")  // conversation registry
	logChainRun  = core.Component("chain-run")    // the hybridflow chain runs: what is playing, and why it stopped
	logSkills    = core.Component("skills")       // bundled skills installed into the store
)
