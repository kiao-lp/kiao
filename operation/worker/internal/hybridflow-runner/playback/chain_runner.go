package playback

import (
	"context"
	"errors"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Retain this many ended runs alongside all live runs.
const chainRunsKept = 20

// Resume allows the user message, arriving separately over WebSocket, to start a turn.
const chainRunResumeWindow = 30 * time.Second

// Allow shutdown notifications to reach clients before turning off the machine.
const chainRunShutdownGrace = 3 * time.Second

// ChainRunner owns the run registry and coordinates board playback through its ports.
type ChainRunner struct {
	Hub   TurnExecutor
	convs *conversations.ConversationStore
	cfg   *runnerconfig.Config

	// BoardStore owns card claims and mutations. Nil refuses all playback.
	Boards pkgBoards.BoardStore

	// Agents resolves managed agent ids through hybridflow-store.
	// Without a resolver only legacy engine/model cards can play.
	Agents pkgBoards.AgentResolver

	// Runners supplies display names for runner pinning refusals.
	Runners pkgBoards.RunnerResolver

	// Log writes are nil-safe and best-effort, independent of execution success.
	runLogs *ChainRunLogStore

	// Timing and retry policy are fixed at assembly. Tests can shorten waits.
	RetryWait     time.Duration
	RetryLimit    int
	ResumeWindow  time.Duration
	ShutdownGrace time.Duration
	RefreshLeeway time.Duration

	// Shutdown is nil when the deployment cannot turn off its machine.
	Shutdown func() error

	// Mu protects registry membership and mutable run state, including snapshots.
	Mu sync.Mutex
	// Runs retains live and recent ended runs, oldest first.
	Runs []*ChainRun
}

func NewChainRunner(cfg *runnerconfig.Config, hub TurnExecutor, convs *conversations.ConversationStore, boards pkgBoards.BoardStore, agents pkgBoards.AgentResolver, runners pkgBoards.RunnerResolver) *ChainRunner {
	var runLogs *ChainRunLogStore
	if cfg != nil && cfg.Config != nil {
		runLogs = NewChainRunLogStore(cfg.StatePath)
	}
	return &ChainRunner{
		Hub: hub, convs: convs, Boards: boards, Agents: agents, Runners: runners, cfg: cfg,
		runLogs:   runLogs,
		RetryWait: chainRunRetryWait, RetryLimit: chainRunRetryLimit, ResumeWindow: chainRunResumeWindow,
		ShutdownGrace: chainRunShutdownGrace, RefreshLeeway: chainRunRefreshLeeway,
		Shutdown: MachinePowerOff(cfg),
	}
}

// find requires Mu.
func (r *ChainRunner) find(id string) *ChainRun {
	for _, run := range r.Runs {
		if run.Id == id {
			return run
		}
	}
	return nil
}

// holder finds the live run on a card. Ended runs hold nothing. Requires Mu.
func (r *ChainRunner) holder(handle, flowNodeID string) *ChainRun {
	for _, run := range r.Runs {
		if run.State != ChainRunStateEnded && run.Handle == handle && run.FlowNodeID == flowNodeID {
			return run
		}
	}
	return nil
}

// Play starts an independent run. Another live run on the same card is refused.
func (r *ChainRunner) Play(id access.Identity, handle, flowNodeID, name string) (*runstate.HarnessChainRunDto, error) {
	handle = strings.TrimSpace(handle)
	if handle == "" {
		return nil, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "no board named"}
	}
	board, err := r.read(handle)
	if err != nil {
		return nil, err
	}
	flowNode := board.FlowNode(strings.TrimSpace(flowNodeID))
	if flowNode == nil {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such flow node on this board: " + flowNodeID}
	}
	if err := r.Playable(board, *flowNode); err != nil {
		return nil, err
	}
	// A card a run died holding is taken back first, so the play meets a free card rather than
	// the run that is gone. What comes back is the board as it stands after the taking.
	board, err = r.reclaim(handle, board, flowNode.ID)
	if err != nil {
		return nil, err
	}
	flowNode = board.FlowNode(flowNode.ID)
	if flowNode == nil {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such flow node on this board: " + flowNodeID}
	}

	r.Mu.Lock()
	if held := r.holder(handle, flowNode.ID); held != nil {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{
			Status: http.StatusConflict,
			Msg:    "“" + held.Name + "” is already playing this flow node",
		}
	}
	run := &ChainRun{
		Id:             "run-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4],
		Name:           chainRunName(name),
		Handle:         handle,
		Owner:          id,
		RootFlowNodeID: flowNode.ID,
		FlowNodeID:     flowNode.ID,
		Chat:           flowNode.Chat,
		State:          ChainRunStatePlaying,
		startedAt:      time.Now(),
	}
	execution := r.startLocked(run, board, false)
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run started",
		"user", id.User, "run", run.Id, "name", run.Name, "board", handle, "flowNode", flowNode.ID, "chat", flowNode.Chat)
	r.runLogs.Create(run.Id, run.Name, handle, flowNode.ID, id.User, run.startedAt)
	r.announce(nil)
	go r.loop(run, execution)
	return dto, nil
}

