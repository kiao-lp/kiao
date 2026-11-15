package playback

import (
	"context"
	"kiao/worker/internal/core/access"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"sync"
	"time"
)

// A card turn is running or being prepared.
const ChainRunStatePlaying = "playing"

// The completed AI card is compacting its conversation before handover.
const chainRunStateCompacting = "compacting"

// A transient failure holds the card until retryAt, then resends its prompt.
const ChainRunStateWaiting = "waiting"

// A usage limit holds the card until retryAt, then resumes its interrupted turn.
const ChainRunStateRefreshing = "refreshing"

// A Scheduler holds until its duration or datetime elapses.
const ChainRunStateScheduled = "scheduled"

// Stop was requested; the current turn is allowed to settle.
const chainRunStateStopping = "stopping"

// An interrupted turn keeps its card and chat available for Resume.
const ChainRunStateSuspended = "suspended"

// An ended run stays in the registry for Restart or Forget.
const ChainRunStateEnded = "ended"

// ChainRun is the state shared by the loop, lifecycle requests and observers.
// ChainRunner.Mu protects mutable fields; snapshots copy them for transport. Id, Name, Handle
// and RootFlowNodeID are fixed at registration. Owner is fixed for each execution.
type ChainRun struct {
	Id string
	// Name distinguishes runs of the same board.
	Name   string
	Handle string
	Owner  access.Identity

	// RootFlowNodeID is the restart point.
	RootFlowNodeID string
	// trail records completed cards in order, including a forked branch's ancestors.
	trail []string
	// chain combines the trail, current card and forecast, refreshed after board operations.
	chain []runstate.HarnessChainRunFlowNodeDto

	// flowNodeID is the card being played or compacted after completion.
	FlowNodeID string
	// Chat is empty before conversation creation and on cards without a turn.
	Chat      string
	State     string
	retryAt   time.Time
	startedAt time.Time
	// documentAt invalidates clients' board copies after a write.
	documentAt time.Time
	// endedAt is zero until completion.
	endedAt time.Time
	// ending retains the last notice or explicit stop reason for snapshots and logs.
	ending string
	// gone abandons the execution or removes an ended run from the registry.
	gone bool
	// stopping prevents successors after Stop or a chat interruption.
	stopping bool
	// ended distinguishes an explicit Stop from a resumable chat interruption.
	ended bool

	// cancel abandons the execution. Stop uses wake and lets a running turn settle.
	cancel context.CancelFunc
	// Done belongs to one execution and closes after its final writes and notifications.
	// Resume and Restart wait for it before reusing this run's mutable state.
	Done chan struct{}

	// wake interrupts waits while allowing the held card to be marked on exit.
	// Only wakeMu protects the signal. When both locks are needed, Mu comes first.
	wakeMu sync.Mutex
	woken  bool
	wake   chan struct{}
}

// wakeUp closes the execution's wake signal once.
func (run *ChainRun) wakeUp() {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	if !run.woken {
		run.woken = true
		close(run.wake)
	}
}

// waking reads the current execution's wake signal.
func (run *ChainRun) waking() <-chan struct{} {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	return run.wake
}

// freshWake arms a fresh signal at activation, under Mu then wakeMu.
func (run *ChainRun) freshWake() {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	run.woken = false
	run.wake = make(chan struct{})
}

// Snapshots copies shared state under Mu, oldest run first.
func (r *ChainRunner) Snapshots() []*runstate.HarnessChainRunDto {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return r.snapshotsLocked()
}

func (r *ChainRunner) snapshotsLocked() []*runstate.HarnessChainRunDto {
	out := make([]*runstate.HarnessChainRunDto, 0, len(r.Runs))
	for _, run := range r.Runs {
		out = append(out, snapshotOf(run))
	}
	return out
}

// snapshotOf copies a run under Mu; transport never receives the mutable run.
func snapshotOf(run *ChainRun) *runstate.HarnessChainRunDto {
	dto := &runstate.HarnessChainRunDto{
		ID:             run.Id,
		Name:           run.Name,
		Handle:         run.Handle,
		RootFlowNodeID: run.RootFlowNodeID,
		FlowNodeID:     run.FlowNodeID,
		Chat:           run.Chat,
		State:          run.State,
		StartedAt:      run.startedAt.UnixMilli(),
		Ending:         run.ending,
	}
	// The times are left out rather than sent as the epoch of a zero time, which is a date in year
	// one and reads, to a client comparing it, as a board written long ago.
	if !run.retryAt.IsZero() {
		dto.RetryAt = run.retryAt.UnixMilli()
	}
	if !run.documentAt.IsZero() {
		dto.DocumentAt = run.documentAt.UnixMilli()
	}
	if !run.endedAt.IsZero() {
		dto.EndedAt = run.endedAt.UnixMilli()
	}
	if len(run.chain) > 0 {
		dto.FlowNodes = append([]runstate.HarnessChainRunFlowNodeDto(nil), run.chain...)
	}
	return dto
}

// announce broadcasts snapshots and an optional run-authored notice.
func (r *ChainRunner) announce(notice *runstate.HarnessChainRunNoticeDto) {
	if r.Hub == nil {
		return
	}
	frame := map[string]any{"type": "chainRun", "runs": r.Snapshots()}
	if notice != nil {
		frame["notice"] = notice
	}
	r.Hub.NotifyRegistry(frame)
}

