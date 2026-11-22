package muse

import (
	"encoding/json"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museCompactWait bounds a compaction turn: the reader ends on the compaction item landing, but a
// summarizer that never answers must not hold the conversation busy forever. The compaction itself
// continues server-side; the next turn simply carries the context it has.
const museCompactWait = 2 * time.Minute

// relay emits the turn as it happens and closes the stream with exactly one harnessDone — whichever
// way the turn ended. It is the only emitter: Spawn prepares the prologue and the host, and
// everything from the session announcement to the end goes out here, in arrival order.
func (d *MuseDriver) relay() {
	defer close(d.EventStream)
	defer d.cleanup()

	prologue, prologueEnd, prologueCode := d.startup.events, d.startup.finished, d.startup.code
	state := d.host.snapshot()
	conn, compacting := state.conn, state.compacting

	for _, event := range prologue {
		d.EventStream <- event
	}
	if prologueEnd {
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: prologueCode}
		return
	}
	if conn == nil {
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 1}
		return
	}
	defer conn.Close()

	// A compaction that never lands ends the wait, not the session: the timer fires a synthetic
	// end that the loop below reads as the host going quiet.
	var compactTimer <-chan time.Time
	if compacting {
		timer := time.NewTimer(museCompactWait)
		defer timer.Stop()
		compactTimer = timer.C
	}
	// The idle wait, restarted by every notification: a host that blocks for the whole of it
	// is stopped and asked to resume where it stood — once. A second blockage ends the turn
	// for the chain runner to fork, instead of holding the conversation busy forever.
	idleFor := d.idleWait()
	idleTimer := time.NewTimer(idleFor)
	defer idleTimer.Stop()
	// The notice wait, restarted by the same word: the first notice goes out after noticeWait,
	// every following one a minute later, each naming the silence and the relaunches so far.
	noticeFor := d.noticeWait()
	noticeTimer := time.NewTimer(noticeFor)
	defer noticeTimer.Stop()
	d.activity.at = time.Now()
	d.noteJournal()
	for {
		select {
		case note, ok := <-conn.notifs:
			if !ok {
				d.endUnfinished()
				return
			}
			restartTimer(idleTimer, idleFor)
			noticeFor = d.noticeWait()
			restartTimer(noticeTimer, noticeFor)
			d.activity.note(note.Method)
			if done, code, terminal := d.relayOne(note); done {
				// The turn is over — but its background work may not be. A turn that
				// ends with work still running keeps its host until that work lands
				// or the drain times out, and only then settles on this end.
				if d.enterDrain(conn, d.endWord(note.Method, terminal), code, terminal) {
					continue
				}
				// The turn is over but its host is still alive — the close below has not run —
				// so this is the moment to ask what it observed of the account. On every end,
				// and notably on a failed one: a turn refused for having no quota left is
				// exactly when the usage panel matters most.
				d.Run.Trace.Note("muse turn " + d.endWord(note.Method, terminal) + "; " + d.endCensus())
				d.harvestUsage(conn)
				d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: code, Terminal: terminal}
				return
			}
			if d.drainSettled() {
				// The last background item landed: the deferred end is due.
				d.finishDrain(conn, false)
				return
			}
		case <-compactTimer:
			d.Run.Trace.Note("muse turn ended waiting for the compaction; " + d.endCensus())
			d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventBlock,
				Block: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText,
					Text: "The compaction is still running; the turn ends here."}}
			d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 0}
			return
		case <-idleTimer.C:
			// Parked on something only a person can answer, the turn is silent because it is
			// waiting — the wait starts over for as long as that is true.
			if d.asks.parked() {
				idleTimer.Reset(idleFor)
				continue
			}
			// Draining, the turn already ended and only its background work is still
			// out: page what the silence may have dropped, and either end the turn
			// or wait another wait — never a resume and never a fork of a turn
			// that already ended.
			if d.isDraining() {
				if d.resyncDrain(conn) {
					d.finishDrain(conn, false)
					return
				}
				restartTimer(idleTimer, idleFor)
				noticeFor = d.noticeWait()
				restartTimer(noticeTimer, noticeFor)
				continue
			}
			// Poll the session before treating silence as blockage. End a completed turn,
			// keep waiting for an active one, and recover a turn with no liveness evidence.
			switch d.resyncBlockedTurn(conn) {
			case resyncEnded:
				return
			case resyncAlive:
				restartTimer(idleTimer, idleFor)
				noticeFor = d.noticeWait()
				restartTimer(noticeTimer, noticeFor)
				continue
			}
			if d.resumeBlockedTurn(conn) {
				restartTimer(idleTimer, idleFor)
				noticeFor = d.noticeWait()
				restartTimer(noticeTimer, noticeFor)
				continue
			}
			d.endBlockedTwice(conn)
			return
		case <-noticeTimer.C:
			// Still silent, but nobody asked this turn to end: the silence names itself and
			// the wait starts over, a minute later from now on. Parked on an ask the silence
			// is the user's own deliberation, which needs no announcement. Draining,
			// the silence is a wait on background work, and names that instead.
			if !d.asks.parked() {
				if d.isDraining() {
					notice := d.drainNotice()
					d.Run.Trace.Note(notice)
					d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: notice}
				} else {
					notice := d.quietNotice()
					d.Run.Trace.Note(notice + " still waiting on the host")
					d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: notice}
				}
			}
			noticeFor = d.noticeRepeatWait()
			noticeTimer.Reset(noticeFor)
		case <-d.drainChan():
			// The drain's bound: background work still out past it is abandoned
			// with its host, and the turn ends on the end it deferred.
			if d.drainSettled() {
				d.finishDrain(conn, false)
			} else {
				d.finishDrain(conn, true)
			}
			return
		}
	}
}

