package hybridflowrunner

// readCodexUsage maps the exec/SDK turn.completed bill into the shared counters. Keep this
// translation here: Claude and Muse spell cache counters differently, and changing their reader
// to interpret Codex totals would change the meaning of their existing reports.
//
// Codex input_tokens includes its cache reads and writes; output_tokens includes reasoning.
// Preserve those totals and carry the breakdowns beside them, without adding them a second time.
// Codex reports no dollar price, so the bill stays unpriced unless one is explicitly supplied.
func readCodexUsage(raw, cost any) (*turnUsage, bool) {
	usage, ok := raw.(map[string]any)
	if !ok {
		return readUsage(raw, cost, usageScopeTurn)
	}
	mapped := make(map[string]any, len(usage)+2)
	for key, value := range usage {
		mapped[key] = value
	}
	if value := firstOf(usage, "cached_input_tokens", "cachedInputTokens"); value != nil {
		mapped["cache_read_input_tokens"] = value
	}
	if value := firstOf(usage, "cache_write_input_tokens", "cacheWriteInputTokens"); value != nil {
		mapped["cache_creation_input_tokens"] = value
	}
	report, found := readUsage(mapped, cost, usageScopeTurn)
	if report == nil {
		report = &turnUsage{Scope: usageScopeTurn}
	}
	if reasoning, ok := asInt64(firstOf(usage, "reasoning_output_tokens", "reasoningOutputTokens")); ok {
		report.ReasoningTokens = reasoning
		found = found || reasoning != 0
	}
	if !found {
		return nil, false
	}
	return report, true
}