// say keeps the last notice as the ending, logs it and broadcasts it with the run name.
func (r *ChainRunner) say(run *ChainRun, level, text string) {
	r.Mu.Lock()
	name := run.Name
	flowNodeID, chat := run.FlowNodeID, run.Chat
	run.ending = text
	r.Mu.Unlock()
	// Filed as well as shown: a toast is gone in seconds, and the run's log is what says
	// afterwards what it decided.
	r.LogNote(run, flowNodeID, chat, level, text)
	r.announce(&runstate.HarnessChainRunNoticeDto{
		Level: level, Text: text, At: time.Now().UnixMilli(), ChainRun: name,
	})
}

// setState publishes the card, chat and state together. A concurrent Stop keeps playing
// visible as stopping; an abandoned run cannot change state here.
func (r *ChainRunner) setState(run *ChainRun, flowNodeID, chat, state string) {
	r.Mu.Lock()
	moved := !run.gone
	if moved {
		run.FlowNodeID, run.Chat = flowNodeID, chat
		run.State = state
		if state != ChainRunStateWaiting && state != ChainRunStateRefreshing {
			run.retryAt = time.Time{}
		}
		if run.stopping && state == ChainRunStatePlaying {
			// Stop was pressed while this turn was being set up: the card says so rather than showing
			// a spinner that is about to end.
			run.State = chainRunStateStopping
		}
		markChain(run)
	}
	atFlowNode, atChat, atState := run.FlowNodeID, run.Chat, run.State
	r.Mu.Unlock()
	if moved {
		r.LogState(run, atFlowNode, atChat, atState)
	}
	r.announce(nil)
}

// markChain updates current and played markers under Mu. Board-derived titles and statuses
// are refreshed only after board reads and writes.
func markChain(run *ChainRun) {
	played := map[string]bool{}
	for _, id := range run.trail {
		played[id] = true
	}
	live := run.State != ChainRunStateEnded
	for i := range run.chain {
		run.chain[i].Played = played[run.chain[i].ID]
		run.chain[i].Current = live && run.chain[i].ID == run.FlowNodeID
	}
}

// end publishes completion and persists its log before exposing ended state.
// An empty reason keeps the last notice as the ending.
func (r *ChainRunner) end(run *ChainRun, reason string) {
	r.Mu.Lock()
	moved := run.State != ChainRunStateEnded
	if moved {
		run.State = ChainRunStateEnded
		run.endedAt = time.Now()
		run.retryAt = time.Time{}
		run.stopping = false
		if reason != "" {
			run.ending = reason
		}
		markChain(run)
	}
	r.evictLocked()
	if moved {
		// Filed before the lock is released: a run that reads as ended has filed its ending,
		// so nothing ever observes an end the log does not explain yet. The one place this
		// half does file I/O under a lock, and it is once per run.
		r.LogState(run, run.FlowNodeID, run.Chat, ChainRunStateEnded)
		r.runLogs.Finish(run.Id, ChainRunStateEnded, run.ending, run.endedAt)
	}
	r.Mu.Unlock()
	r.announce(nil)
}

// A user-requested stop records an ending without raising another notice.
const chainRunStopped = "Stopped."

// suspend keeps the run where it stopped, so that saying something in its chat picks it back up.
func (r *ChainRunner) suspend(run *ChainRun, flowNodeID, chat string) {
	r.Mu.Lock()
	held := !run.gone
	if held {
		run.FlowNodeID, run.Chat = flowNodeID, chat
		run.State = ChainRunStateSuspended
		run.stopping = false
		run.retryAt = time.Time{}
		markChain(run)
	}
	r.Mu.Unlock()
	if !held {
		return
	}
	r.announce(nil)
	r.LogState(run, flowNodeID, chat, ChainRunStateSuspended)
	// A conversation deleted under the run cannot be resumed into, and a suspended run pointing at one
	// would offer the user a choice with nothing behind it.
	if _, err := r.convs.Get(chat); err != nil {
		pkgBoards.LogChainRun.Info("run ended: its conversation is gone", "run", run.Id, "conversation", chat)
		r.end(run, "")
		return
	}
	pkgBoards.LogChainRun.Info("run suspended", "run", run.Id, "flowNode", flowNodeID, "chat", chat)
	r.say(run, runstate.NoticeInfo, "The turn was stopped, so the play stopped with it. "+
		"Send a message in this chat to pick it back up.")
}

// stoppedReason overrides the last notice only when Stop was explicitly requested.
func (r *ChainRunner) stoppedReason(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	if run.ended {
		return chainRunStopped
	}
	return ""
}

// nameOf reads the run name under Mu.
func (r *ChainRunner) nameOf(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.Name
}

// chatOf reads the current chat under Mu.
func (r *ChainRunner) chatOf(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.Chat
}

// walked records completion once in the shared trail and updates snapshot markers.
func (r *ChainRunner) walked(run *ChainRun, flowNodeID string) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	for _, id := range run.trail {
		if id == flowNodeID {
			return
		}
	}
	run.trail = append(run.trail, flowNodeID)
	markChain(run)
}

// holderOf reads the name of a card's live run under Mu.
func (r *ChainRunner) holderOf(handle, flowNodeID string) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	if held := r.holder(handle, flowNodeID); held != nil {
		return held.Name
	}
	return ""
}

// stopping includes both a requested stop and abandonment.
func (r *ChainRunner) stopping(run *ChainRun) bool {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.gone || run.stopping
}

// ended distinguishes Stop or abandonment from a resumable chat interruption.
func (r *ChainRunner) ended(run *ChainRun) bool {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.gone || run.ended
}
