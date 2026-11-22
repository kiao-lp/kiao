package muse

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museRecovery belongs to the relay. Live and paged notifications advance the
// same cursor; journal metadata supplies liveness when the view is silent.
type museRecovery struct {
	relaunches   int
	lastCursor   string
	viewDown     bool
	journalSize  int64
	journalAt    time.Time
	journalKnown bool
	blindParks   int
}

// museTurnIdleTimeout bounds how long a turn may go without a word from its host — an item or an
// end, a question or an approval, anything. A healthy turn is never silent for this long: the model
// streams as it thinks and the tools report as they run, so a quieter turn is a host that is
// blocked — or one whose live view died while it works on. A silence this long is therefore
// polled before it is concluded (see resyncBlockedTurn): a turn that ended is ended here, a
// turn that lives waits another wait, and only a turn neither dead nor alive is stopped and
// asked to resume where it stood the first time, ended the second, with the chain runner
// forking the conversation from there. Parked on an ask the turn is silent because it is
// waiting, which is legitimate for as long as the user deliberates, so the wait starts over
// instead of ending it.
const museTurnIdleTimeout = 8 * time.Minute

// museQuietNoticeAfter is how long a turn may go without a word from its host before it says so:
// a notice to the user and a note in the trace, and then the wait starts over. The idle wait stops
// a silent turn; this one only names the silence while it is still a turn — thinking and provider
// retries look identical from the outside, and eight minutes of wondering which is what the wait
// would otherwise be.
const museQuietNoticeAfter = 2 * time.Minute

// museQuietNoticeRepeat is how often the silence names itself again once named: the first notice
// goes out after museQuietNoticeAfter, every following one a minute later, each carrying how long
// the host has been quiet and how many times the turn has already been resumed.
const museQuietNoticeRepeat = time.Minute

// museBlockedResumePrompt is what a turn blocked for the whole idle wait is asked when it is
// stopped and started again on the same session: the truth, and nothing else to redo.
const MuseBlockedResumePrompt = "you were blocked and I had to stop you. Please resume."

// museResyncTimeout bounds one poll of a silent turn's session: the status read and each page
// of missed view events. A host that answers nothing in this long is wedged past polling, and
// the blockage is concluded without what the poll would have said.
const museResyncTimeout = 30 * time.Second

// museResyncPageLimit and museResyncMaxPages bound the catch-up: how many missed view events
// one page carries, and how many pages one resync reads. Past the cap the oldest missed events
// stay missed, which a silent turn's volume never reaches — and a cap is what keeps a corrupt
// cursor from paging the whole session into one blockage.
const museResyncPageLimit = 200

const museResyncMaxPages = 10

// museViewDownMessage is the notice a turn parks on the transcript when its live view dies:
// the host said its projection failed closed, so from here the turn is polled rather than
// followed. It goes out once, on the transition — the quiet notices already name the silence.
const MuseViewDownMessage = "Muse's live view is unavailable; the turn continues and its session is now polled."

// idleWait is how long the relay waits for a word from the host before ending the turn.
func (d *MuseDriver) idleWait() time.Duration {
	if d.IdleTimeout > 0 {
		return d.IdleTimeout
	}
	return museTurnIdleTimeout
}

// noticeWait is how long the relay waits for a word from the host before naming the silence.
func (d *MuseDriver) noticeWait() time.Duration {
	if d.NoticeTimeout > 0 {
		return d.NoticeTimeout
	}
	return museQuietNoticeAfter
}

// noticeRepeatWait is how long the relay waits between two namings of an ongoing silence: the
// first notice goes out after noticeWait, every following one a minute later.
func (d *MuseDriver) noticeRepeatWait() time.Duration {
	if d.NoticeTimeout > 0 {
		return d.NoticeTimeout
	}
	return museQuietNoticeRepeat
}

// resyncWait is how long one poll of a silent turn's session may take.
func (d *MuseDriver) resyncWait() time.Duration {
	if d.ResyncTimeout > 0 {
		return d.ResyncTimeout
	}
	return museResyncTimeout
}

