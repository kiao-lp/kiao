package muse

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museBackground belongs to the relay. open bounds the wait; roster retains
// finished tasks for display; drain retains the first native turn outcome.
type museBackground struct {
	open   map[string]MuseWorkItem
	roster museRoster
	drain  museDrain
}

type museDrain struct {
	active   bool
	end      string
	code     int
	terminal string
	total    int
	started  time.Time
	ch       <-chan time.Time
}

// museBackgroundDrainTimeout bounds the drain: how long a turn that ended with
// background work still running waits for it before ending anyway. A workflow
// of several children is several harness turns of its own, so the bound is
// generous — thirty minutes of genuine work, not eight of silence — and past
// it the turn ends with the abandoned work named, rather than holding the
// conversation busy past any scrutiny.
const museBackgroundDrainTimeout = 30 * time.Minute

// museWorkItem is one background item still running: the kind, and the line the
// drain names it with.
type MuseWorkItem struct {
	Kind  string
	Label string
}

// museBackgroundKind reports whether an item is work that may outlive its turn:
// a workflow run, a subagent delegation, or a tool call sent to the background.
// Every other kind completes within the turn that ran it — or, like a
// reminderChild, is the host's own housekeeping, which no turn waits on.
func MuseBackgroundKind(item map[string]any) bool {
	switch pkgProtocol.AsString(item["kind"]) {
	case "workflow", "subagent":
		return true
	case "toolCall":
		background, _ := item["background"].(bool)
		return background
	default:
		return false
	}
}

// museWorkLabel is one background item as the drain names it: the kind and the
// name the host gave it — the workflow's entry, the subagent's role, the
// backgrounded tool's name.
func museWorkLabel(item map[string]any) string {
	switch pkgProtocol.AsString(item["kind"]) {
	case "workflow":
		return fmt.Sprintf("workflow %q",
			pkgProtocol.OrDefault(pkgProtocol.AsString(item["entryId"]), pkgProtocol.AsString(item["itemId"])))
	case "subagent":
		return fmt.Sprintf("subagent %q",
			pkgProtocol.OrDefault(pkgProtocol.OrDefault(pkgProtocol.AsString(item["role"]), pkgProtocol.AsString(item["objective"])),
				pkgProtocol.AsString(item["itemId"])))
	default:
		return fmt.Sprintf("background tool call %q",
			pkgProtocol.OrDefault(pkgProtocol.AsString(item["tool"]), pkgProtocol.AsString(item["itemId"])))
	}
}

// museWorkProgress is one background item's update as a trace suffix: the
// revision, and the child count where the item folds children. The statuses
// stay the host journal's to tell: the trace names the movement, not the work.
func museWorkProgress(item map[string]any) string {
	progress := ""
	if revision, ok := pkgProtocol.AsInt64(item["revision"]); ok && revision > 0 {
		progress = fmt.Sprintf("revision %d", revision)
	}
	if children, ok := item["children"].([]any); ok {
		if progress != "" {
			progress += ", "
		}
		progress += fmt.Sprintf("%d children", len(children))
	}
	if progress == "" {
		return ""
	}
	return " (" + progress + ")"
}

// noteItemState files one item opening or updating: background work of this
// turn still running is tracked, and work that reached a terminal state is
// forgotten. Only this turn's items — the resync's pages hold older turns'
// too, and a dead turn's work must never hold this one's end.
func (d *MuseDriver) noteItemState(params map[string]any) {
	item, _ := params["item"].(map[string]any)
	if len(item) == 0 || !MuseBackgroundKind(item) {
		return
	}
	id := pkgProtocol.AsString(item["itemId"])
	if id == "" {
		return
	}
	state := d.host.snapshot()
	turnID, lastTurnID := state.turnID, state.lastTurnID
	if itemTurn := pkgProtocol.AsString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
		return
	}
	if pkgProtocol.AsString(item["status"]) != "inProgress" {
		d.closeWork(id)
		// Defensive: an opening or updating item is open by schema, so a terminal word here
		// means the completion took another path — the resync's pages hold older turns' items
		// too, and a gap may have eaten the completion. The roster marks it finished rather
		// than dropping a task it already showed, which is what the `item/completed` path
		// below does on the record.
		if event := d.background.roster.finished(item); event != nil {
			d.EventStream <- *event
		}
		return
	}
	work := MuseWorkItem{Kind: pkgProtocol.AsString(item["kind"]), Label: museWorkLabel(item)}
	progress := museWorkProgress(item)
	if d.background.open == nil {
		d.background.open = map[string]MuseWorkItem{}
	}
	_, known := d.background.open[id]
	d.background.open[id] = work
	if known {
		d.Run.Trace.Note("muse background " + work.Label + " updated" + progress)
	}
	if event := d.background.roster.upsert(item); event != nil {
		d.EventStream <- *event
	}
}

