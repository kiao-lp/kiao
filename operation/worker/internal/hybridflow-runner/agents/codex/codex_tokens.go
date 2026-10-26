package codex

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
)

// readCodexUsage maps the exec/SDK turn.completed bill into the shared counters. Keep this
// translation here: Claude and Muse spell cache counters differently, and changing their reader
// to interpret Codex totals would change the meaning of their existing reports.
//
// Codex input_tokens includes its cache reads and writes; output_tokens includes reasoning.
// Preserve those totals and carry the breakdowns beside them, without adding them a second time.
// Codex reports no dollar price, so the bill stays unpriced unless one is explicitly supplied.
func ReadCodexUsage(raw, cost any) (*agentapi.TurnUsage, bool) {
	usage, ok := raw.(map[string]any)
	if !ok {
		return agentapi.ReadUsage(raw, cost, agentapi.UsageScopeTurn)
	}
	mapped := make(map[string]any, len(usage)+2)
	for key, value := range usage {
		mapped[key] = value
	}
	if value := protocol.FirstOf(usage, "cached_input_tokens", "cachedInputTokens"); value != nil {
		mapped["cache_read_input_tokens"] = value
	}
	if value := protocol.FirstOf(usage, "cache_write_input_tokens", "cacheWriteInputTokens"); value != nil {
		mapped["cache_creation_input_tokens"] = value
	}
	report, found := agentapi.ReadUsage(mapped, cost, agentapi.UsageScopeTurn)
	if report == nil {
		report = &agentapi.TurnUsage{Scope: agentapi.UsageScopeTurn}
	}
	if reasoning, ok := protocol.AsInt64(protocol.FirstOf(usage, "reasoning_output_tokens", "reasoningOutputTokens")); ok {
		report.ReasoningTokens = reasoning
		found = found || reasoning != 0
	}
	if !found {
		return nil, false
	}
	return report, true
}