// Playable applies card, connection, deployment and agent rules before a run starts.
func (r *ChainRunner) Playable(board *pkgBoards.BoardContent, flowNode pkgBoards.FlowNode) error {
	if err := board.ConnectionError(flowNode.ID); err != nil {
		return &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: err.Error()}
	}
	if !flowNode.Runnable() {
		return &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: playRefusal(flowNode)}
	}
	// A Gateway fires only once every branch feeding into it is done: starting one still waiting
	// is refused at the click, naming what it waits for.
	if flowNode.IsGateway() {
		if waiting := waitingBranches(board, flowNode); len(waiting) > 0 {
			return &httpkit.HTTPError{Status: http.StatusBadRequest,
				Msg: "this gateway waits for " + strings.Join(waiting, ", ")}
		}
	}
	// On an AI card the prompt is what the card says — its title, its description or its
	// success criteria — so one saying none of them has nothing to send. Writing one of them is
	// what offers the card a turn.
	if !flowNode.HasWork() {
		return &httpkit.HTTPError{
			Status: http.StatusBadRequest,
			Msg:    "this flow node has no title, description or success criteria, so there is nothing to send",
		}
	}
	if flowNode.IsAI() && !r.cfg.AllowsPermissionMode(flowNode.Settings.Permission) {
		return &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: turnevents.BypassDisabledMessage}
	}
	// A card pinned to a runner is played there and refused everywhere else — the work happens
	// where that machine's folders are. Unpinned cards play wherever a Play is pressed.
	if refusal := r.RunnerRefusal(flowNode); refusal != "" {
		return &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: refusal}
	}
	// And the same question asked of the agent the card names rather than of the deployment. The
	// boards are one list shared by every machine, so a card may perfectly well name an agent this
	// host does not offer, or a mode that agent does not have. Both are refused here, at the click,
	// where the message can name the card's own words.
	if refusal := r.AgentRefusal(flowNode); refusal != "" {
		return &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: refusal}
	}
	return nil
}

// startLocked creates one execution and registers its shared state under Mu.
// A previous execution must have closed Done before the run can be activated again.
func (r *ChainRunner) startLocked(run *ChainRun, board *pkgBoards.BoardContent, attach bool) *runExecution {
	ctx, cancel := context.WithCancel(context.Background())
	run.cancel = cancel
	run.Done = make(chan struct{})
	run.freshWake()
	run.endedAt = time.Time{}
	run.ending = ""
	run.gone = false
	if board != nil {
		run.chain = pkgBoards.ChainFrom(board, run.trail, run.FlowNodeID)
	}
	markChain(run)
	if r.find(run.Id) == nil {
		r.Runs = append(r.Runs, run)
	}
	r.evictLocked()
	return &runExecution{
		ctx: ctx, done: run.Done,
		first: chainStep{flowNodeID: run.FlowNodeID, chat: run.Chat, how: playHow{attach: attach}},
	}
}

// Use the supplied name, or the start time when it is empty.
func chainRunName(name string) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return "Started " + time.Now().Format("2 Jan 15:04")
}

// evictLocked removes the oldest excess ended runs. Live runs are always retained.
func (r *ChainRunner) evictLocked() {
	ended := 0
	for _, run := range r.Runs {
		if run.State == ChainRunStateEnded {
			ended++
		}
	}
	for ended > chainRunsKept {
		for i, run := range r.Runs {
			if run.State == ChainRunStateEnded {
				r.Runs = append(r.Runs[:i], r.Runs[i+1:]...)
				ended--
				break
			}
		}
	}
}

// playRefusal describes the missing requirement of this card type.
func playRefusal(flowNode pkgBoards.FlowNode) string {
	switch flowNode.Type {
	case pkgBoards.FlowNodeTypeScheduler:
		return "this scheduler names no datetime, so there is nothing to wait for"
	case pkgBoards.FlowNodeTypeAI:
		return "this flow node names no agent, effort, permission mode and folder, so nothing can play it"
	case pkgBoards.FlowNodeTypeGateway:
		return "this gateway waits for branches that are not done yet"
	}
	return "this flow node is one somebody does themselves, so nothing here plays it"
}

