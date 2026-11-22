package muse

import (
	"strings"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museRoster retains immutable task values in first-sight order on the relay.
type museRoster struct {
	tasks map[string]harnessapi.BackgroundTask
	order []string
}

// upsert files one background item opening or updating, and answers the
// roster event the caller sends. Nil is an item with no id, which is no task
// at all.
func (r *museRoster) upsert(item map[string]any) *harnessapi.HarnessEvent {
	task, ok := museRosterTask(item)
	if !ok {
		return nil
	}
	r.put(task)
	event := r.snapshot()
	return &event
}

// finished files one background item completing, and answers the roster
// event the caller sends. Unknown ids are filed rather than dropped: a gap may
// have eaten the opening, and a task that landed is still a task.
func (r *museRoster) finished(item map[string]any) *harnessapi.HarnessEvent {
	task, ok := museRosterFinishedTask(item)
	if !ok {
		return nil
	}
	r.put(task)
	event := r.snapshot()
	return &event
}

// museRosterTask is one background item opening or updating as the roster
// reports it, with a workflow's folded children beneath it. False is an item
// with no id, which is no task at all.
func museRosterTask(item map[string]any) (harnessapi.BackgroundTask, bool) {
	id := pkgProtocol.AsString(item["itemId"])
	if id == "" {
		return harnessapi.BackgroundTask{}, false
	}
	kind := pkgProtocol.AsString(item["kind"])
	generic := pkgProtocol.AsString(item["status"])
	// The fine word is a subagent's own: the control status says what the
	// generic one cannot while the delegation is out — `running`, `resultReady`,
	// `manualReconciliation` against a bare `inProgress`. A workflow's story is
	// told by its children, and a tool call has no finer word, so both keep the
	// generic one.
	display := generic
	fine := ""
	if kind == "subagent" {
		fine = pkgProtocol.AsString(item["controlStatus"])
		if fine != "" {
			display = fine
		}
	}
	task := harnessapi.BackgroundTask{
		ID: id, Kind: kind,
		Label:  pkgProtocol.CutRunes(museWorkLabel(item), harnessapi.MaxSubagentNameChars),
		Status: pkgProtocol.CutRunes(pkgProtocol.OrDefault(display, generic), harnessapi.MaxSubagentNameChars),
		State:  MuseRosterState(generic, fine),
	}
	if kind == "workflow" {
		task.Children = MuseRosterChildren(item)
	}
	return task, true
}

// museRosterFinishedTask is one background item completing as the roster
// reports it: finished, on the generic verdict the host gave — the completion
// is the verdict, so an item carrying no word at all still reads `completed`
// rather than nothing. A workflow's children are folded from the completed
// item, which is what the final roster shows each child coming to.
func museRosterFinishedTask(item map[string]any) (harnessapi.BackgroundTask, bool) {
	id := pkgProtocol.AsString(item["itemId"])
	if id == "" {
		return harnessapi.BackgroundTask{}, false
	}
	kind := pkgProtocol.AsString(item["kind"])
	task := harnessapi.BackgroundTask{
		ID: id, Kind: kind,
		Label:  pkgProtocol.CutRunes(museWorkLabel(item), harnessapi.MaxSubagentNameChars),
		Status: pkgProtocol.CutRunes(pkgProtocol.OrDefault(pkgProtocol.AsString(item["status"]), "completed"), harnessapi.MaxSubagentNameChars),
		State:  harnessapi.BackgroundFinished,
	}
	if kind == "workflow" {
		task.Children = MuseRosterChildren(item)
	}
	return task, true
}

// put keeps one task. True is a task the roster did not already hold as
// is — new, or saying something new — which is what the reconcile emits on.
func (r *museRoster) put(task harnessapi.BackgroundTask) bool {
	if r.tasks == nil {
		r.tasks = map[string]harnessapi.BackgroundTask{}
	}
	if held, known := r.tasks[task.ID]; known {
		if harnessapi.BackgroundTaskEqual(held, task) {
			return false
		}
	} else {
		r.order = append(r.order, task.ID)
	}
	r.tasks[task.ID] = task
	return true
}

// snapshot is the roster whole, in first-sight order: the event the
// caller sends. What is sent is never touched again: a later store overwrites
// the map entry wholesale, and the hub settles into a copy of its own, so
// neither side ever rewrites the other's hold.
func (r *museRoster) snapshot() harnessapi.HarnessEvent {
	snapshot := make([]harnessapi.BackgroundTask, 0, len(r.order))
	for _, id := range r.order {
		snapshot = append(snapshot, r.tasks[id])
	}
	return harnessapi.HarnessEvent{Kind: harnessapi.EventBackground, Background: snapshot}
}

// museRosterState is where one background item stands, in this service's word.
// The generic status is the terminal authority — anything but `inProgress` is
// finished — and the fine word names the one parked state: a delegation the
// host quarantined (`manualReconciliation`) ended without a result this
// service could reconcile, and counting it running would be the wait that
// never ends, while counting it finished would be a verdict nobody gave.
func MuseRosterState(generic, fine string) harnessapi.BackgroundState {
	if generic != "" && generic != "inProgress" {
		return harnessapi.BackgroundFinished
	}
	if isManualReconciliation(fine) {
		return harnessapi.BackgroundWaiting
	}
	return harnessapi.BackgroundRunning
}

// isManualReconciliation reports whether a host word names the parked state:
// the wire's camelCase and the durable record's snake_case alike, since both
// have been seen on the wire.
func isManualReconciliation(word string) bool {
	folded := strings.ReplaceAll(strings.ToLower(word), "_", "")
	return folded == "manualreconciliation"
}

// museRosterChildren folds one workflow item's children as the roster reports
// them: one row per child, latest attempt winning — a retried child runs again
// under a new attempt, and the stale row would count the same child twice. A
// child that reached a terminal landed; one parked on its owner waits; the
// rest run.
func MuseRosterChildren(item map[string]any) []harnessapi.BackgroundChild {
	raw, _ := item["children"].([]any)
	out := make([]harnessapi.BackgroundChild, 0, len(raw))
	// at holds each child's row and best attempt so far: a retry replaces its
	// row in place, keeping first-sight order.
	at := map[string]int{}
	attemptOf := map[string]int64{}
	for _, entry := range raw {
		child, _ := entry.(map[string]any)
		if len(child) == 0 {
			continue
		}
		id := pkgProtocol.AsString(child["childId"])
		if id == "" {
			continue
		}
		attempt, _ := pkgProtocol.AsInt64(child["attempt"])
		if seen, known := attemptOf[id]; known && attempt < seen {
			continue
		}
		status := pkgProtocol.AsString(child["status"])
		terminal := pkgProtocol.AsString(child["terminal"])
		state := harnessapi.BackgroundRunning
		switch {
		case terminal != "":
			// The explicit verdict wins: whatever the lifecycle word still
			// says, a child that reached a terminal landed.
			state = harnessapi.BackgroundFinished
		case isManualReconciliation(status):
			state = harnessapi.BackgroundWaiting
		case status == "" || status == "inProgress" || status == "running":
			// The known active words — the lifecycle's own `running`, the
			// generic `inProgress`, and the missing word, which keeps
			// watching rather than hiding a child behind a verdict nobody
			// gave. Anything else is terminal-unknown: finished, with the
			// word itself displayed, which is what the schema asks of an
			// open enum (`completed`, `failed`, `resultReady`, `closed`).
			state = harnessapi.BackgroundRunning
		default:
			state = harnessapi.BackgroundFinished
		}
		// The most telling word wins twice: the lifecycle status while the
		// child is out, the terminal verdict once it has landed.
		display := pkgProtocol.OrDefault(status, terminal)
		row := harnessapi.BackgroundChild{
			ChildID:  id,
			Label:    pkgProtocol.CutRunes(pkgProtocol.OrDefault(pkgProtocol.AsString(child["label"]), id), harnessapi.MaxSubagentNameChars),
			Status:   pkgProtocol.CutRunes(pkgProtocol.OrDefault(display, "inProgress"), harnessapi.MaxSubagentNameChars),
			State:    state,
			Terminal: pkgProtocol.CutRunes(terminal, harnessapi.MaxSubagentNameChars),
		}
		if index, known := at[id]; known {
			out[index] = row
		} else {
			at[id] = len(out)
			out = append(out, row)
		}
		attemptOf[id] = attempt
	}
	return out
}
