package hybridflowrunner

import (
	"encoding/json"
	"testing"
)

// The roster the muse driver reports: delegations opening, updating and
// completing, workflows folding their children, and everything that is none of
// the turn's business staying out of it.

// rosterFeed runs one host notification through a hand-made driver and answers
// what it sent. The channel is drained, not read once: a completion answers
// the roster settling beside the block it files.
func rosterFeed(t *testing.T, driver *museDriver, method string, item map[string]any) []AgentEvent {
	t.Helper()
	params, err := json.Marshal(map[string]any{"sessionId": "ses-1", "item": item})
	if err != nil {
		t.Fatalf("encode the notification: %v", err)
	}
	if done, _, _ := driver.relayOne(mspNotification{Method: method, Params: params}); done {
		t.Fatalf("relayOne(%s) ended the turn", method)
	}
	var events []AgentEvent
	for {
		select {
		case event := <-driver.events:
			events = append(events, event)
		default:
			return events
		}
	}
}

func rosterDriver(t *testing.T) *museDriver {
	t.Helper()
	trace, _ := museTrace(t)
	driver := &museDriver{
		events: make(chan AgentEvent, 16),
		run:    AgentRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	driver.turnID = "turn-1"
	return driver
}

// rosterTask picks the roster's row for one id out of a background event.
func rosterTask(t *testing.T, event AgentEvent, id string) BackgroundTask {
	t.Helper()
	if event.Kind != agentBackground {
		t.Fatalf("event = %+v, want the roster", event)
	}
	for _, task := range event.Background {
		if task.ID == id {
			return task
		}
	}
	t.Fatalf("roster = %+v, want task %q", event.Background, id)
	return BackgroundTask{}
}

func TestMuseRosterReportsASubagentLifecycle(t *testing.T) {
	driver := rosterDriver(t)
	started := rosterFeed(t, driver, "item/started", map[string]any{
		"kind": "subagent", "itemId": "item-s1", "turnId": "turn-1",
		"status": "inProgress", "controlStatus": "starting", "role": "scout",
	})
	if len(started) != 1 {
		t.Fatalf("started events = %+v, want the roster alone", started)
	}
	opened := rosterTask(t, started[0], "item-s1")
	if opened.Label != `subagent "scout"` || opened.Status != "starting" || opened.State != BackgroundRunning {
		t.Errorf("opened = %+v, want the delegation running on its control word", opened)
	}
	// A second delegation joins in first-sight order: the roster is the turn's
	// whole account of what it handed off, not just the latest.
	rosterFeed(t, driver, "item/started", map[string]any{
		"kind": "subagent", "itemId": "item-s2", "turnId": "turn-1",
		"status": "inProgress", "controlStatus": "running", "role": "writer",
	})
	// Quarantined by the host: parked on its owner, neither running nor
	// finished — the wait that never ends if it counts as either.
	parked := rosterFeed(t, driver, "item/updated", map[string]any{
		"kind": "subagent", "itemId": "item-s1", "turnId": "turn-1",
		"status": "inProgress", "controlStatus": "manualReconciliation", "role": "scout",
	})
	if len(parked) != 1 {
		t.Fatalf("parked events = %+v, want the roster alone", parked)
	}
	waiting := rosterTask(t, parked[0], "item-s1")
	if waiting.Status != "manualReconciliation" || waiting.State != BackgroundWaiting {
		t.Errorf("parked = %+v, want the delegation waiting on its owner", waiting)
	}
	if kept := rosterTask(t, parked[0], "item-s2"); kept.State != BackgroundRunning {
		t.Errorf("other delegation = %+v, want it still running", kept)
	}
	// Landing files the roster settling beside the block: the state first, so
	// a block with nothing to say still settles the row.
	landed := rosterFeed(t, driver, "item/completed", map[string]any{
		"kind": "subagent", "itemId": "item-s1", "turnId": "turn-1",
		"status": "completed", "role": "scout", "fallbackText": "scouted",
	})
	if len(landed) != 2 || landed[0].Kind != agentBackground || landed[1].Kind != agentBlock {
		t.Fatalf("landed events = %+v, want the roster settling and the block", landed)
	}
	finished := rosterTask(t, landed[0], "item-s1")
	if finished.Status != "completed" || finished.State != BackgroundFinished {
		t.Errorf("landed = %+v, want the delegation finished on its verdict", finished)
	}
	// A terminal word on an update — the completion took another path — marks
	// the row finished rather than dropping a task already shown.
	terminal := rosterFeed(t, driver, "item/updated", map[string]any{
		"kind": "subagent", "itemId": "item-s2", "turnId": "turn-1",
		"status": "failed", "role": "writer",
	})
	if len(terminal) != 1 {
		t.Fatalf("terminal events = %+v, want the roster alone", terminal)
	}
	if failed := rosterTask(t, terminal[0], "item-s2"); failed.Status != "failed" ||
		failed.State != BackgroundFinished {
		t.Errorf("terminal = %+v, want the delegation finished on its verdict", failed)
	}
}

func TestMuseRosterIgnoresForeignItems(t *testing.T) {
	driver := rosterDriver(t)
	feeds := []struct {
		method string
		item   map[string]any
	}{
		// Another turn's work is none of this turn's business.
		{"item/started", map[string]any{"kind": "workflow", "itemId": "item-old",
			"turnId": "turn-0", "status": "inProgress", "entryId": "old"}},
		{"item/completed", map[string]any{"kind": "workflow", "itemId": "item-old",
			"turnId": "turn-0", "status": "completed", "fallbackText": "old"}},
		// Not background work at all: a foreground call, the turn's own words.
		{"item/started", map[string]any{"kind": "toolCall", "itemId": "item-fg",
			"turnId": "turn-1", "status": "inProgress", "tool": "Read"}},
		{"item/completed", map[string]any{"kind": "agentMessage", "itemId": "item-1",
			"turnId": "turn-1", "text": "thinking out loud"}},
	}
	for _, feed := range feeds {
		for _, event := range rosterFeed(t, driver, feed.method, feed.item) {
			if event.Kind == agentBackground {
				t.Errorf("relayOne(%s %v) sent the roster: %+v", feed.method, feed.item["itemId"], event)
			}
		}
	}
	if len(driver.rosterOrder) != 0 {
		t.Errorf("roster = %+v, want nothing filed", driver.roster)
	}
}

func TestMuseRosterState(t *testing.T) {
	cases := []struct {
		name    string
		generic string
		fine    string
		want    BackgroundState
	}{
		{"running delegation", "inProgress", "running", BackgroundRunning},
		{"delegation with a result", "inProgress", "resultReady", BackgroundRunning},
		{"parked delegation", "inProgress", "manualReconciliation", BackgroundWaiting},
		{"parked delegation in durable words", "inProgress", "manual_reconciliation", BackgroundWaiting},
		{"landed delegation", "completed", "closed", BackgroundFinished},
		{"failed delegation", "failed", "", BackgroundFinished},
		{"unknown verdict", "timedOut", "", BackgroundFinished},
		{"wordless item", "", "", BackgroundRunning},
	}
	for _, tc := range cases {
		if got := museRosterState(tc.generic, tc.fine); got != tc.want {
			t.Errorf("museRosterState(%q, %q) = %q, want %q", tc.generic, tc.fine, got, tc.want)
		}
	}
}

func TestMuseRosterChildren(t *testing.T) {
	children := museRosterChildren(map[string]any{
		"children": []any{
			map[string]any{"childId": "kept", "attempt": 1, "status": "completed", "label": "kept"},
			// Retried: the second attempt replaces the first in place, keeping
			// first-sight order — one row per child, or the counts lie.
			map[string]any{"childId": "retried", "attempt": 1, "status": "failed", "terminal": "failed"},
			map[string]any{"childId": "retried", "attempt": 2, "status": "running"},
			// The explicit verdict wins over a stale lifecycle word.
			map[string]any{"childId": "stale", "attempt": 1, "status": "running", "terminal": "cancelled"},
			// Parked on its owner, like a delegation.
			map[string]any{"childId": "parked", "attempt": 1, "status": "manualReconciliation"},
			// Without a label the id is what shows; without either it is no row.
			map[string]any{"childId": "bare", "attempt": 1, "status": "running"},
			map[string]any{"attempt": 1, "status": "running"},
			"not a child",
		},
	})
	if len(children) != 5 {
		t.Fatalf("children = %+v, want one row per child id", children)
	}
	byID := map[string]BackgroundChild{}
	for _, child := range children {
		byID[child.ChildID] = child
	}
	if kept := byID["kept"]; kept.State != BackgroundFinished || kept.Label != "kept" {
		t.Errorf("kept = %+v, want it finished under its label", kept)
	}
	if retried := byID["retried"]; retried.State != BackgroundRunning || retried.Status != "running" {
		t.Errorf("retried = %+v, want the second attempt running", retried)
	}
	if stale := byID["stale"]; stale.State != BackgroundFinished {
		t.Errorf("stale = %+v, want the terminal winning", stale)
	}
	if parked := byID["parked"]; parked.State != BackgroundWaiting {
		t.Errorf("parked = %+v, want it waiting on its owner", parked)
	}
	if bare := byID["bare"]; bare.Label != "bare" {
		t.Errorf("bare = %+v, want the id where no label was recorded", bare)
	}
	// First-sight order survives the retry replacing its row.
	wantOrder := []string{"kept", "retried", "stale", "parked", "bare"}
	for i, id := range wantOrder {
		if children[i].ChildID != id {
			t.Fatalf("children = %+v, want first-sight order", children)
		}
	}
}
