package muse

import (
	"fmt"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museTokenUsage combines model completions, native turn retries and child snapshots.
// museHost.mu protects its state together with native turn identifiers.
type museTokenUsage struct {
	current   harnessapi.TurnUsage
	billed    bool
	completed harnessapi.TurnUsage
	previous  harnessapi.TurnUsage
	children  map[string]harnessapi.TurnUsage
}

func (u *museTokenUsage) noteModel(params map[string]any, afterCompletion bool) *harnessapi.TurnUsage {
	report, ok := readMuseUsage(params, nil)
	if !ok {
		return nil
	}
	if afterCompletion {
		u.completed.Add(*report)
	} else {
		u.current.Add(*report)
		u.billed = true
	}
	return u.snapshot()
}

func (u *museTokenUsage) noteChild(item map[string]any) *harnessapi.TurnUsage {
	if u.children == nil {
		u.children = map[string]harnessapi.TurnUsage{}
	}
	changed := false
	note := func(id string, raw any) {
		if id == "" {
			return
		}
		if usage, ok := harnessapi.ReadUsage(raw, nil, harnessapi.UsageScopeTurn); ok && u.children[id] != *usage {
			u.children[id] = *usage
			changed = true
		}
	}
	switch pkgProtocol.AsString(item["kind"]) {
	case "subagent":
		note(pkgProtocol.AsString(item["itemId"]), item["usage"])
	case "workflow":
		children, _ := item["children"].([]any)
		for _, raw := range children {
			child, _ := raw.(map[string]any)
			id := pkgProtocol.AsString(item["itemId"]) + "/" + pkgProtocol.AsString(child["childId"])
			if attempt, ok := pkgProtocol.AsInt64(child["attempt"]); ok {
				id += fmt.Sprintf("/%d", attempt)
			}
			note(id, child["usage"])
		}
	}
	if changed {
		return u.snapshot()
	}
	return nil
}

func (u *museTokenUsage) restart() {
	u.previous.Add(u.current)
	u.current = harnessapi.TurnUsage{}
	u.billed = false
}

// complete prefers the host's aggregate, filling omitted fields from model completions.
func (u *museTokenUsage) complete(params map[string]any) *harnessapi.TurnUsage {
	folded := u.take()
	usage, ok := readMuseUsage(params, folded)
	if !ok {
		usage = folded
	}
	if usage != nil {
		u.completed.Add(*usage)
	}
	return u.snapshot()
}

func (u *museTokenUsage) take() *harnessapi.TurnUsage {
	if !u.billed {
		return nil
	}
	u.billed = false
	billed := u.current
	u.current = harnessapi.TurnUsage{}
	billed.Scope = harnessapi.UsageScopeTurn
	return &billed
}

func (u *museTokenUsage) snapshot() *harnessapi.TurnUsage {
	billed := u.previous
	billed.Add(u.completed)
	billed.Add(u.current)
	for _, child := range u.children {
		billed.Add(child)
	}
	if billed == (harnessapi.TurnUsage{}) {
		return nil
	}
	billed.Scope = harnessapi.UsageScopeTurn
	return &billed
}

func readMuseUsage(params map[string]any, fallback *harnessapi.TurnUsage) (*harnessapi.TurnUsage, bool) {
	raw, _ := pkgProtocol.FirstOf(params, "usage", "sessionUsage", "tokens").(map[string]any)
	mapped := make(map[string]any, len(raw)+2)
	for key, value := range raw {
		mapped[key] = value
	}
	// MSP supplies the prompt total with its provider's cache convention already applied.
	if prompt := params["promptTokens"]; prompt != nil {
		mapped["inputTokens"] = prompt
	}
	if total := params["totalTokens"]; total != nil {
		mapped["totalTokens"] = total
	}
	if fallback != nil {
		fill := func(key string, value int64, aliases ...string) {
			if tokens, ok := pkgProtocol.AsInt64(pkgProtocol.FirstOf(mapped, aliases...)); !ok || tokens == 0 {
				mapped[key] = value
			}
		}
		fill("inputTokens", fallback.InputTokens, "inputTokens", "input_tokens", "totalInputTokens", "promptTokens", "prompt_tokens")
		fill("outputTokens", fallback.OutputTokens, "outputTokens", "output_tokens", "totalOutputTokens", "completion_tokens")
		fill("cacheReadTokens", fallback.CacheReadTokens, "cacheReadTokens", "cache_read_input_tokens", "cachedTokens", "cached_tokens")
		fill("cacheWriteTokens", fallback.CacheWriteTokens, "cacheWriteTokens", "cache_creation_input_tokens", "cache_write_tokens")
		fill("reasoningTokens", fallback.ReasoningTokens, "reasoningTokens", "reasoning_tokens")
		if amount, ok := pkgProtocol.AsFloat(pkgProtocol.FirstOf(mapped, "cost", "costUSD", "cost_usd", "totalCostUSD", "total_cost_usd")); !ok || amount == 0 {
			mapped["costUSD"] = fallback.TotalCostUSD
		}
	}
	return harnessapi.ReadUsage(mapped,
		pkgProtocol.FirstOf(params, "cost", "totalCostUSD", "total_cost_usd"), harnessapi.UsageScopeTurn)
}