// resumeBlockedTurn stops the MSP turn blocked for the whole idle wait and starts a new one on
// the same session, asking it to pick itself back up where it stood. True when the turn
// continues: the stream stays open, the timers start over, and whatever the resumed turn says
// goes out as this turn's own. False when the resume never started — refused, or answered
// without a turn — in which case the caller ends the turn as blocked twice rather than as
// merely quiet. Only ever the first blockage: the relay asks once, and a silence after the
// resume ends the turn instead.
func (d *MuseDriver) resumeBlockedTurn(conn *MspConn) bool {
	if d.recovery.relaunches > 0 {
		return false
	}
	state := d.host.snapshot()
	sessionID, oldTurn := state.sessionID, state.turnID

	if conn == nil || strings.TrimSpace(sessionID) == "" {
		return false
	}
	d.Run.Trace.Note("muse blocked for the whole idle wait; stopping the turn and asking it to resume")
	cancelParams := map[string]any{"commandId": MspCommandID(), "sessionId": sessionID}
	if strings.TrimSpace(oldTurn) != "" {
		cancelParams["turnId"] = oldTurn
	}
	// Best effort, like Stop: the host may already be gone, and the start below failing ends
	// the turn either way.
	_, _ = conn.Call("turn/cancel", cancelParams)
	raw, err := conn.Call("turn/start", map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID,
		"input":  []any{map[string]any{"type": "text", "text": MuseBlockedResumePrompt}},
		"ifBusy": "replace",
	})
	if err != nil {
		d.Run.Trace.Note("muse resume after blockage refused: " + museSentence(err))
		return false
	}
	var started struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || strings.TrimSpace(started.TurnID) == "" {
		d.Run.Trace.Note("muse resume after blockage started no turn")
		return false
	}

	d.host.restart(started.TurnID)
	d.recovery.relaunches++
	d.activity.at = time.Now()

	d.Run.Trace.Note("muse turn " + started.TurnID + " resumes after blockage (relance 1)")
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice,
		Message: "Muse was blocked and resumes where it stood. (relance 1)"}
	return true
}

// endBlockedTwice ends a turn whose host blocked for the whole idle wait twice: once before
// the resume, once after it — and nothing parked. The turn failed, but its account so far
// stands — every block the host did send went out as it arrived — so the transcript keeps the
// work and the sentence says where it stopped. The chain runner reads this sentence as the
// signal to fork the conversation and play the flow node again from the fork.
func (d *MuseDriver) endBlockedTwice(conn *MspConn) {
	d.host.interrupt()

	d.Run.Trace.Note("muse blocked twice without ending the turn; ending it after the idle wait (" + d.endCensus() + ")" + d.abandonedNote())
	d.harvestUsage(conn)
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: harnessfaults.MuseBlockedTwiceMessage}
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 1}
}

// viewHealthChanged files the host's own verdict on its live view: unavailable means the
// projection failed closed, and from here nothing arrives unless polled for. The notice goes
// out once, on the transition — the quiet notices already name the silence that follows.
// Any other health is stepped over: the vocabulary is open, and an unrecognized value is not
// a verdict.
func (d *MuseDriver) viewHealthChanged(params map[string]any) (harnessapi.HarnessEvent, bool) {
	if pkgProtocol.AsString(params["health"]) != "unavailable" {
		return harnessapi.HarnessEvent{}, false
	}

	if named := pkgProtocol.AsString(params["sessionId"]); named != "" && named != d.host.snapshot().sessionID {
		return harnessapi.HarnessEvent{}, false
	}
	already := d.recovery.viewDown
	d.recovery.viewDown = true

	d.Run.Trace.Note("muse live view unavailable; the turn continues blind and the driver polls the session")
	if already {
		return harnessapi.HarnessEvent{}, false
	}
	return harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: MuseViewDownMessage}, true
}

// resyncOutcome classifies the session poll: ended, active, or without liveness evidence.
// The last case follows blockage recovery: resume once, then fork.
type resyncOutcome int

const (
	resyncStill resyncOutcome = iota
	resyncAlive
	resyncEnded
)

