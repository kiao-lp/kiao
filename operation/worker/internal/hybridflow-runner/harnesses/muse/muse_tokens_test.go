package muse

import (
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"testing"
)

func TestMuseUsageIncludesUpdatedChildrenAfterTheParentEnds(t *testing.T) {
	driver := &MuseDriver{TurnID: "turn-1"}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{"inputTokens": 100, "outputTokens": 20}})
	child := func(input, output int) map[string]any {
		return map[string]any{"item": map[string]any{
			"kind": "subagent", "itemId": "child-1", "turnId": "turn-1", "status": "completed",
			"usage": map[string]any{"inputTokens": input, "outputTokens": output, "reasoningTokens": 5},
		}}
	}
	driver.CompletedItem(child(30, 10))
	driver.CompletedItem(child(40, 15))
	for _, event := range driver.CompletedItem(child(40, 15)) {
		if event.Kind == harnessapi.EventUsage {
			t.Fatalf("duplicate child usage = %+v", event.Usage)
		}
	}
	_, _, _, events := driver.TurnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed"})
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 140 || usage.OutputTokens != 35 || usage.ReasoningTokens != 5 {
		t.Fatalf("usage = %+v, want parent and the latest child snapshot", usage)
	}
	events = driver.CompletedItem(child(60, 18))
	if len(events) == 0 || events[0].Kind != harnessapi.EventUsage || events[0].Usage.InputTokens != 160 || events[0].Usage.OutputTokens != 38 {
		t.Fatalf("late child usage = %+v, want its updated snapshot added to the parent", events)
	}
}

func TestMuseTerminalCostDoesNotDiscardCompletionTokens(t *testing.T) {
	driver := &MuseDriver{TurnID: "turn-1"}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 50, "reasoningTokens": 10,
	}})
	_, _, _, events := driver.TurnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed", "cost": 0.01})
	if len(events) != 1 || events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 ||
		events[0].Usage.CacheReadTokens != 50 || events[0].Usage.ReasoningTokens != 10 || events[0].Usage.TotalCostUSD != 0.01 {
		t.Fatalf("events = %+v, want completion tokens and the terminal cost", events)
	}
}

func TestMuseTerminalTotalKeepsTheCompletionSplit(t *testing.T) {
	driver := &MuseDriver{TurnID: "turn-1"}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 50,
	}})
	_, _, _, events := driver.TurnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed", "totalTokens": 120})
	if len(events) != 1 || events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 {
		t.Fatalf("events = %+v, want the terminal total counted once with its known split", events)
	}
}

func TestMuseWorkflowUsageKeepsEachAttemptOnce(t *testing.T) {
	driver := &MuseDriver{TurnID: "turn-1"}
	item := map[string]any{"kind": "workflow", "itemId": "workflow-1", "turnId": "turn-1", "children": []any{
		map[string]any{"childId": "child-1", "attempt": 1, "usage": map[string]any{"inputTokens": 100, "outputTokens": 20}},
		map[string]any{"childId": "child-1", "attempt": 2, "usage": map[string]any{"inputTokens": 50, "outputTokens": 10}},
	}}
	usage := driver.noteChildUsage(item)
	if usage == nil || usage.InputTokens != 150 || usage.OutputTokens != 30 {
		t.Fatalf("workflow usage = %+v, want both attempts", usage)
	}
	if duplicate := driver.noteChildUsage(item); duplicate != nil {
		t.Fatalf("duplicate workflow usage = %+v", duplicate)
	}
}

func TestMuseManualCompactionRetainsItsObservedUsage(t *testing.T) {
	driver := &MuseDriver{Compacting: true, sessionID: "session-1"}
	driver.NoteTokenUsage(map[string]any{"sessionId": "session-1", "promptTokens": 100, "totalTokens": 120,
		"usage": map[string]any{"inputTokens": 100, "outputTokens": 20},
	})
	events := driver.CompletedItem(map[string]any{"item": map[string]any{"kind": "compaction", "itemId": "compact-1"}})
	if len(events) != 3 || events[0].Kind != harnessapi.EventUsage ||
		events[0].Usage.InputTokens != 100 || events[0].Usage.OutputTokens != 20 || events[2].Kind != harnessapi.EventDone {
		t.Fatalf("events = %+v, want compaction usage before settlement", events)
	}
}