// restartTimer restarts a timer that may have fired already: stopped and drained before the reset,
// which is what keeps a stale firing from ending the restarted wait at once.
func restartTimer(timer *time.Timer, wait time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(wait)
}

// endUnfinished ends a turn whose host went quiet without ending it: killed, crashed, or stopped.
// A turn this service ended reports -1, which is the shape the hub reads as "ours"; anything else
// is a failure with a sentence rather than a bare exit.
func (d *MuseDriver) endUnfinished() {
	state := d.host.interrupt()
	stopped, conn := state.stopped, state.conn

	// The pipe ended without the turn ending: killed, crashed, or stopped. The note says
	// which, and what the reader itself reported — a poison frame fails the reader where a
	// dead process simply ends the pipe, and only the note tells them apart.
	abandoned := d.abandonedNote()
	if stopped {
		d.Run.Trace.Note("muse turn stopped by the service; " + d.endCensus() + abandoned)
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: -1}
		return
	}
	summary := d.endCensus()
	if conn != nil {
		if err := conn.ReadError(); err != nil {
			summary += "; reader: " + err.Error()
		}
	}
	d.Run.Trace.Note("muse host ended in the middle of the turn; " + summary + abandoned)
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
		Message: "The Muse host ended in the middle of the turn."}
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 1}
}

// relayOne translates one host notification into what it means to the hub, emitting every event it
// carries. It reports whether the turn ends here, on what code, and — for an end the host named
// in words — on what terminal.
func (d *MuseDriver) relayOne(note MspNotification) (bool, int, string) {
	var params map[string]any
	if len(note.Params) > 0 {
		_ = json.Unmarshal(note.Params, &params)
	}
	// Every view notification carries its cursor, live or paged: the newest one seen is
	// where a resync pages from, so a replay can never re-emit what the relay already
	// holds. Ephemeral frames carry none and leave the cursor where it stands.
	if cursor := pkgProtocol.AsString(params["viewCursor"]); cursor != "" {
		d.recovery.lastCursor = cursor
	}
	switch note.Method {
	case "item/started", "item/updated":
		d.noteItemState(params)
		item, _ := params["item"].(map[string]any)
		if usage := d.host.noteChildUsage(item); usage != nil {
			d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage}
		}
	case "item/completed":
		for _, event := range d.completedItem(params) {
			if event.Kind == harnessapi.EventDone {
				return true, event.ExitCode, event.Terminal
			}
			d.EventStream <- event
		}
	case "approval/requested":
		if event, ok := d.approvalAsked(params); ok {
			d.EventStream <- event
		}
	case "approval/resolved":
		if event, ok := d.asks.settleApproval(params); ok {
			d.EventStream <- event
		}
	case "approval/updated":
		if event, ok := d.asks.updateApproval(params); ok {
			d.EventStream <- event
		}
	case "userInput/requested":
		if event, ok := d.questionAsked(params); ok {
			d.EventStream <- event
		}
	case "userInput/settled":
		if event, ok := d.asks.settleQuestion(params); ok {
			d.EventStream <- event
		}
	case "turn/completed":
		if done, code, terminal, events := d.turnCompleted(params); done {
			for _, event := range events {
				d.EventStream <- event
			}
			return true, code, terminal
		}
	case "turn/unqueued":
		if done, code, event := d.turnUnqueued(params); done {
			if event != nil {
				d.EventStream <- *event
			}
			return true, code, ""
		}
	case "session/tokenUsage":
		if usage := d.host.noteTokenUsage(params); usage != nil {
			d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage}
		}
	case "usage/changed":
		// The host's account figures moved mid-turn: recorded as they land, so a long turn's
		// quota is live rather than only current at its end. It emits nothing — a refresh
		// answers what was recorded.
		d.noteUsageChanged(note.Params)
	case "view/gap":
		// The host dropped events it could not deliver: the turn's account has a hole in it, and
		// the log says so where grepping for the turn finds it. The trace keeps it too — the
		// service log is a console, but the trace is the file a post-mortem opens.
		harnessapi.LogClaudeWS.Warn("muse view gap; the turn lost events",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn)
		text := "muse view gap; the turn lost events"
		if len(note.Params) > 0 {
			text += ": " + string(note.Params)
		}
		d.Run.Trace.Note(text)
	case "session/viewHealthChanged":
		if event, ok := d.viewHealthChanged(params); ok {
			d.EventStream <- event
		}
	default:
		// Everything else — items streaming, turns starting, sessions moving —
		// is a turn in progress rather than a thing said. Stepped over, like the notifications
		// the schema has never heard of. Items opening and updating are tracked above, not
		// stepped over: they are what the drain waits on past the turn's end.
	}
	return false, 0, ""
}
