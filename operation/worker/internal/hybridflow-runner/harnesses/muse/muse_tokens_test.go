package muse

import (
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"testing"
)

func TestMuseUsageIncludesUpdatedChildrenAfterTheParentEnds(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{"inputTokens": 100, "outputTokens": 20}})
	child := func(input, output int) map[string]any {
		return map[string]any{"item": map[string]any{
			"kind": "subagent", "itemId": "child-1", "turnId": "turn-1", "status": "completed",
			"usage": map[string]any{"inputTokens": input, "outputTokens": output, "reasoningTokens": 5},
		}}
	}
	driver.completedItem(child(30, 10))
	driver.completedItem(child(40, 15))
	for _, event := range driver.completedItem(child(40, 15)) {
		if event.Kind == harnessapi.EventUsage {
			t.Fatalf("duplicate child usage = %+v", event.Usage)
		}
	}
	_, _, _, events := driver.turnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed"})
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 140 || usage.OutputTokens != 35 || usage.ReasoningTokens != 5 {
		t.Fatalf("usage = %+v, want parent and the latest child snapshot", usage)
	}
	events = driver.completedItem(child(60, 18))
	if len(events) == 0 || events[0].Kind != harnessapi.EventUsage || events[0].Usage.InputTokens != 160 || events[0].Usage.OutputTokens != 38 {
		t.Fatalf("late child usage = %+v, want its updated snapshot added to the parent", events)
	}
}

func TestMuseTerminalCostDoesNotDiscardCompletionTokens(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 50, "reasoningTokens": 10,
	}})
	_, _, _, events := driver.turnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed", "cost": 0.01})
	if len(events) != 1 || events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 ||
		events[0].Usage.CacheReadTokens != 50 || events[0].Usage.ReasoningTokens != 10 || events[0].Usage.TotalCostUSD != 0.01 {
		t.Fatalf("events = %+v, want completion tokens and the terminal cost", events)
	}
}

func TestMuseTerminalTotalKeepsTheCompletionSplit(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 50,
	}})
	_, _, _, events := driver.turnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed", "totalTokens": 120})
	if len(events) != 1 || events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 {
		t.Fatalf("events = %+v, want the terminal total counted once with its known split", events)
	}
}

func TestMuseWorkflowUsageKeepsEachAttemptOnce(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	item := map[string]any{"kind": "workflow", "itemId": "workflow-1", "turnId": "turn-1", "children": []any{
		map[string]any{"childId": "child-1", "attempt": 1, "usage": map[string]any{"inputTokens": 100, "outputTokens": 20}},
		map[string]any{"childId": "child-1", "attempt": 2, "usage": map[string]any{"inputTokens": 50, "outputTokens": 10}},
	}}
	usage := driver.host.noteChildUsage(item)
	if usage == nil || usage.InputTokens != 150 || usage.OutputTokens != 30 {
		t.Fatalf("workflow usage = %+v, want both attempts", usage)
	}
	if duplicate := driver.host.noteChildUsage(item); duplicate != nil {
		t.Fatalf("duplicate workflow usage = %+v", duplicate)
	}
}

func TestMuseManualCompactionRetainsItsObservedUsage(t *testing.T) {
	driver := &MuseDriver{host: museHost{compacting: true, sessionID: "session-1"}}
	driver.host.noteTokenUsage(map[string]any{"sessionId": "session-1", "promptTokens": 100, "totalTokens": 120,
		"usage": map[string]any{"inputTokens": 100, "outputTokens": 20},
	})
	events := driver.completedItem(map[string]any{"item": map[string]any{"kind": "compaction", "itemId": "compact-1"}})
	if len(events) != 3 || events[0].Kind != harnessapi.EventUsage ||
		events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 || events[2].Kind != harnessapi.EventDone {
		t.Fatalf("events = %+v, want compaction usage before settlement", events)
	}
}

func TestMuseUsageRetainsLateModelCompletions(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{"inputTokens": 100, "outputTokens": 20}})
	driver.turnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed"})

	usage := driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{"inputTokens": 30, "outputTokens": 5}})
	if usage == nil || usage.InputTokens != 130 || usage.OutputTokens != 25 || usage.Scope != harnessapi.UsageScopeTurn {
		t.Fatalf("late model usage = %+v, want the completed turn and its late completion", usage)
	}
	if ignored := driver.host.noteTokenUsage(map[string]any{"turnId": "other", "usage": map[string]any{"inputTokens": 999}}); ignored != nil {
		t.Fatalf("foreign model usage = %+v", ignored)
	}
	if pending := driver.host.takeTurnUsage(); pending != nil {
		t.Fatalf("pending usage = %+v, want late usage already included in the completed bill", pending)
	}
	if usage.InputTokens != 130 || usage.OutputTokens != 25 {
		t.Fatalf("published snapshot changed: %+v", usage)
	}
}

func TestMuseCompactionUsageSettlement(t *testing.T) {
	for _, tc := range []struct {
		name     string
		observed map[string]any
		terminal map[string]any
		want     *harnessapi.TurnUsage
	}{
		{name: "unknown"},
		{
			name:     "aggregate replaces completions",
			observed: map[string]any{"inputTokens": 100, "outputTokens": 20},
			terminal: map[string]any{"usage": map[string]any{"inputTokens": 150, "outputTokens": 30}},
			want:     &harnessapi.TurnUsage{InputTokens: 150, OutputTokens: 30, Scope: harnessapi.UsageScopeTurn},
		},
		{
			name:     "cost supplements completions",
			observed: map[string]any{"inputTokens": 100, "outputTokens": 20},
			terminal: map[string]any{"cost": 0.01},
			want:     &harnessapi.TurnUsage{InputTokens: 100, OutputTokens: 20, TotalCostUSD: 0.01, Scope: harnessapi.UsageScopeTurn},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			driver := &MuseDriver{host: museHost{compacting: true, sessionID: "session-1"}}
			driver.host.noteTokenUsage(map[string]any{"sessionId": "other", "usage": map[string]any{"inputTokens": 999}})
			if tc.observed != nil {
				driver.host.noteTokenUsage(map[string]any{"sessionId": "session-1", "usage": tc.observed})
			}
			item := map[string]any{"kind": "compaction", "itemId": "compact-1"}
			for key, value := range tc.terminal {
				item[key] = value
			}
			events := driver.completedItem(map[string]any{"item": item})
			if tc.want != nil {
				if len(events) != 3 || events[0].Kind != harnessapi.EventUsage || events[0].Usage == nil || *events[0].Usage != *tc.want {
					t.Fatalf("events = %+v, want compaction usage %+v before settlement", events, tc.want)
				}
				events = events[1:]
			}
			if len(events) != 2 || events[0].Kind != harnessapi.EventBlock || events[1].Kind != harnessapi.EventDone || events[1].ExitCode != 0 {
				t.Fatalf("settlement = %+v, want the compaction block and successful completion", events)
			}
			if pending := driver.host.takeTurnUsage(); pending != nil {
				t.Fatalf("pending compaction usage = %+v", pending)
			}
		})
	}
}