// closeWork forgets one background item: it completed, failed, or was never
// tracked at all.
func (d *MuseDriver) closeWork(id string) {
	if id == "" {
		return
	}

	delete(d.background.open, id)
}

// openWorkCount is how many background items are still running.
func (d *MuseDriver) openWorkCount() int {
	return len(d.background.open)
}

// openWorkDesc counts the tracked background work and names it: "2 background
// tasks (workflow "a", subagent "b")". The labels read sorted, whatever order
// the map holds, so the note is stable run to run.
func (d *MuseDriver) openWorkDesc() (int, string) {
	n := len(d.background.open)
	if n == 0 {
		return 0, "no background tasks"
	}
	labels := make([]string, 0, n)
	for _, work := range d.background.open {
		labels = append(labels, work.Label)
	}
	sort.Strings(labels)
	return n, pluralTasks(n) + " (" + strings.Join(labels, ", ") + ")"
}

// pluralTasks is a background-work count as a sentence: "1 background task",
// "3 background tasks".
func pluralTasks(n int) string {
	if n == 1 {
		return "1 background task"
	}
	return fmt.Sprintf("%d background tasks", n)
}

// abandonedNote describes background work abandoned with its host, or returns empty when none exists.
func (d *MuseDriver) abandonedNote() string {
	n, desc := d.openWorkDesc()
	if n == 0 {
		return ""
	}
	return "; " + desc + " abandoned with it"
}

// isDraining reports whether the turn's end is deferred on background work.
func (d *MuseDriver) isDraining() bool {
	return d.background.drain.active
}

// drainChan is the drain's bound as the relay selects on it: nil until the
// drain starts, so the timeout branch sleeps until there is a drain to bound.
func (d *MuseDriver) drainChan() <-chan time.Time {
	return d.background.drain.ch
}

// drainWait is how long the drain waits for background work still running when
// the turn ended.
func (d *MuseDriver) drainWait() time.Duration {
	if d.DrainTimeout > 0 {
		return d.DrainTimeout
	}
	return museBackgroundDrainTimeout
}

// enterDrain keeps the host relaying until its background work settles or the drain times out.
// It returns false when there is no work to wait for. Reconciliation with the session repairs
// missed stream updates; if reconciliation fails, the observed live set remains authoritative.
func (d *MuseDriver) enterDrain(conn *MspConn, end string, code int, terminal string) bool {
	if d.isDraining() {
		return true
	}
	d.reconcileOpenWork(conn)
	wait := d.drainWait()

	if len(d.background.open) == 0 {
		return false
	}
	d.background.drain.active = true
	d.background.drain.end, d.background.drain.code, d.background.drain.terminal = end, code, terminal
	d.background.drain.total = len(d.background.open)
	d.background.drain.started = time.Now()
	d.background.drain.ch = time.After(wait)

	_, desc := d.openWorkDesc()
	d.Run.Trace.Note(fmt.Sprintf("muse turn %s with %s still running; draining before ending (timeout %s)",
		end, desc, wait.Truncate(time.Second)))
	n, _ := d.openWorkDesc()
	pronoun := "it"
	if n > 1 {
		pronoun = "them"
	}
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: fmt.Sprintf(
		"The turn ended with %s still running; waiting for %s to finish.",
		pluralTasks(n), pronoun)}
	return true
}

