package claude

import (
	coreconfig "kiao/worker/internal/core/config"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"testing"
)

func TestClaudeResultUsageIncludesEveryModel(t *testing.T) {
	driver := &ClaudeDriver{cliVersion: "2.1.263"}
	event := map[string]any{
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 20},
		"modelUsage": map[string]any{
			"main":  map[string]any{"inputTokens": 10, "outputTokens": 20, "cacheReadInputTokens": 100, "cacheCreationInputTokens": 5},
			"child": map[string]any{"inputTokens": 20, "outputTokens": 30, "cacheReadInputTokens": 200, "cacheCreationInputTokens": 10},
		},
		"total_cost_usd": 0.01,
	}
	for range 2 {
		usage := driver.resultUsage(event)
		if usage == nil || usage.InputTokens != 345 || usage.OutputTokens != 50 ||
			usage.CacheReadTokens != 300 || usage.CacheWriteTokens != 15 || usage.TotalCostUSD != 0.01 {
			t.Fatalf("usage = %+v, want model totals counted once", usage)
		}
	}
}

func TestClaudeUsageWithoutModelTotalsAccumulatesResults(t *testing.T) {
	driver := &ClaudeDriver{}
	driver.resultUsage(map[string]any{"usage": map[string]any{"input_tokens": 10, "output_tokens": 20}})
	usage := driver.resultUsage(map[string]any{"usage": map[string]any{"input_tokens": 30, "output_tokens": 40}})
	if usage == nil || usage.InputTokens != 40 || usage.OutputTokens != 60 {
		t.Fatalf("usage = %+v, want both CLI turns in the worker turn", usage)
	}
}

func TestClaudeLaterResultWithoutModelsRetainsAdditionalUsage(t *testing.T) {
	driver := &ClaudeDriver{}
	driver.resultUsage(map[string]any{
		"usage":      map[string]any{"input_tokens": 100, "output_tokens": 20},
		"modelUsage": map[string]any{"main": map[string]any{"inputTokens": 100, "outputTokens": 20}},
	})
	usage := driver.resultUsage(map[string]any{"usage": map[string]any{"input_tokens": 10, "output_tokens": 5}})
	if usage == nil || usage.InputTokens != 110 || usage.OutputTokens != 25 {
		t.Fatalf("usage = %+v, want the additional result even without its model breakdown", usage)
	}
}

func TestClaudeResumedUsageSubtractsTheSavedSessionTotal(t *testing.T) {
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{StatePath: t.TempDir()}}
	first := &ClaudeDriver{cfg: cfg, cliVersion: "2.1.277 (Claude Code)"}
	event := func(input, output, cached int, cost float64) map[string]any {
		return map[string]any{
			"session_id": "session-1", "total_cost_usd": cost,
			"usage": map[string]any{"input_tokens": 10, "output_tokens": 5},
			"modelUsage": map[string]any{
				"main": map[string]any{"inputTokens": input, "outputTokens": output, "cacheReadInputTokens": cached},
			},
		}
	}
	first.resultUsage(event(100, 20, 1000, 0.01))
	resumed := &ClaudeDriver{cfg: cfg, cliVersion: "2.1.277", run: agentapi.AgentRun{SessionID: "session-1"}}
	resumed.loadUsageBaseline()
	usage := resumed.resultUsage(event(150, 30, 1200, 0.03))
	if usage == nil || usage.InputTokens != 250 || usage.OutputTokens != 10 || usage.CacheReadTokens != 200 ||
		usage.TotalCostUSD < 0.019999 || usage.TotalCostUSD > 0.020001 {
		t.Fatalf("usage = %+v, want only the resumed turn's spend", usage)
	}
	// Intermediate results replace the cumulative total against the original baseline.
	usage = resumed.resultUsage(event(160, 35, 1300, 0.04))
	if usage == nil || usage.InputTokens != 360 || usage.OutputTokens != 15 || usage.CacheReadTokens != 300 {
		t.Fatalf("usage = %+v, want the latest cumulative delta", usage)
	}
}

func TestClaudeResumedUsageWithoutBaselineRetainsTheTurnCounters(t *testing.T) {
	driver := &ClaudeDriver{cliVersion: "2.1.277", run: agentapi.AgentRun{SessionID: "legacy-session"}}
	usage := driver.resultUsage(map[string]any{
		"usage":      map[string]any{"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 100},
		"modelUsage": map[string]any{"main": map[string]any{"inputTokens": 10000, "outputTokens": 2000}},
	})
	if usage == nil || usage.InputTokens != 110 || usage.OutputTokens != 20 {
		t.Fatalf("usage = %+v, want this turn's counters rather than restored history", usage)
	}
}

func TestClaudePartialUsageSurvivesFailureWithoutDoubleCounting(t *testing.T) {
	driver, _ := newTranslator()
	driver.ReadEvent(`{"type":"system","subtype":"session_state_changed","state":"running"}`)
	driver.ReadEvent(`{"type":"stream_event","event":{"type":"message_start","message":{"id":"message-1","usage":{"input_tokens":10,"cache_read_input_tokens":100,"output_tokens":1}}}}`)
	events := driver.ReadEvent(`{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":12}}}`)
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage ||
		events[0].Usage.InputTokens != 110 || events[0].Usage.OutputTokens != 12 {
		t.Fatalf("events = %+v, want the completed response's counters", events)
	}
	duplicate := `{"type":"assistant","message":{"id":"message-1","usage":{"input_tokens":10,"cache_read_input_tokens":100,"output_tokens":1},"content":[]}}`
	if got := driver.ReadEvent(duplicate); len(got) != 0 {
		t.Fatalf("duplicate message changed usage: %+v", got)
	}
	driver.ReadEvent(`{"type":"result","is_error":true,"usage":{"input_tokens":0,"output_tokens":0}}`)
	if usage := driver.usageSnapshot(); usage.InputTokens != 110 || usage.OutputTokens != 12 {
		t.Fatalf("failed turn usage = %+v, want the last reported counters", usage)
	}
	final := driver.resultUsage(map[string]any{"usage": map[string]any{"input_tokens": 10, "cache_read_input_tokens": 100, "output_tokens": 12}})
	if final == nil || final.InputTokens != 110 || final.OutputTokens != 12 {
		t.Fatalf("final usage = %+v, want the result to replace partial counters", final)
	}
}

func TestClaudeChildUsageWithoutSessionBaselineIsRetainedOnce(t *testing.T) {
	driver, _ := newTranslator()
	driver.cliVersion = "2.1.277"
	driver.run.SessionID = "legacy-session"
	progress := `{"type":"system","subtype":"task_progress","task_id":"child-1","usage":{"total_tokens":50}}`
	driver.ReadEvent(progress)
	if got := driver.ReadEvent(progress); len(got) != 0 {
		t.Fatalf("duplicate task progress = %+v", got)
	}
	driver.ReadEvent(`{"type":"system","subtype":"task_notification","task_id":"child-1","usage":{"total_tokens":60}}`)
	usage := driver.resultUsage(map[string]any{"usage": map[string]any{"input_tokens": 10, "output_tokens": 20}})
	if usage == nil || usage.InputTokens != 70 || usage.OutputTokens != 20 {
		t.Fatalf("usage = %+v, want the child's unsplit total and this turn's main usage", usage)
	}
}