// resyncBlockedTurn checks three signals before treating silence as blockage:
// missed view events replayed through the relay, session status and pending asks,
// then host journal growth. Completion settles the turn; activity restarts the
// wait; no evidence permits the caller's resume/fork recovery.
func (d *MuseDriver) resyncBlockedTurn(conn *MspConn) resyncOutcome {
	state := d.host.snapshot()
	sessionID, turnID, cursor := state.sessionID, state.turnID, d.recovery.lastCursor
	if conn == nil || sessionID == "" || turnID == "" {
		return resyncStill
	}
	d.Run.Trace.Note("muse silent for the whole idle wait; polling the session before concluding")
	paged, end := d.pageMissed(conn, sessionID, cursor)
	if end != nil {
		phrase := d.endWord(end.method, end.terminal) + " (recovered from the session view)"
		if d.enterDrain(conn, phrase, end.code, end.terminal) {
			return resyncAlive
		}
		d.Run.Trace.Note("muse turn " + phrase + "; " + d.endCensus())
		d.harvestUsage(conn)
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: end.code, Terminal: end.terminal}
		return resyncEnded
	}
	status, active, parked := d.readSessionTurn(conn, sessionID)
	if status == "" && !parked.known {
		// A failed session read falls back to journal growth as the liveness signal.
		return d.resyncByJournal(paged)
	}
	// Idle, or another turn running: ours ended without the stream saying so. Its own
	// terminal word is lost with the view, but a wedged turn reads as running, not as
	// idle — idleness after a running turn is the shape of a turn that finished. The
	// gate is the status vocabulary, not just the active turn: anything else — unloaded,
	// or a word the vocabulary has moved past — falls through to the journal below
	// rather than ending a turn that may still run as cleanly finished.
	if status == "idle" || (status == "running" && parked.activeOK && active != turnID) {
		return d.endRecovered(conn, paged)
	}
	if len(parked.parked) > 0 {
		// Only the asks nobody was shown count as a blind park: one the hub holds
		// was answered and awaits its settlement, or just landed through the
		// replay above — and the "never arrived" notice would be a lie about it.
		if blind := d.asks.unseen(parked.parked); blind > 0 {
			parks := d.recovery.blindParks
			d.recovery.blindParks++
			if parks >= 1 {
				d.Run.Trace.Note("muse turn still parked on unseen asks; concluding the blockage")
				return resyncStill
			}
			d.Run.Trace.Note("muse turn parked on asks that never arrived; waiting on")
			d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: fmt.Sprintf(
				"Muse is waiting on %s that never arrived; the turn continues and the wait restarts.",
				pluralAsks(blind))}
			d.touchedByResync()
			return resyncAlive
		}
		d.recovery.blindParks = 0
		if paged == 0 {
			d.Run.Trace.Note("muse turn parked on asks the hub holds; their settlements never arrived — waiting on")
			d.touchedByResync()
			return resyncAlive
		}
	}
	d.recovery.blindParks = 0
	if paged > 0 {
		d.Run.Trace.Note(fmt.Sprintf(
			"muse turn still running; %s replayed from the session view", pluralEvents(paged)))
		d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: fmt.Sprintf(
			"Muse is still running; %s replayed from the session, the turn continues.",
			pluralEvents(paged))}
		d.touchedByResync()
		return resyncAlive
	}
	return d.resyncByJournal(paged)
}

// resyncByJournal uses journal growth as the last liveness signal when pulls yield
// no events or terminal state. Growth restarts the wait; stillness triggers blockage recovery.
func (d *MuseDriver) resyncByJournal(paged int) resyncOutcome {
	_ = paged
	if !d.journalGrew() {
		return resyncStill
	}
	d.Run.Trace.Note("muse turn still running; the live view is down but the host journal grows")
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: "Muse is still running (its live view is down); the turn continues."}
	d.touchedByResync()
	return resyncAlive
}

// touchedByResync files a resync that heard from the host: the silence dates from here, like
// any word from the host would.
func (d *MuseDriver) touchedByResync() {
	d.activity.at = time.Now()
}

