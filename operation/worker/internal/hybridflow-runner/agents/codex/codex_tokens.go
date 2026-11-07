package codex

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
)

// Codex totals include cache and reasoning; the remaining counters are breakdowns.
func ReadCodexUsage(raw, cost any) (*agentapi.TurnUsage, bool) {
	return agentapi.ReadUsage(raw, cost, agentapi.UsageScopeTurn)
}