// Stop lets the current turn finish and prevents successors. It wakes waits immediately;
// a suspended run ends synchronously because its loop has already suspended.
func (r *ChainRunner) Stop(runID string) error {
	r.Mu.Lock()
	run := r.find(strings.TrimSpace(runID))
	if run == nil {
		r.Mu.Unlock()
		return &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such chain run: " + runID}
	}
	if run.State == ChainRunStateEnded {
		r.Mu.Unlock()
		return nil
	}
	suspended := run.State == ChainRunStateSuspended
	run.stopping, run.ended = true, true
	if !suspended {
		run.State = chainRunStateStopping
	}
	flowNodeID, chat := run.FlowNodeID, run.Chat
	r.Mu.Unlock()

	r.LogNote(run, flowNodeID, chat, "", "stop requested")
	if !suspended {
		r.LogState(run, flowNodeID, chat, chainRunStateStopping)
	}
	if suspended {
		// Nothing is running: the loop left when it suspended, so there is no goroutine to end.
		r.end(run, "")
		pkgBoards.LogChainRun.Info("suspended run ended", "run", run.Id)
		return nil
	}
	// A wait is what Stop cuts short — between two tries, or a Scheduler's; a turn is left to finish.
	run.wakeUp()
	pkgBoards.LogChainRun.Info("run stopping", "run", run.Id, "flowNode", flowNodeID)
	r.announce(nil)
	return nil
}

// Resume reactivates a suspended run on its current card and chat. Its first attempt
// attaches to the user's turn, or submits the card after ResumeWindow.
func (r *ChainRunner) Resume(id access.Identity, runID string) (*runstate.HarnessChainRunDto, error) {
	r.Mu.Lock()
	run := r.find(strings.TrimSpace(runID))
	if run == nil || run.State != ChainRunStateSuspended {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "no suspended chain run to resume"}
	}
	handle, at := run.Handle, run.FlowNodeID
	previous := run.Done
	r.Mu.Unlock()
	waitForExecution(previous)
	board, err := r.read(handle)
	if err != nil {
		return nil, err
	}
	if err := board.ConnectionError(at); err != nil {
		return nil, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: err.Error()}
	}
	r.Mu.Lock()
	if r.find(strings.TrimSpace(runID)) != run || run.State != ChainRunStateSuspended || run.FlowNodeID != at || run.Done != previous {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "the suspended chain run has changed"}
	}
	run.stopping, run.ended = false, false
	run.State = ChainRunStatePlaying
	run.Owner = id
	execution := r.startLocked(run, nil, true)
	flowNodeID, chat := run.FlowNodeID, run.Chat
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run resumed", "user", id.User, "run", run.Id, "flowNode", flowNodeID, "chat", chat)
	r.runLogs.Resumed(run.Id, flowNodeID, chat)
	r.announce(nil)
	// Attaching rather than prompting: the turn this run picks back up is the one the user is
	// starting, and its answer is the flow node's.
	go r.loop(run, execution)
	return dto, nil
}

// Restart reactivates an ended run from its root card, keeping its name and registry position.
func (r *ChainRunner) Restart(id access.Identity, runID string) (*runstate.HarnessChainRunDto, error) {
	r.Mu.Lock()
	run := r.find(strings.TrimSpace(runID))
	if run == nil {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such chain run: " + runID}
	}
	if run.State != ChainRunStateEnded {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "“" + run.Name + "” is still playing"}
	}
	handle, rootFlowNode := run.Handle, run.RootFlowNodeID
	previous := run.Done
	r.Mu.Unlock()
	waitForExecution(previous)

	board, err := r.read(handle)
	if err != nil {
		return nil, err
	}
	flowNode := board.FlowNode(rootFlowNode)
	if flowNode == nil {
		return nil, &httpkit.HTTPError{
			Status: http.StatusNotFound,
			Msg:    "the flow node this chain run started on is no longer on the board",
		}
	}
	if err := r.Playable(board, *flowNode); err != nil {
		return nil, err
	}
	// Taken back first where the run holding it is gone, as a play takes it: a restart is a play
	// under a name the list already holds.
	board, err = r.reclaim(handle, board, flowNode.ID)
	if err != nil {
		return nil, err
	}
	flowNode = board.FlowNode(flowNode.ID)
	if flowNode == nil {
		return nil, &httpkit.HTTPError{
			Status: http.StatusNotFound,
			Msg:    "the flow node this chain run started on is no longer on the board",
		}
	}

	r.Mu.Lock()
	if r.find(strings.TrimSpace(runID)) != run || run.State != ChainRunStateEnded || run.Done != previous {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "the ended chain run has changed"}
	}
	if held := r.holder(handle, flowNode.ID); held != nil {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{
			Status: http.StatusConflict,
			Msg:    "“" + held.Name + "” is already playing this flow node",
		}
	}
	run.Owner = id
	run.FlowNodeID, run.Chat = flowNode.ID, flowNode.Chat
	run.trail = nil
	run.State = ChainRunStatePlaying
	startedAt := time.Now()
	run.startedAt = startedAt
	run.retryAt = time.Time{}
	run.documentAt = time.Time{}
	run.stopping, run.ended = false, false
	execution := r.startLocked(run, board, false)
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run restarted",
		"user", id.User, "run", run.Id, "name", run.Name, "board", handle, "flowNode", flowNode.ID)
	r.runLogs.Restarted(run.Id, flowNode.ID, startedAt)
	r.announce(nil)
	go r.loop(run, execution)
	return dto, nil
}