// endRecovered ends a turn the poll found finished server-side: the stream never said so, but
// the session is idle and a wedged turn never idles. The transcript keeps what arrived before
// the view died and the notice says the end itself was recovered; the chain runner reads a
// clean end, not a blockage, so a finished turn is done rather than forked and replayed.
// Background work still open instead defers the end: the outcome is alive, and the relay
// keeps waiting on the drain rather than settling here.
func (d *MuseDriver) endRecovered(conn *MspConn, paged int) resyncOutcome {
	d.host.endTurn()

	if d.enterDrain(conn, "ended server-side while silent", 0, "") {
		return resyncAlive
	}
	d.Run.Trace.Note(fmt.Sprintf(
		"muse turn ended server-side while silent, without its terminal word; ending it here (%s replayed; %s)",
		pluralEvents(paged), d.endCensus()))
	d.harvestUsage(conn)
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventNotice, Message: fmt.Sprintf(
		"Muse ended the turn while its live view was down; %s replayed.", pluralEvents(paged))}
	d.EventStream <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 0}
	return resyncEnded
}

// pagedEnd is a turn's end found in the session view: the method it arrived under, the code it
// ends on, and the terminal word the host named — the same three the live path reports.
type pagedEnd struct {
	method   string
	code     int
	terminal string
}

// pageMissed replays what the live stream dropped: the session view's events strictly after
// the newest cursor seen, fed through the relay path so each lands as the turn's own — blocks,
// asks, and the turn's end alike, with the current turn's filters deciding each. It reports
// how many events were fed and, when the replay carried the turn's end, the end itself.
//
// Without a cursor there is nothing to page after — a turn blind from its first minute — so
// the single newest page is read instead: the tail the turn's own events are in, whatever the
// session's older turns hold. Either way the read is bounded; a failing page ends the replay
// with what it has, since a partial catch-up still beats the silence.
func (d *MuseDriver) pageMissed(conn *MspConn, sessionID, after string) (int, *pagedEnd) {
	fed := 0
	feed := func(events []mspViewEvent) *pagedEnd {
		for _, event := range events {
			if event.Method == "" {
				continue
			}
			d.activity.note(event.Method)
			done, code, terminal := d.relayOne(MspNotification{
				Method: event.Method, Params: event.Params})
			fed++
			if done {
				return &pagedEnd{method: event.Method, code: code, terminal: terminal}
			}
		}
		return nil
	}
	if after == "" {
		raw, err := conn.callTimeout("view/page", map[string]any{
			"sessionId": sessionID, "limit": museResyncPageLimit, "direction": "backward",
		}, d.resyncWait())
		if err != nil {
			d.Run.Trace.Note("muse view page failed: " + museSentence(err))
			return 0, nil
		}
		page := museViewPage(raw)
		return fed + len(page.events), feed(page.events)
	}
	cursor := after
	for range museResyncMaxPages {
		raw, err := conn.callTimeout("view/page", map[string]any{
			"sessionId": sessionID, "cursor": cursor, "limit": museResyncPageLimit,
		}, d.resyncWait())
		if err != nil {
			d.Run.Trace.Note("muse view page failed: " + museSentence(err))
			return fed, nil
		}
		page := museViewPage(raw)
		if end := feed(page.events); end != nil {
			return fed, end
		}
		if page.next == "" {
			return fed, nil
		}
		cursor = page.next
	}
	d.Run.Trace.Note("muse view page capped; the oldest missed events stay missed")
	return fed, nil
}

// mspViewEvent is one element of a view/page result: the live notification minus its frame.
type mspViewEvent struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// mspViewPage is a view/page result as the resync reads it: the events in ascending cursor
// order and the anchor of the next page — empty at the end of the view in that direction.
type mspViewPage struct {
	events []mspViewEvent
	next   string
}