// reconcileOpenWork re-reads the turn's background work against the session's
// folded history: the live stream may have dropped an opening or a completion,
// and the fold is the truth either way. Unreadable — the call refused, no
// inline history served, the payload past understanding — the live set stands.
func (d *MuseDriver) reconcileOpenWork(conn *MspConn) {
	state := d.host.snapshot()
	sessionID, turnID, lastTurnID, live := state.sessionID, state.turnID, state.lastTurnID, len(d.background.open)
	if conn == nil || sessionID == "" || live == 0 {
		return
	}
	raw, err := conn.callTimeout("session/read", map[string]any{
		"sessionId": sessionID, "excludeItems": false,
	}, d.resyncWait())
	if err != nil {
		d.Run.Trace.Note("muse drain could not reconcile against the session (" +
			museSentence(err) + "); tracking " + pluralTasks(live))
		return
	}
	var read struct {
		History struct {
			Items []map[string]any `json:"items"`
		} `json:"history"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		d.Run.Trace.Note("muse drain reconcile could not be understood (" +
			museSentence(err) + "); tracking " + pluralTasks(live))
		return
	}
	if read.History.Items == nil {
		d.Run.Trace.Note("muse drain reconcile served no inline history; tracking " + pluralTasks(live))
		return
	}
	fold := map[string]MuseWorkItem{}
	rosterMoved := false
	for _, item := range read.History.Items {
		id := pkgProtocol.AsString(item["itemId"])
		if id == "" || !MuseBackgroundKind(item) {
			continue
		}
		if itemTurn := pkgProtocol.AsString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
			continue
		}
		// The roster learns the fold too: an opening the stream dropped is a
		// task the user never saw, and a completion it dropped is one still
		// standing `running`. Both are filed, and one event carries the
		// whole truth — but only when the truth moved, so a reconcile that
		// confirms the live set is silent rather than a duplicate frame.
		if pkgProtocol.AsString(item["status"]) != "inProgress" {
			if task, ok := museRosterFinishedTask(item); ok && d.background.roster.put(task) {
				rosterMoved = true
			}
			continue
		}
		fold[id] = MuseWorkItem{Kind: pkgProtocol.AsString(item["kind"]), Label: museWorkLabel(item)}
		if task, ok := museRosterTask(item); ok && d.background.roster.put(task) {
			rosterMoved = true
		}
	}
	before := d.background.open
	d.background.open = fold
	if !sameWorkKeys(before, fold) {
		_, desc := d.openWorkDesc()
		d.Run.Trace.Note(fmt.Sprintf("muse drain reconciled %s live against the session: %s open",
			pluralTasks(live), desc))
	}
	if rosterMoved {
		d.EventStream <- d.background.roster.snapshot()
	}
}

// sameWorkKeys reports whether two tracked sets hold the same items.
func sameWorkKeys(a, b map[string]MuseWorkItem) bool {
	if len(a) != len(b) {
		return false
	}
	for id := range a {
		if _, ok := b[id]; !ok {
			return false
		}
	}
	return true
}

// drainSettled reports whether the deferred end is due: draining, and the last
// background item landed.
func (d *MuseDriver) drainSettled() bool {
	return d.background.drain.active && len(d.background.open) == 0
}

// finishDrain settles the deferred end: the note keeps the end the turn reached
// and the drain it waited through, and the turn settles on the deferred code.
// Timed out, the remaining work is named as abandoned — the close that follows
// stops it with its host — and the notice says so out loud.
func (d *MuseDriver) finishDrain(conn *MspConn, timedOut bool) {
	end, code, terminal := d.background.drain.end, d.background.drain.code, d.background.drain.terminal
	total := d.background.drain.total
	d.background.drain.active = false
	d.background.drain.ch = nil

	if timedOut {
		_, desc := d.openWorkDesc()
		d.Run.Trace.Note(fmt.Sprintf("muse turn %s; drain timed out with %s abandoned; %s",
			end, desc, d.endCensus()))
		n, _ := d.openWorkDesc()
		verb, pronoun := "was", "it"
		if n > 1 {
			verb, pronoun = "were", "them"
		}
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: fmt.Sprintf(
			"%s %s still running; ending the turn without %s.",
			pluralTasks(n), verb, pronoun)}
	} else {
		d.Run.Trace.Note(fmt.Sprintf("muse turn %s after draining %s; %s",
			end, pluralTasks(total), d.endCensus()))
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice,
			Message: "Background work finished; the turn ends here."}
	}
	d.harvestUsage(conn)
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: code, Terminal: terminal}
}

// resyncDrain polls a drain silent for the whole idle wait: the missed view
// events are paged and fed through the relay path, so a completion the stream
// dropped still lands. True is a settled drain, and the caller ends the turn;
// false waits another wait. Never a resume and never a fork: the turn already
// ended, and only its background work is still out.
func (d *MuseDriver) resyncDrain(conn *MspConn) bool {
	sessionID, cursor := d.host.snapshot().sessionID, d.recovery.lastCursor
	if conn == nil || sessionID == "" {
		return false
	}
	paged, end := d.pageMissed(conn, sessionID, cursor)
	if end != nil {
		// The replay carried a second end for a turn that already ended: the
		// first one stands, and the drain waits on regardless.
		d.Run.Trace.Note("muse drain replayed a second end (" + end.method + "); the first one stands")
	}
	if d.openWorkCount() == 0 {
		return true
	}
	d.touchedByResync()
	_, desc := d.openWorkDesc()
	d.Run.Trace.Note(fmt.Sprintf("muse drain still waiting on %s (%s replayed)",
		desc, pluralEvents(paged)))
	return false
}

// drainNotice is the sentence a drain names itself with: what it still waits
// on, and for how long. A silence past the turn's end is waiting, not quiet,
// and says so.
func (d *MuseDriver) drainNotice() string {
	started := d.background.drain.started

	elapsed := "a while"
	if !started.IsZero() {
		elapsed = time.Since(started).Truncate(time.Second).String()
	}
	n, _ := d.openWorkDesc()
	pronoun := "it lands"
	if n > 1 {
		pronoun = "they land"
	}
	return fmt.Sprintf("Still waiting on %s; the turn ends when %s (%s elapsed).",
		pluralTasks(n), pronoun, elapsed)
}