// Completion includes final board writes, log entries and notifications.
func waitForExecution(done <-chan struct{}) {
	if done != nil {
		<-done
	}
}

// Forget removes an ended run from the registry while retaining its log.
func (r *ChainRunner) Forget(runID string) error {
	r.Mu.Lock()
	run := r.find(strings.TrimSpace(runID))
	if run == nil {
		r.Mu.Unlock()
		return nil
	}
	if run.State != ChainRunStateEnded {
		r.Mu.Unlock()
		return &httpkit.HTTPError{Status: http.StatusConflict, Msg: "“" + run.Name + "” is still playing"}
	}
	run.gone = true
	flowNodeID, chat := run.FlowNodeID, run.Chat
	for i, held := range r.Runs {
		if held == run {
			r.Runs = append(r.Runs[:i], r.Runs[i+1:]...)
			break
		}
	}
	r.Mu.Unlock()
	// The row goes; the log stays, which is what it is for — a forgotten run is still one worth
	// diagnosing.
	r.LogNote(run, flowNodeID, chat, "", "run forgotten")
	r.announce(nil)
	return nil
}

// abandon cancels execution and waits for its loop to leave. kill also stops its turn.
func (r *ChainRunner) abandon(run *ChainRun, kill bool) {
	r.Mu.Lock()
	run.gone = true
	cancel, done, chat, owner := run.cancel, run.Done, run.Chat, run.Owner
	flowNodeID := run.FlowNodeID
	r.Mu.Unlock()
	r.LogNote(run, flowNodeID, chat, "", "run abandoned")
	if cancel != nil {
		cancel()
	}
	if kill && chat != "" && r.Hub != nil {
		r.Hub.StopTurn(chat, owner.User)
	}
	if done != nil {
		<-done
	}
}

// turnStopped interrupts chain progression when the chat stops its turn.
// The loop preserves the card and conversation for Resume unless Stop was also requested.
func (r *ChainRunner) turnStopped(conversationID string) {
	r.Mu.Lock()
	type stoppedHit struct {
		run            *ChainRun
		flowNodeID, ch string
	}
	var hit []stoppedHit
	for _, run := range r.Runs {
		if run.Chat == conversationID && run.State != ChainRunStateSuspended && run.State != ChainRunStateEnded {
			run.stopping = true
			hit = append(hit, stoppedHit{run: run, flowNodeID: run.FlowNodeID, ch: run.Chat})
		}
	}
	r.Mu.Unlock()
	// The turn is already ending — that is what a stop is — so this is only about a run that was
	// waiting to try again rather than running anything.
	for _, h := range hit {
		r.LogNote(h.run, h.flowNodeID, h.ch, "", "the turn was stopped from outside the run")
		h.run.wakeUp()
	}
}

// ConversationGone abandons runs whose conversation was deleted, including suspended ones.
func (r *ChainRunner) ConversationGone(conversationID string) {
	r.Mu.Lock()
	var hit []*ChainRun
	for _, run := range r.Runs {
		if run.Chat == conversationID && run.State != ChainRunStateEnded {
			hit = append(hit, run)
		}
	}
	r.Mu.Unlock()
	for _, run := range hit {
		pkgBoards.LogChainRun.Info("run ended: its conversation was deleted",
			"run", run.Id, "conversation", conversationID)
		r.abandon(run, false)
		r.say(run, runstate.NoticeWarning,
			"The conversation “"+run.Name+"” was playing in was deleted, so the play stopped.")
		r.end(run, "")
	}
}

var ErrNoChainRunner = errors.New("this service runs no chain runner")