// museViewPage parses one view/page result. Unparseable is empty rather than an error: a page
// the driver cannot read is a page that taught it nothing, and the resync has other pulls.
func museViewPage(raw json.RawMessage) mspViewPage {
	var page struct {
		Events []mspViewEvent `json:"events"`
		Next   *string        `json:"nextCursor"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		return mspViewPage{}
	}
	out := mspViewPage{events: page.Events}
	if page.Next != nil {
		out.next = *page.Next
	}
	return out
}

// sessionTurn is what a session read says about the running turn: its load status, which turn
// — if any — runs, and what that turn parks on that nobody was shown.
type sessionTurn struct {
	known    bool
	active   string
	activeOK bool
	parked   []sessionAsk
}

// sessionAsk is one unsettled approval or question the session read lists: the kind, and the
// hub ask id it would carry — empty when the entry names nothing to match on, which counts
// as unseen rather than as held.
type sessionAsk struct {
	kind string
	id   string
}

// readSessionTurn reads the session without attaching to it: no lease, no load, no
// subscription — a point-in-time look at whether the turn still runs. Unknown is a read that
// failed or that answered nothing usable, which the resync treats as no signal either way.
func (d *MuseDriver) readSessionTurn(conn *MspConn, sessionID string) (string, string, sessionTurn) {
	raw, err := conn.callTimeout("session/read", map[string]any{
		"sessionId": sessionID, "excludeItems": true,
	}, d.resyncWait())
	if err != nil {
		d.Run.Trace.Note("muse session poll failed: " + museSentence(err))
		return "", "", sessionTurn{}
	}
	var read struct {
		Session struct {
			Status       string  `json:"status"`
			ActiveTurnID *string `json:"activeTurnId"`
		} `json:"session"`
		Pending []struct {
			Kind        string `json:"kind"`
			ApprovalID  string `json:"approvalId"`
			UserInputID string `json:"userInputId"`
		} `json:"pendingRequests"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		d.Run.Trace.Note("muse session poll could not be understood: " + museSentence(err))
		return "", "", sessionTurn{}
	}
	turn := sessionTurn{known: true}
	if read.Session.ActiveTurnID != nil {
		turn.active, turn.activeOK = *read.Session.ActiveTurnID, true
	}
	for _, pending := range read.Pending {
		ask := sessionAsk{kind: pending.Kind}
		// The hub ask id this entry would carry, for matching against what the hub
		// holds: the same prefixes the relay files live asks under.
		switch {
		case pending.ApprovalID != "":
			ask.id = MuseAskApprovalPrefix + pending.ApprovalID
		case pending.UserInputID != "":
			ask.id = MuseAskQuestionPrefix + pending.UserInputID
		}
		turn.parked = append(turn.parked, ask)
	}
	return read.Session.Status, turn.active, turn
}

// noteJournal takes the host journal's baseline: the size and modification time the resyncs
// below compare against. Best effort — an unresolvable journal simply leaves no baseline, and
// the first sighting of one then counts as growth.
func (d *MuseDriver) noteJournal() {
	path := d.journalPath()
	if path == "" {
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		return
	}

	d.recovery.journalSize, d.recovery.journalAt, d.recovery.journalKnown = info.Size(), info.ModTime(), true
}

// journalGrew reports whether the host wrote to its journal since the baseline — and moves the
// baseline here either way, so each resync judges its own window. Only metadata is read, never
// the records: growth says the host did something, which is the whole of the signal. A journal
// that cannot be resolved says nothing, and a first sighting says growth, since a journal that
// appeared was written.
func (d *MuseDriver) journalGrew() bool {
	path := d.journalPath()
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	size, at, known := info.Size(), info.ModTime(), d.recovery.journalKnown
	grew := !known || size != d.recovery.journalSize || at.After(d.recovery.journalAt)
	d.recovery.journalSize, d.recovery.journalAt, d.recovery.journalKnown = size, at, true
	return grew
}

// journalPath resolves the host journal of this turn's session: the file a post-mortem opens,
// and the resync's liveness signal. Empty is unresolvable — no session yet, or no data home.
func (d *MuseDriver) journalPath() string {
	return MuseHostSessionLog(d.host.snapshot().sessionID)
}

// pluralEvents and pluralAsks are counts as sentences: "no missed events", "1 missed event",
// "3 unseen asks".
func pluralEvents(n int) string {
	switch n {
	case 0:
		return "no missed events"
	case 1:
		return "1 missed event"
	default:
		return fmt.Sprintf("%d missed events", n)
	}
}

func pluralAsks(n int) string {
	if n == 1 {
		return "an approval or answer"
	}
	return fmt.Sprintf("%d approvals or answers", n)
}
