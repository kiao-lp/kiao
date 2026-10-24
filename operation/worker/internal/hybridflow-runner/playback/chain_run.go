package playback

import (
	"context"
	"errors"
	"fmt"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"strings"
	"sync"
	"time"
)

// A turn is running for the run's flow node, or is about to be sent.
const ChainRunStatePlaying = "playing"

// The chat the card just played ran in is being shortened (`/compact`), which that card asked for.
// The same card is marked as while it was playing — the chat is its own — but its flow node is
// marked done by then, and the board says which of the two is going on.
const chainRunStateCompacting = "compacting"

// The turn came back an error worth waiting out, and the same flow node is sent again at
// `retryAt`.
const ChainRunStateWaiting = "waiting"

// The agent's usage limit was reached, and the run is holding its flow node until the moment that
// limit lifts — `retryAt`, which may be hours off rather than the twenty minutes `waiting` is.
// What goes in then is not the flow node again but the word that picks its cut-off turn back up,
// so the two are not the same wait and the board does not say they are. The flow node carries the
// same distinction on the card, as `waiting-refresh`.
const ChainRunStateRefreshing = "refreshing"

// A **Scheduler** card is holding for its datetime, which is the one thing it does. Nothing is
// running and nothing has gone wrong. What moment it is holding for is not sent: it is written on
// the card, which is where a board reads it.
const ChainRunStateScheduled = "scheduled"

// Stop was asked for and a turn is still running: this flow node is the last one played.
const chainRunStateStopping = "stopping"

// The turn was stopped from its chat, so the run stopped with it. It is kept, rather than
// forgotten, because the plainest thing to do next is to say something in that chat and carry on —
// see resume.
const ChainRunStateSuspended = "suspended"

// The run is over, however it ended: the chain ran out, somebody stopped it, a flow node failed.
// It stays in the list saying so — `endedAt` and the sentence it ended on — because what is
// offered on a finished run is a restart, and a run that vanished when it stopped could not be
// offered one. See end.
const ChainRunStateEnded = "ended"

// chainRunsKept is how many ended runs are kept behind the live ones. A panel is a list somebody
// reads, not an archive: what happened this session is worth having, and the run before that one is
// in the board itself, where every card says where it stands. The oldest goes when the count is
// passed.
const chainRunsKept = 20

// chainRunRetryWait is how long a run waits before sending a flow node again whose turn came
// back an error that passes.
//
// Long, because what is being waited on is not a hiccup: the CLI has already spent its own retries
// on the request before it gives up and writes the notice, so the API being at capacity or a limit
// being reached is a state of the world minutes deep. Sending the same prompt back a moment later
// is one more turn refused, and, for a usage limit, one more turn refused for exactly as long as
// the run is willing to keep asking.
const chainRunRetryWait = 20 * time.Minute

// chainRunRetryLimit is how many times in a row one flow node is sent again before the run gives
// up on it. Four attempts spanning an hour is a long enough outage to be somebody's business rather
// than the board's: a run left to retry for ever is a board that looks busy and is not.
const chainRunRetryLimit = 3

// chainRunResumePrompt is what a flow node held by a usage limit is sent when the limit lifts.
// It is the truth about what happened and nothing more: the CLI stopped mid-work because the
// account had nothing left to spend, the conversation is intact, and the turn is being asked to
// pick itself back up rather than to start the flow node over.
const ChainRunResumePrompt = "You have been interrupted, please resume cleanly"

// chainRunRefreshLeeway is how long past the moment a limit says it lifts the run waits before
// asking again. A window that resets at 7:10pm is a window whose first second is contended and
// whose clock is not this machine's, and a turn refused on it costs one of the four tries; a minute
// costs nothing.
const chainRunRefreshLeeway = time.Minute

// chainRunResumeWindow is how long a resumed run waits for the message the user is sending to
// become a turn before playing its flow node itself. The two arrive on different roads — the resume
// is a request, the message a socket frame — so the run gives the frame a moment to land rather
// than racing it into a second turn the conversation would refuse.
const chainRunResumeWindow = 30 * time.Second

// chainRunShutdownGrace is how long the run leaves between saying the machine is going off and
// sending the command that takes it off. What every open tab is about to lose is the service
// telling it things, so the last thing it is told wants to have arrived — a few seconds is nothing
// at the end of a chain, and it is the difference between a board that said why it stopped and one
// that simply went away.
const chainRunShutdownGrace = 3 * time.Second

// chainRun is the run itself: what is playing, where, and what it is doing.
//
// Everything in it is read under the runner's lock and copied out — a snapshot is what goes on the
// wire, never this — because the loop mutates it from its own goroutine.
type ChainRun struct {
	Id string
	// name is what the person who started it called it. It is asked for at the click and never
	// derived from the board: two runs of one board are told apart by nothing else.
	Name   string
	Handle string
	Owner  access.Identity

	// rootFlowNodeID is the card the run was started on. It never moves — a restart plays it again —
	// where flowNodeID is wherever the chain has got to.
	RootFlowNodeID string
	// trail is every flow node this run has played, in the order it played them. It is what the chain
	// behind the run is drawn from, and what keeps a chain that loops back from running for ever.
	trail []string
	// chain is the run's flow nodes as a client is told about them: the trail, the flow node under way
	// and what is ahead of it, each with the title and status the board had when this was last worked
	// out. Recomputed wherever a board has just been read anyway, never on a read of its own.
	chain []runstate.AgentChainRunFlowNodeDto

	// flowNodeID is the flow node being played, or the one whose chat is being shortened now that it
	// is done.
	FlowNodeID string
	// chat is the conversation that flow node is played in. Empty only in the moment before one is
	// made.
	Chat      string
	State     string
	retryAt   time.Time
	startedAt time.Time
	// documentAt is when the run last wrote the board. A client holding that document reloads on it:
	// the run marks cards of the file the user may have open, and the two must not disagree.
	documentAt time.Time
	// endedAt is when the run stopped, and the zero time while it has not.
	endedAt time.Time
	// ending is the last thing the run said — why it stopped, in the words it stopped in. Kept so a
	// run read an hour after the toast went by still explains itself.
	ending string
	// gone is the run having been abandoned outright: forgotten, or replaced by a restart. Its loop
	// drops whatever it is doing without marking anything, which is what tells it from `stopping`.
	gone bool
	// stopping is the run ending after the turn under way: it is marked like any other, and
	// nothing after it is started. Set by Stop, and by the turn being stopped from its chat.
	stopping bool
	// ended is Stop having been pressed, as opposed to the turn having been stopped from its chat.
	// The two are a step apart at the end: a run somebody ended is over, while one whose turn was
	// interrupted is kept, to be picked back up by the next message said in that chat.
	ended bool

	// cancel abandons the run outright: the loop drops whatever it is doing without marking anything.
	// It is what a run being *replaced* by another gets — never what Stop gets, which lets the turn
	// under way finish and be marked like any other.
	cancel context.CancelFunc
	// done is closed when the loop has left. Starting a run waits on the previous one's, so two loops
	// never mark the same board.
	Done chan struct{}

	// wake cuts a wait short — the twenty minutes between two tries, or a Scheduler holding for its
	// datetime. It is not the context: everything that ends a wait early — Stop, and a turn stopped
	// from its chat — still wants the round it is in marked, and cancelling the context
	// would drop that on the floor.
	wakeMu sync.Mutex
	woken  bool
	wake   chan struct{}
}

// wakeUp ends the run's wait, if it is in one. Idempotent, and spent for this stretch of the run: a
// resume makes a fresh one.
func (run *ChainRun) wakeUp() {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	if !run.woken {
		run.woken = true
		close(run.wake)
	}
}

// waking is the channel a wait selects on.
func (run *ChainRun) waking() <-chan struct{} {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	return run.wake
}

// freshWake arms the wake signal again, for a run being picked back up.
func (run *ChainRun) freshWake() {
	run.wakeMu.Lock()
	defer run.wakeMu.Unlock()
	run.woken = false
	run.wake = make(chan struct{})
}

// ChainRunner owns every run the service has: the ones playing, and the ones lately ended that a
// panel can still restart.
type ChainRunner struct {
	Hub   TurnExecutor
	convs *conversations.ConversationStore
	cfg   *runnerconfig.Config

	// boards is where the boards are kept, as named operations on one card (see boards.go). Every
	// mark a run makes is one of them, and the board comes back after it for the chain a panel
	// draws. Nil where no hybridflow-store is named, in which case every play is refused.
	Boards pkgBoards.BoardStore

	// agents resolves what a card's agent names — a managed agent's id — against the
	// hybridflow-store (see chain_agents.go). It is nil where no store is named, and a
	// runner with none plays legacy cards only: an engine with a model beside it, as every card
	// said before managed agents.
	Agents pkgBoards.AgentResolver

	// runners resolves what a card's runner names — a runner's id — against the same store, for
	// the name the refusal of a pinned card carries. It is nil where no store is named,
	// and a refusal there carries the id the card named.
	Runners pkgBoards.RunnerResolver

	// runLogs is the per-run log under the state directory (chain_run_log.go): what each run
	// decided, kept past the run itself. Nil where the state directory names none or cannot be
	// written — every write through it is nil-safe, so a run never fails over its own log.
	runLogs *ChainRunLogStore

	// The five clocks, as fields rather than constants so a test can play a whole chain in
	// milliseconds. Production never changes them.
	RetryWait     time.Duration
	RetryLimit    int
	ResumeWindow  time.Duration
	ShutdownGrace time.Duration
	RefreshLeeway time.Duration

	// shutdown turns the machine off, and is **nil where this deployment cannot** — which is every
	// one but a KIAO started from the command line (see shutdown.go). A field rather than a call
	// into the configuration so that a test can watch for it without the machine going off under it.
	Shutdown func() error

	Mu sync.Mutex
	// runs is every run this service knows, live and ended, oldest first. The order is the one a
	// panel lists them in, so it is the order they were started in and nothing else.
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

// snapshots is every run as every client is told about them, oldest first — an empty list when the
// service has never played anything.
func (r *ChainRunner) Snapshots() []*runstate.AgentChainRunDto {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return r.snapshotsLocked()
}

func (r *ChainRunner) snapshotsLocked() []*runstate.AgentChainRunDto {
	out := make([]*runstate.AgentChainRunDto, 0, len(r.Runs))
	for _, run := range r.Runs {
		out = append(out, snapshotOf(run))
	}
	return out
}

// snapshotOf copies one run out. Called under the runner's lock, always: the loop mutates the run
// from its own goroutine, and what goes on the wire is never the run itself.
func snapshotOf(run *ChainRun) *runstate.AgentChainRunDto {
	dto := &runstate.AgentChainRunDto{
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
		dto.FlowNodes = append([]runstate.AgentChainRunFlowNodeDto(nil), run.chain...)
	}
	return dto
}

// find is the run with this id, or nil. Under the lock.
func (r *ChainRunner) find(id string) *ChainRun {
	for _, run := range r.Runs {
		if run.Id == id {
			return run
		}
	}
	return nil
}

// holder is the live run playing this flow node of this board, or nil — the one question asked
// before a run is started, and again at every step of a chain. Under the lock.
//
// A run that has **ended** holds nothing: its cards are wherever it left them, and playing one
// again is exactly what a restart is.
func (r *ChainRunner) holder(handle, flowNodeID string) *ChainRun {
	for _, run := range r.Runs {
		if run.State != ChainRunStateEnded && run.Handle == handle && run.FlowNodeID == flowNodeID {
			return run
		}
	}
	return nil
}

// reclaim takes the card back from the run holding it, where that run is gone. Runs live in this
// process and nowhere else, so a restart orphans every claim its runs held — and a replay must
// not trip over one: the card is freed, offered a turn again, and read back so the play starts
// from what it says now.
//
// A card held by a run that is still playing is left exactly as it is: taking it would be two
// turns on one flow node, and the play coming is refused for it rather than handed the card.
func (r *ChainRunner) reclaim(handle string, board *pkgBoards.BoardContent, flowNodeID string) (*pkgBoards.BoardContent, error) {
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil || flowNode.Run == "" {
		return board, nil
	}
	r.Mu.Lock()
	live := false
	if run := r.find(flowNode.Run); run != nil && run.State != ChainRunStateEnded {
		live = true
	}
	r.Mu.Unlock()
	if live {
		return board, nil
	}
	held := flowNode.Run
	if _, err := r.Boards.SettleRun(held); err != nil {
		return nil, err
	}
	board, err := r.Boards.Ready(handle, flowNodeID)
	if err != nil {
		return nil, err
	}
	pkgBoards.LogChainRun.Info("the card was taken back from a run that is gone",
		"board", handle, "flowNode", flowNodeID, "run", held)
	return board, nil
}

// announce tells every open socket where the run stands, with a line to show the user when there is
// one worth showing.
//
// The notice is part of the frame rather than a thing a client works out for itself: the run
// decides that a chain ended, that a flow node is being tried again at twenty past, that a folder
// does not match, and only it knows why. A client shows what it is told and invents nothing.
func (r *ChainRunner) announce(notice *runstate.AgentChainRunNoticeDto) {
	if r.Hub == nil {
		return
	}
	frame := map[string]any{"type": "chainRun", "runs": r.Snapshots()}
	if notice != nil {
		frame["notice"] = notice
	}
	r.Hub.NotifyRegistry(frame)
}

// say reports something a run decided, at the level it is worth saying it — and **under the name of
// the run that decided it**, which is the whole difference several runs make to a notice: "«First»
// is played again at 12:20" is a sentence, where the same line unattributed is a riddle.
//
// It is also what the run ends on: the last thing said is kept on it, so a run read long after the
// toast has gone still says why it stopped.
func (r *ChainRunner) say(run *ChainRun, level, text string) {
	r.Mu.Lock()
	name := run.Name
	flowNodeID, chat := run.FlowNodeID, run.Chat
	run.ending = text
	r.Mu.Unlock()
	// Filed as well as shown: a toast is gone in seconds, and the run's log is what says
	// afterwards what it decided.
	r.LogNote(run, flowNodeID, chat, level, text)
	r.announce(&runstate.AgentChainRunNoticeDto{
		Level: level, Text: text, At: time.Now().UnixMilli(), ChainRun: name,
	})
}

// setState moves the run on and tells everybody. The flow node and the chat travel with it: what a
// board draws is a state on a card, so the two are never reported apart.
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

// markChain moves the "you are here" mark along the run's flow nodes. Under the lock, and cheap: it
// is the one part of the chain that changes on a state change, the titles and statuses being the
// board's and refreshed only where the board has just been read.
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

// play starts a run: this flow node, then whatever it says comes after it.
//
// **Other runs are left alone.** What is refused is a second run on the *same card* — two turns on
// one flow node — and nothing else: two boards, or two chains of one board started from two cards,
// play side by side, which is what the panel exists to show.
//
// The board is named by its handle — the slug the browser has it open at — and the name is the
// store's to resolve rather than the runner's to parse. What is refused here is no name at all,
// and a play with no hybridflow-store behind it, which has no board to play.
func (r *ChainRunner) Play(id access.Identity, handle, flowNodeID, name string) (*runstate.AgentChainRunDto, error) {
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
		Done:           make(chan struct{}),
		wake:           make(chan struct{}),
	}
	ctx := r.startLocked(run, board)
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run started",
		"user", id.User, "run", run.Id, "name", run.Name, "board", handle, "flowNode", flowNode.ID, "chat", flowNode.Chat)
	r.runLogs.Create(run.Id, run.Name, handle, flowNode.ID, id.User, run.startedAt)
	r.announce(nil)
	go r.loop(ctx, run, flowNode.ID, flowNode.Chat, false)
	return dto, nil
}

// playable is why a card cannot be started, or nil. The same rules the card's Play button follows,
// asked again here because a request is not a button — and asked of the card's **type**, which is
// what decides what playing it means.
func (r *ChainRunner) Playable(board *pkgBoards.BoardContent, flowNode pkgBoards.FlowNode) error {
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

// startLocked puts a run into the list, ready to be looped over, and hands back the context its
// loop runs under. Under the runner's lock, and the one place a run joins the list.
func (r *ChainRunner) startLocked(run *ChainRun, board *pkgBoards.BoardContent) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	run.cancel = cancel
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
	return ctx
}

// chainRunName is what a run is called: what the user typed, or the moment it started where they
// typed nothing. The box they were offered was prefilled with the same sentence, so an empty name
// is somebody having cleared it rather than a case worth inventing a word for.
func chainRunName(name string) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return "Started " + time.Now().Format("2 Jan 15:04")
}

// evictLocked drops the oldest ended runs once there are more of them than are worth keeping. Live
// runs are never evicted, whatever the count: a run that is playing is not a record of anything.
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

// playRefusal says why a card cannot be played, in the words of the type it is: what is missing on
// a card the board would have offered a Play on is the one thing worth reading here.
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

// stop ends one run. What that means depends on what it is doing, and both readings are the same
// sentence: the run is over.
//
//   - A run playing a turn keeps that turn — it is the user's to interrupt, from the chat, where
//     the
//     Stop button has always been, and ending it from here would kill work already done. The flow node
//     under way finishes and is marked like any other, and nothing after it is started.
//   - A run waiting has no turn to let finish, and ends here and now rather than in twenty minutes'
//     time — or at three in the morning, which is the other wait there is: a Scheduler holding for
//     its datetime.
//   - A suspended run is a record kept for a resume that is not coming. It ends where it stands.
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
	pkgBoards.LogChainRun.Info("run stopping", "run", run.Id, "flowNode", run.FlowNodeID)
	r.announce(nil)
	return nil
}

// resume picks a suspended run back up: the flow node it was on is played again, in its own chat,
// and the chain carries on from there.
//
// **It attaches to the turn the user is starting rather than sending one of its own.** Stopping a
// chat is how a run is stopped, and what somebody does next is say something into that chat — a
// correction, a nudge, the same flow node with something added. That message *is* the flow node's
// turn as far as the board is concerned: its flow node is marked done and the chain follows. So the
// run waits a moment for it, and only plays the flow node itself if nothing comes.
func (r *ChainRunner) Resume(id access.Identity, runID string) (*runstate.AgentChainRunDto, error) {
	r.Mu.Lock()
	run := r.find(strings.TrimSpace(runID))
	if run == nil || run.State != ChainRunStateSuspended {
		r.Mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "no suspended chain run to resume"}
	}
	run.Done = make(chan struct{})
	run.freshWake()
	run.stopping, run.ended = false, false
	run.State = ChainRunStatePlaying
	run.Owner = id
	ctx := r.startLocked(run, nil)
	flowNodeID, chat := run.FlowNodeID, run.Chat
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run resumed", "user", id.User, "run", run.Id, "flowNode", flowNodeID, "chat", chat)
	r.runLogs.Resumed(run.Id, flowNodeID, chat)
	r.announce(nil)
	// Attaching rather than prompting: the turn this run picks back up is the one the user is
	// starting, and its answer is the flow node's.
	go r.loop(ctx, run, flowNodeID, chat, true)
	return dto, nil
}

// restart plays an ended run again, from the card it was started on, under the name it already has
// and in the place it already holds in the list. That is the whole of what "run it again" means:
// the chain is followed afresh from the beginning, whatever it got to last time.
//
// A card whose description went into the conversation the first time round has nothing left to
// send, and the refusal says so in those words — which is the same thing the board says by drawing
// no Play on a card that has run. Writing the next question in its box is what makes it playable
// again.
func (r *ChainRunner) Restart(id access.Identity, runID string) (*runstate.AgentChainRunDto, error) {
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
	r.Mu.Unlock()

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
	run.Done = make(chan struct{})
	run.freshWake()
	ctx := r.startLocked(run, board)
	dto := snapshotOf(run)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("run restarted",
		"user", id.User, "run", run.Id, "name", run.Name, "board", handle, "flowNode", flowNode.ID)
	r.runLogs.Restarted(run.Id, flowNode.ID, startedAt)
	r.announce(nil)
	go r.loop(ctx, run, flowNode.ID, flowNode.Chat, false)
	return dto, nil
}

// forget takes a run out of the list. Only an ended one: a run that is playing is stopped first,
// and making Forget do that quietly would be one button doing two things.
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

// abandon ends a run outright, waiting for its loop to leave: it drops whatever it is doing without
// marking anything. `kill` also interrupts the turn.
//
// It is what a run gets whose conversation went away under it — never what Stop gets, which lets
// the turn under way finish and be marked like any other.
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

// end is the run being over. It stays in the list, saying so and saying why — that is what a panel
// offers a Restart on, and what tells a chain that finished from one somebody stopped.
//
// `reason` is for the endings **nothing was said out loud about**: somebody pressed Stop, and the
// flowNode gone from under the run. Every other ending is a sentence the round already said, and
// `say` kept it — passing "" is a round saying "the last thing I said is why this stopped", which
// is true wherever the round said anything at all.
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

// chainRunStopped is what an ended run says where the ending was somebody pressing Stop: no
// notice is raised for it — the person who pressed it does not need telling — but the row has to
// say something other than whatever the run last said about a flow node it was working on.
const chainRunStopped = "Stopped."

// turnStopped is what the hub tells the runner when a turn was stopped from outside — the chat's
// own Stop button, or a conversation deleted under the run.
//
// **Stopping the chat stops the run**, and it does so because interrupting the turn is the plainest
// way of saying the run is not going as it should; carrying straight on to the next flow node would
// be the board arguing with that. What it does not do is throw the run away: the flow node and its
// chat are kept so that saying something in that chat can pick the whole chain back up.
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

// conversationGone is what the conversation registry tells the runner when a conversation is
// deleted. A run playing in it has just had its turn stopped and is on its way to suspending; a run
// already suspended in it has nothing left to be resumed into. Either way there is no play left to
// keep.
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

// round is what one flow node leaves the loop to do.
type round int

const (
	// The flow node was answered and marked: on to whatever it says comes after it.
	RoundOn round = iota
	// The flow node was not marked, and the reason is one that passes.
	roundAgain
	// The run ends here.
	roundStop
	// The run ends here and is kept, so that saying something in its chat resumes it.
	roundSuspend
	// The flow node was a **Shutdown** and this deployment can honour it: the run ends and the machine
	// goes off with it, whatever else the board says.
	roundPowerOff
)

// playHow is what a round does instead of sending the flow node as it is written. Both answers are
// the same shape of thing — the flow node is played, and what reaches Claude is not its description
// — and both are spent the moment they are used: the round after either one is an ordinary round.
type playHow struct {
	// attach waits for the turn the user is starting rather than sending one at all. It is a resumed
	// run's first flow node: what somebody says in that chat *is* the flow node's turn.
	attach bool
	// resume sends the word that picks a cut-off turn back up rather than the description. It is a
	// flowNode coming out of a usage limit, whose conversation already holds everything the turn had
	// done when the limit closed under it.
	resume bool
}

// loop plays a flow node and then whatever that flow node names, until the chain runs out or
// something ends it.
//
// `attach` is a resumed run: the first flow node waits for the turn the user is starting instead of
// sending one of its own. Every flow node after it is played the ordinary way.
func (r *ChainRunner) loop(ctx context.Context, run *ChainRun, firstFlowNode, firstChat string, attach bool) {
	// Read once and closed at the end: a run that is restarted is handed a fresh one, and a defer
	// reading the field would close the new loop's channel instead of this one's.
	done := run.Done
	defer close(done)

	flowNodeID, chat := firstFlowNode, firstChat
	how := playHow{attach: attach}
	// How many times in a row the flow node under way has come back an error worth waiting out. The
	// count is the loop's rather than the flow node's: a flow node sent again is the same flow node,
	// and one that answers is the end of the run of failures whatever it was.
	tries := 0
	// What the chain has already played. A board is a thing people edit, and a chain that comes back
	// round to one of its own flow nodes is one that would never end.
	played := map[string]bool{}

	for {
		outcome, fault := r.playOne(ctx, run, flowNodeID, chat, how)
		how = playHow{}
		chat = outcome.Chat
		switch outcome.Round {
		case roundStop:
			// The run ends here holding this flow node. Where the round said what became of it — a
			// mark made, an error marked — this changes nothing; where it said nothing at all,
			// which is what a Stop and a board gone unreadable both leave, the flow node stops claiming
			// a play is on it. Before `done` is closed, so anything waiting on this run's loop
			// leaving finds a board it has finished writing.
			r.dropFlowNode(run, flowNodeID)
			r.end(run, r.stoppedReason(run))
			return
		case roundPowerOff:
			// The machine is on its way down: there is nobody left to play anything for, so this is
			// the end of the run whatever the board says after this card — which is nothing, a
			// Shutdown naming no flow node.
			r.powerOff(run, outcome.Title)
			return
		case roundSuspend:
			// A turn stopped from its chat suspends the run — unless Stop was pressed too, which is
			// somebody saying the run is over rather than that this turn is.
			if r.ended(run) {
				r.end(run, chainRunStopped)
				return
			}
			r.suspend(run, flowNodeID, chat)
			return
		case roundAgain:
			tries++
			if tries > r.RetryLimit {
				r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” was tried %d times and %s every time; the play stops here.",
					outcome.Title, r.RetryLimit+1, fault.Summary))
				r.fail(run, flowNodeID)
				r.end(run, "")
				return
			}
			state, at := ChainRunStateWaiting, time.Now().Add(r.RetryWait)
			if fault.Limit {
				// A limit says when it lifts, and that is what is waited for — hours of it, where the
				// window is the five-hour one. The card says so on the board rather than only in
				// this run, and what goes back in when the wait is over is not the flow node again.
				state, at = ChainRunStateRefreshing, r.RefreshAt(*fault, outcome.Agent)
				how = playHow{resume: true}
				r.hold(run, flowNodeID)
				r.say(run, runstate.NoticeWarning, fmt.Sprintf("%s: “%s” is held until it refreshes, and its turn is"+
					" picked back up at %s.", capitalise(fault.Summary), outcome.Title, said(at)))
			} else {
				r.say(run, runstate.NoticeWarning, fmt.Sprintf("%s: “%s” is played again at %s.",
					capitalise(fault.Summary), outcome.Title, said(at)))
			}
			if !r.waitToRetry(ctx, run, flowNodeID, chat, state, at, fault.Summary) {
				// Stopped, or abandoned: the wait was the run holding the flow node, so leaving it here is
				// leaving the flow node part-way, and the mark says so.
				r.dropFlowNode(run, flowNodeID)
				r.end(run, r.stoppedReason(run))
				return
			}
			continue
		}

		tries = 0
		played[flowNodeID] = true
		r.walked(run, flowNodeID)
		if r.stopping(run) {
			r.end(run, chainRunStopped)
			return
		}

		// What the flow node says comes after it, read off the board rather than off the copy this round
		// started with: a turn lasts minutes, and the chain may have been rewritten in the panel while
		// it ran.
		board, err := r.read(run.Handle)
		if err != nil {
			r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
			r.end(run, "")
			return
		}
		done := board.FlowNode(flowNodeID)
		if done == nil {
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is no longer on the board, so nothing says what"+
				" follows it; the chain run ends here.", outcome.Title))
			r.end(run, "")
			return
		}
		// The chat is shortened **here**, after the flow node it belongs to and before anything is taken
		// off it: it is that card's own conversation, and what the card says about it is said
		// whether or not a chain leaves it. The last flow node of a board shortens its chat exactly as
		// the first one does, and the fork below is then taken from the short one, which is the
		// whole of why a long chain costs less with the box ticked.
		if done.OnSuccess.Compact && done.IsAI() && chat != "" {
			r.setState(run, flowNodeID, chat, chainRunStateCompacting)
			if !r.compact(ctx, run, chat) {
				r.end(run, "")
				return
			}
		}
		// The chain has run out, which is the ordinary way a chain run finishes — and worth saying out
		// loud now that nobody is watching the board it finished on. It is also the one ending that
		// used to leave a run with nothing to show for itself.
		if done.OnSuccess.FlowNode == "" {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{Done: *done, Decision: ChainRunChainEnd})
			r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” played its last flow node, “%s”; the chain run is done.",
				r.nameOf(run), outcome.Title))
			r.end(run, "")
			return
		}
		next := board.FlowNode(done.OnSuccess.FlowNode)
		if next == nil || !next.Runnable() {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: done.OnSuccess.FlowNode, Decision: chainRunChainNextUnplayable,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” names a flow node after it that is not there to play;"+
				" the chain ends here.", outcome.Title))
			r.end(run, "")
			return
		}
		// An AI card saying nothing — no title, no description and no success criteria — has
		// nothing to send. The chain ends rather than spending a turn on an empty prompt. What the
		// other types do is not written in words, so none of them ever runs out.
		if !next.HasWork() {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				Decision: chainRunChainNextEmpty,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” has nothing to send; the chain ends here.",
				next.Title))
			r.end(run, "")
			return
		}
		// A card pinned to another runner is another machine's to play: the chain ends here rather
		// than running it where its folders are not.
		if refusal := r.RunnerRefusal(*next); refusal != "" {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				Decision: chainRunChainPinned,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” %s; the chain ends here.",
				next.Title, strings.TrimPrefix(refusal, "this flow node ")))
			r.end(run, "")
			return
		}
		if played[next.ID] {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				Decision: chainRunChainReplayed,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("The chain after “%s” comes back to a flow node it has already"+
				" played; it ends here.", outcome.Title))
			r.end(run, "")
			return
		}
		// A card is played by one run, and a chain walking into one another run is holding stops
		// rather than doubling it: two turns would mark the one flow node, and the second mark would be
		// written over the first. Two chains meeting is a board somebody drew that way, so it is
		// worth a sentence naming the chain run that got there first.
		if held := r.holderOf(run.Handle, next.ID); held != "" {
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				Holder: held, Decision: chainRunChainHeld,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("The flow node after “%s” is already being played by “%s”;"+
				" the chain ends here.", outcome.Title, held))
			r.end(run, "")
			return
		}
		// The chat is carried on only by a card that has one. A Scheduler and a Shutdown speak to
		// nobody, so a mode saying `continue` in front of one is honoured as far as it can be: the
		// chain carries on, and the conversation stops there.
		if done.OnSuccess.CarriesChat() && next.IsAI() && chat != "" {
			// A conversation is made for a folder and keeps it, so a flow node naming another cannot be
			// played in a fork of the chat it is being handed — a fork has the source's folder and
			// no other. Where a played turn writes is the one thing this board never decides for the
			// user, so it stops and says so rather than running the flow node somewhere it did not ask
			// for.
			if next.Settings.WorkFolder() != done.Settings.WorkFolder() {
				r.LogChain(run, flowNodeID, ChainRunChainDecision{
					Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
					From: chat, Decision: ChainRunChainFolderMismatch,
				})
				r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” runs in another folder than the chat it would follow"+
					" on from, which cannot change folder; the play stops here.", next.Title))
				r.end(run, "")
				return
			}
			// **A fork, and not the chat itself.** The copy carries the transcript and the CLI
			// session, so the next flow node starts remembering everything the chain has done — while the
			// card just played keeps a conversation that is its own and stops there. A chain used to
			// be one thread every card of it pointed at, where reading the fifth card's chat meant
			// reading all five and a stray message in it was a message in all five.
			targetAgent, err := r.ResolveAgent(*next)
			if err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				r.end(run, "")
				return
			}
			if reason := r.AgentRefusal(*next); reason != "" {
				r.say(run, runstate.NoticeError, reason)
				r.end(run, "")
				return
			}
			forked, err := r.forkChat(run, chat, next.Title, targetAgent)
			if err != nil {
				r.LogChain(run, flowNodeID, ChainRunChainDecision{
					Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
					From: chat, Decision: chainRunChainForkFailed,
				})
				r.say(run, runstate.NoticeError, fmt.Sprintf("The chat “%s” would follow on from could not be"+
					" forked, so the play stops here: %s", next.Title, err.Error()))
				r.end(run, "")
				return
			}
			from := chat
			chat = forked
			// How the next flow node knows which conversation it goes in — written down on it, not held in
			// this loop, so it is still true if the run is stopped and started again.
			if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, next.ID, chat) }); err != nil {
				r.LogChain(run, flowNodeID, ChainRunChainDecision{
					Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
					From: from, Forked: forked, Chat: forked, Decision: ChainRunChainForked,
				})
				r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
				r.end(run, "")
				return
			}
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				From: from, Forked: forked, Chat: forked, Decision: ChainRunChainForked,
			})
		} else {
			// The conversation ends with this flow node: what follows is played in a chat of its own —
			// whichever it already had, or one made for it. Unless the one it already had IS the
			// conversation just finished: a chain run before under `continue` writes it onto the
			// next card, and a mode flipped to `end` since does not take it back off. Playing the
			// next flow node there would send it into the very chat this flow node is ending, so nothing is
			// handed on and a fresh one is made for it instead.
			from := chat
			if next.Chat == chat {
				chat = ""
			} else {
				chat = next.Chat
			}
			r.LogChain(run, flowNodeID, ChainRunChainDecision{
				Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
				From: from, Chat: chat, Decision: chainRunChainOwnChat,
			})
		}
		flowNodeID = next.ID
	}
}

// powerOff ends the run and turns the machine off, which is what a **Shutdown** card is.
//
// **It is the end of the board**, and that is why the card names nothing after it: playing anything
// into a machine on its way down would be starting work to abandon it.
//
// The run is let go before the command is sent, and a moment is left between the two: what every
// open tab is about to lose is the service telling it things.
func (r *ChainRunner) powerOff(run *ChainRun, title string) {
	pkgBoards.LogChainRun.Info("the played card is a shutdown", "run", run.Id, "flowNode", title)
	r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” shuts the machine down; the play ends here.", title))
	r.end(run, "")
	time.Sleep(r.ShutdownGrace)
	if err := r.Shutdown(); err != nil {
		// The run is over either way — the board ends on this card — so this is only ever news, and
		// it is news worth having: a machine that stayed on because polkit refused says so rather
		// than being found on in the morning with nothing to explain it.
		pkgBoards.LogChainRun.Error("the machine could not be shut down", "run", run.Id, "error", err)
		r.say(run, runstate.NoticeError, "The machine could not be shut down: "+err.Error())
	}
}

// playOneOutcome is one round's result, beside the fault that explains a retry.
type PlayOneOutcome struct {
	Round round
	// chat is the conversation the flow node was played in — the one it had, or the one made for it,
	// which is what a flow node sent again after a failed turn goes back into.
	Chat string
	// title is the flow node as the board had it when the turn started, for the sentences said about
	// it.
	Title string
	// agent is the engine the flow node ran on, as the card's agent resolved to it. It rides along
	// because a fault is read and *said* in that engine's name — and because a limit's own clock
	// is that account's, so the wait is asked of it (see refreshAt).
	Agent string
}

// playOne plays one flow node to its end and marks it, reporting what the loop is to do next.
//
// **What playing means is the card's type.** An AI card is a turn, which is what the rest of this
// function is about; a Shutdown, a Scheduler and a Gateway are the run acting on its own machine,
// and each is over in a few lines below. All four come through here because all four are *a card
// being played*: marked taken, marked done, and the chain followed from what they leave.
//
// `how` is the round that is not an ordinary one: a resumed run attaching to the turn the user is
// starting, or a flow node coming back from a usage limit, which is sent the word that picks its
// cut-off turn back up instead of its description.
//
// `chat` is the conversation to play it in — its own, or the one the flow node before it handed on.
// Empty asks for one to be made, whose id is written into the flow node the moment it exists rather
// than when the turn ends: a flow node running for ten minutes is ten minutes of somebody wanting
// to see what it is doing.
//
// A flow node states its own effort and permission mode whatever chat it lands in — they are the
// turn's, and this service takes them per turn. The engine, the model and the standing instructions
// are fixed by the conversation's published agent version. Its folder is the conversation's, and is
// only ever asked of a conversation being made.
func (r *ChainRunner) playOne(ctx context.Context, run *ChainRun, flowNodeID, chat string, how playHow) (PlayOneOutcome, *agentfaults.TurnFault) {
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil {
		r.say(run, runstate.NoticeError, "The flow node being played is no longer on the board; the play stops here.")
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	// A resume is a word said into a conversation that is already there and already holds the work it
	// picks back up. A flow node naming none is played as it stands — nothing a usage limit leaves
	// behind looks like that, but a board is edited under a run, and a chat can be cleared off a card
	// while its flow node is being waited on.
	if chat == "" {
		how.resume = false
	}

	if flowNode.RunsItself() {
		return r.playToItself(ctx, run, *flowNode, PlayOneOutcome{Chat: chat, Title: flowNode.Title})
	}

	// What the card's agent names, resolved before anything is marked: a card whose agent is gone
	// — or was never one — ends the chain unmarked, the way a chain reaching a card nobody can
	// play ends it, rather than as a turn that ran and failed.
	resolving := *flowNode
	resolving.Chat = chat
	resolved, err := r.ResolveAgent(resolving)
	if err != nil {
		r.say(run, runstate.NoticeError, "“"+flowNode.Title+"” cannot be played: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if resolved.Platform == agentapi.AgentPi && r.Hub != nil && chat == "" {
		target, err := r.Hub.AgentRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		resolved.profileID, resolved.Model = target.Profile.ID, target.Provider+"/"+target.ModelID
	}
	if chat != "" && resolved.Snapshot != nil {
		source, err := r.convs.Get(chat)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		if source.AgentVersion == nil {
			forked, err := r.forkChat(run, chat, flowNode.Title, resolved)
			if err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
			}
			if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNodeID, forked) }); err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
			}
			chat = forked
		}
	}
	out := PlayOneOutcome{Chat: chat, Title: flowNode.Title, Agent: resolved.Platform}

	r.setState(run, flowNodeID, chat, ChainRunStatePlaying)
	// The flow node is the run's from here, and the board says so: a run is minutes to hours long,
	// and the spinner the board draws over the card is the view of whoever started it — a tab that was
	// closed, a second machine, tomorrow morning have nothing but the mark. It also settles what a
	// flowNode played again says, whatever the last play made of it: being worked on now, rather than
	// yesterday's error under a spinner.
	take := func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, flowNodeID, run.Id) }
	if how.resume {
		// The same play coming back to the same flow node: it is marked as being worked on again.
		take = func() (*pkgBoards.BoardContent, error) { return r.Boards.Reopen(run.Handle, flowNodeID, run.Id) }
	}
	if err := r.mark(run, take); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	if chat == "" {
		made, err := r.ConversationFor(run, *flowNode, resolved)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("A conversation could not be made for “%s”: %s", flowNode.Title, err.Error()))
			return PlayOneOutcome{Round: roundStop}, nil
		}
		chat, out.Chat = made, made
		// Before the prompt: the user is meant to be able to open what a running flow node is doing, and
		// a turn that then runs for ten minutes is ten minutes of the card having nowhere to point.
		if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNodeID, made) }); err != nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		r.setState(run, flowNodeID, chat, ChainRunStatePlaying)
	}

	if meta, err := r.convs.Get(chat); err == nil && meta.AgentVersion != nil {
		resolved = publishedPlayAgent(meta.AgentVersion)
		resolved.Model, resolved.profileID = meta.AgentVersion.ConversationModel(meta.Model), meta.ProfileID
		out.Agent = resolved.Platform
	}

	// What the turn is sent, and what it is sent with. A resumed one is sent neither the description
	// nor its pictures: the conversation was given both when the play took the flow node, and it still
	// holds them along with everything the cut-off turn had made of them.
	prompt, images := ChainRunResumePrompt, []agentapi.PromptFile(nil)
	if !how.resume {
		prompt, images = pkgBoards.FlowNodePrompt(*flowNode), r.ImagesOf(run, *flowNode)
	}
	reply, refusal, stopped := r.turn(ctx, run, chat, turns.TurnRequest{
		ConversationID: chat,
		Prompt:         prompt,
		// All of it stated, nothing left to the deployment: there is nobody at the keyboard. The
		// effort and the mode are the flow node's own, a flow node missing either being one no run ever
		// reaches; the model and the standing instructions are its agent's, resolved above. The
		// play itself travels too, so the turn's records name the card back.
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Instructions:   resolved.Instructions,
		ManagedAgent:   resolved.Name,
		AgentRef:       resolved.Id,
		RunID:          run.Id,
		FlowNodeID:     flowNode.ID,
		Board:          run.Handle,
		Images:         images,
	}, how.attach)
	if ctx.Err() != nil {
		// Stopped by a run replacing this one, which has already said what it is doing.
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	// What came back may be no answer at all: a prompt this service refused, or an error the CLI wrote
	// where the answer would have gone — at the head of the reply, or at the foot of an hour of work.
	// Either way the flow node was not finished, so it is not marked done; the only question left is
	// whether waiting is worth anything.
	//
	// A turn somebody *stopped* is none of that, whatever it came back with — `API Error: Request was
	// aborted.` is how the CLI words an interruption — so it is not a fault at all: the flow node is
	// marked interrupted rather than done, because it was worked on but not finished, and the run
	// stops because somebody said so.
	var fault *agentfaults.TurnFault
	if !stopped {
		if refusal != nil {
			fault = agentfaults.RefusalFault(refusal.Code)
		} else {
			fault = agentfaults.ReplyFault(reply, r.agentLabel(out.Agent))
		}
	}
	promptKind := ChainRunPromptCard
	if how.attach {
		promptKind = chainRunPromptAttach
	} else if how.resume {
		promptKind = chainRunPromptResume
	}
	r.LogTurn(run, flowNodeID, chat, ChainRunTurnOutcome{
		Prompt: promptKind, Agent: out.Agent, Model: resolved.Model,
		Effort: flowNode.Settings.Effort, Permission: flowNode.Settings.Permission,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: fault,
	})
	// A turn blocked twice — stopped and resumed once by its driver, then blocked again — is
	// neither an error to mark nor one to wait out: the conversation is forked and the flow
	// node is played again from the fork. A blocked turn is silent, so the fork carries the
	// transcript as it stood at the first relaunch, and whatever the forked turn answers
	// decides the flow node like any other turn.
	if !stopped && refusal == nil && reply.Failure == agentfaults.MuseBlockedTwiceMessage {
		return r.PlayBlockedFork(ctx, run, *flowNode, out, resolved, chat)
	}
	if fault != nil && fault.Retry {
		out.Round = roundAgain
		return out, fault
	}
	if refusal != nil && !stopped {
		// No turn ran, so the flow node has not been worked on. Whatever follows it would meet the same
		// refusal.
		r.say(run, runstate.NoticeError, fmt.Sprintf("Claude did not take “%s”: %s", flowNode.Title, refusal.Message))
		r.fail(run, flowNodeID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if fault != nil {
		// A turn ran and ended in an error nothing but the user can clear.
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” came back an error — %s — and is marked as one.",
			flowNode.Title, fault.Summary))
		r.fail(run, flowNodeID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	status := pkgBoards.FlowNodeStatusDone
	if stopped {
		status = pkgBoards.FlowNodeStatusInterrupted
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNodeID, run.Id, status)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if stopped {
		out.Round = roundSuspend
		return out, nil
	}
	out.Round = RoundOn
	return out, nil
}

// chainRunBlockedForkPrompt is what a flow node blocked twice is sent in its forked
// conversation. The fork carries the transcript — the description, the partial work, both
// blockages — so this sentence is the whole of the prompt: take the conversation over and
// finish what was asked.
const ChainRunBlockedForkPrompt = "After two blockages, I forked this conversation. Please take it over and go through to the end of what was requested."

// playBlockedFork plays a flow node whose turn blocked twice: the conversation is forked and
// the flow node goes back in there, under the fork prompt rather than its description. The
// run carries on from whatever the forked turn answers — done goes on to the next flow node
// like any other answer — so a double blockage delays the chain rather than stopping it. A
// forked turn blocking twice in its turn is not forked again: it is marked as the error it
// is, and the play stops there.
func (r *ChainRunner) PlayBlockedFork(ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome, resolved PlayAgent, chat string) (PlayOneOutcome, *agentfaults.TurnFault) {
	r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” was blocked twice; the conversation is forked and played again from the fork.", flowNode.Title))
	forked, err := r.forkChat(run, chat, flowNode.Title)
	if err != nil {
		r.say(run, runstate.NoticeError, "The conversation could not be forked, so the play stops here: "+err.Error())
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	r.LogNote(run, flowNode.ID, forked, "", "chat forked "+chat+" -> "+forked)
	// The card points at the fork from here: ten minutes of a resumed turn is ten minutes of
	// somebody wanting to open what it is doing.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNode.ID, forked) }); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	out.Chat = forked
	r.setState(run, flowNode.ID, forked, ChainRunStatePlaying)
	reply, refusal, stopped := r.turn(ctx, run, forked, turns.TurnRequest{
		ConversationID: forked,
		Prompt:         ChainRunBlockedForkPrompt,
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Instructions:   resolved.Instructions,
		ManagedAgent:   resolved.Name,
		AgentRef:       resolved.Id,
		RunID:          run.Id,
		FlowNodeID:     flowNode.ID,
		Board:          run.Handle,
	}, false)
	if ctx.Err() != nil {
		// Stopped by a run replacing this one, which has already said what it is doing.
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	var fault *agentfaults.TurnFault
	if !stopped {
		if refusal != nil {
			fault = agentfaults.RefusalFault(refusal.Code)
		} else {
			fault = agentfaults.ReplyFault(reply, r.agentLabel(out.Agent))
		}
	}
	r.LogTurn(run, flowNode.ID, forked, ChainRunTurnOutcome{
		Prompt: chainRunPromptBlockedFork, Agent: out.Agent, Model: resolved.Model,
		Effort: flowNode.Settings.Effort, Permission: flowNode.Settings.Permission,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: fault,
	})
	if fault != nil && fault.Retry {
		out.Round = roundAgain
		return out, fault
	}
	if refusal != nil && !stopped {
		r.say(run, runstate.NoticeError, fmt.Sprintf("Claude did not take “%s”: %s", flowNode.Title, refusal.Message))
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	if fault != nil {
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” came back an error — %s — and is marked as one.",
			flowNode.Title, fault.Summary))
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	status := pkgBoards.FlowNodeStatusDone
	if stopped {
		status = pkgBoards.FlowNodeStatusInterrupted
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, status)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	if stopped {
		out.Round = roundSuspend
		return out, nil
	}
	out.Round = RoundOn
	return out, nil
}

// playToItself plays a card that speaks to nobody: a **Shutdown**, which turns the machine off, a
// **Scheduler**, which waits for a duration or datetime and then lets the chain carry on, or a **Gateway**,
// which waits for every branch feeding into it and then starts every branch leaving it.
//
// All three are marked the way a turn's flow node is — taken while the run holds them, and one of
// the endings when it lets go — because that is what the board is for: read tomorrow morning, a
// card that ran says so, and a card that could not says why.
func (r *ChainRunner) playToItself(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *agentfaults.TurnFault) {
	if flowNode.Type == pkgBoards.FlowNodeTypeGateway {
		// A Gateway is claimed only once every branch feeding into it is done — which is decided
		// off a fresh board, inside, rather than here.
		return r.playGateway(run, flowNode, out)
	}
	state := ChainRunStatePlaying
	if flowNode.Type == pkgBoards.FlowNodeTypeScheduler {
		state = ChainRunStateScheduled
	}
	r.setState(run, flowNode.ID, out.Chat, state)
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, flowNode.ID, run.Id) }); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}

	if flowNode.Type == pkgBoards.FlowNodeTypeScheduler {
		return r.playSchedule(ctx, run, flowNode, out)
	}
	return r.playShutdown(run, flowNode, out)
}

// playShutdown is the Shutdown card: the machine goes off, and the run ends with it.
//
// **Whether it can be honoured is a matter of how KIAO was started**, and of nothing else — see
// shutdown.go. Where it cannot, the card is marked `error`: the board asked for something that did
// not happen, and a card left saying `done` over a machine still running would be the play claiming
// otherwise. The play stops there either way, a Shutdown naming nothing after it.
func (r *ChainRunner) playShutdown(
	run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *agentfaults.TurnFault) {
	if r.Shutdown == nil {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” asks for the machine to be shut down, and this"+
			" deployment cannot; the play stops here.", flowNode.Title))
		r.fail(run, flowNode.ID)
		out.Round = roundStop
		return out, nil
	}
	// Marked before the command goes out, and it is the last thing written: this process does not
	// live to see the machine go down, so a mark left for afterwards is a mark never made.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, pkgBoards.FlowNodeStatusDone)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	out.Round = roundPowerOff
	return out, nil
}

// playSchedule is the Scheduler card: it holds until the moment written on it, and then the chain
// carries on from it.
//
// **A datetime already past does not wait.** A schedule is a floor under the next flow node, not a
// claim that the board was running at the time — a chain started in the morning on a card that said
// last night goes straight through it.
//
// The wait ends early for the same two things every other wait here ends early for: Stop, which is
// the run being over, and a run replacing this one. Neither is the card having done what it was
// for, so the mark says the card was left part-way.
func (r *ChainRunner) playSchedule(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *agentfaults.TurnFault) {
	when, ok := flowNode.ScheduledAt()
	if !ok {
		// A card the board would not have offered a Play on, reached through a chain that named it
		// before its datetime was answered.
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” names no duration or datetime to wait for; the play stops here.",
			flowNode.Title))
		r.fail(run, flowNode.ID)
		out.Round = roundStop
		return out, nil
	}
	if wait := time.Until(when); wait > 0 {
		pkgBoards.LogChainRun.Info("the play is holding for a scheduled flow node",
			"run", run.Id, "flowNode", flowNode.ID, "until", when)
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” is waiting until %s.", flowNode.Title, when.Format("2 Jan 15:04")))
		r.LogWait(run, flowNode.ID, out.Chat, ChainRunStateScheduled, when, "")
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-run.waking():
		case <-ctx.Done():
		}
		if r.stopping(run) || ctx.Err() != nil {
			// The wait was the run holding the card, so leaving it here is leaving it part-way.
			out.Round = roundStop
			return out, nil
		}
	} else {
		r.LogNote(run, flowNode.ID, out.Chat, "", "the scheduled moment is past; carrying on")
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, pkgBoards.FlowNodeStatusDone)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	out.Round = RoundOn
	return out, nil
}

// playGateway is the Gateway card: it fires once every branch feeding into it is done, and
// firing it starts every branch leaving it — in parallel, each as a run of its own. The run that
// fired it ends there: a forked branch is an independent play, stopped and restarted on its own.
//
// The join is last-arrival rather than a wait. A branch arriving to find the others not yet done
// leaves the Gateway untouched and ends there, and the branch finding them all done fires it.
// Nothing polls and nothing is held meanwhile, so a Gateway fed by branches played by hand simply
// fires when the last of them is marked done — and two branches finishing at the same instant are
// settled by the claim, which lets exactly one of them through.
func (r *ChainRunner) playGateway(
	run *ChainRun, gateway pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *agentfaults.TurnFault) {
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	at := board.FlowNode(gateway.ID)
	if at == nil {
		r.say(run, runstate.NoticeError, "The gateway is no longer on the board; the play stops here.")
		out.Round = roundStop
		return out, nil
	}
	if waiting := waitingBranches(board, *at); len(waiting) > 0 {
		r.LogChain(run, at.ID, ChainRunChainDecision{Done: *at, Decision: chainRunChainGatewayWaiting})
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” waits for %s; this branch ends here.",
			at.Title, strings.Join(waiting, ", ")))
		out.Round = roundStop
		return out, nil
	}
	if at.Status == pkgBoards.FlowNodeStatusDone {
		// Fired already — branches played again after the Gateway went through. There is nothing
		// to fire a second time.
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” already fired; this branch ends here.", at.Title))
		out.Round = roundStop
		return out, nil
	}
	// No holder check before the claim: this run may itself be standing on the Gateway — a
	// direct Play starts on it — and the claim below is what settles two branches firing together
	// anyway, letting exactly one of them through.
	r.setState(run, at.ID, "", ChainRunStatePlaying)
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, at.ID, run.Id) }); err != nil {
		var refused *httpkit.HTTPError
		if errors.As(err, &refused) && refused.Status == http.StatusConflict {
			// The race the claim exists for: two branches finished together, and the other play
			// fired the Gateway first.
			r.LogChain(run, at.ID, ChainRunChainDecision{Done: *at, Decision: chainRunChainHeld})
			r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” was fired by another play; this branch ends here.",
				at.Title))
		} else {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		}
		out.Round = roundStop
		return out, nil
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, at.ID, run.Id, pkgBoards.FlowNodeStatusDone)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	r.walked(run, at.ID)

	// The branches, read off the board as it stands after the firing: a chain is edited under a
	// run like everything else on one.
	board, err = r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	fired := board.FlowNode(at.ID)
	if fired == nil {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” fired and left the board; the play ends here.",
			out.Title))
		out.Round = roundStop
		return out, nil
	}
	r.forkBranches(run, board, *fired)
	out.Round = roundStop
	return out, nil
}

// waitingBranches is what a Gateway is still waiting for: the branches feeding into it that are
// not done, by title. Empty is a Gateway ready to fire — every branch done, or none at all.
func waitingBranches(board *pkgBoards.BoardContent, gateway pkgBoards.FlowNode) []string {
	var waiting []string
	for _, pred := range board.PredecessorsOf(gateway.ID) {
		if pred.Status != pkgBoards.FlowNodeStatusDone {
			waiting = append(waiting, "“"+pred.Title+"”")
		}
	}
	return waiting
}

// forkBranches starts every branch leaving a fired Gateway, each as a run of its own. Each branch
// is asked the same questions a chain asks before stepping onto its next card — there to play,
// something to send, pinned here, not already behind this play, held by nobody — and one that
// answers no is skipped with its sentence rather than stopping the others.
func (r *ChainRunner) forkBranches(run *ChainRun, board *pkgBoards.BoardContent, gateway pkgBoards.FlowNode) {
	behind := map[string]bool{}
	r.Mu.Lock()
	for _, id := range run.trail {
		behind[id] = true
	}
	r.Mu.Unlock()

	var started []string
	branches := board.SuccessorsOf(gateway)
	for _, next := range branches {
		branch := next
		switch {
		case !branch.Runnable():
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainNextUnplayable,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” cannot be played as it stands;"+
				" no branch starts there.", branch.Title))
			continue
		case !branch.HasWork():
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainNextEmpty,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” has nothing to send;"+
				" no branch starts there.", branch.Title))
			continue
		case behind[branch.ID]:
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainReplayed,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is already behind this play;"+
				" no branch starts there.", branch.Title))
			continue
		}
		if refusal := r.RunnerRefusal(branch); refusal != "" {
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainPinned,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” %s; no branch starts there.",
				branch.Title, strings.TrimPrefix(refusal, "this flow node ")))
			continue
		}
		if held := r.holderOf(run.Handle, branch.ID); held != "" {
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Holder: held, Decision: chainRunChainHeld,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is already being played by “%s”;"+
				" no branch starts there.", branch.Title, held))
			continue
		}
		// A card a run died holding is taken back first, so the branch meets a free card rather
		// than the run that is gone.
		freed, err := r.reclaim(run.Handle, board, branch.ID)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not be freed for its branch: %s",
				branch.Title, err.Error()))
			continue
		}
		board = freed
		if at := board.FlowNode(branch.ID); at != nil {
			branch = *at
		}
		r.LogChain(run, gateway.ID, ChainRunChainDecision{
			Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
			Chat: branch.Chat, Decision: chainRunChainGatewayForked,
		})
		r.forkRun(run, board, branch.ID)
		started = append(started, "“"+branch.Title+"”")
	}
	switch {
	case len(branches) == 0:
		r.LogChain(run, gateway.ID, ChainRunChainDecision{Done: gateway, Decision: ChainRunChainEnd})
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired its last flow node, “%s”; the play is done.",
			r.nameOf(run), gateway.Title))
	case len(started) == 0:
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” fired, and no branch started.", gateway.Title))
	case len(started) == 1:
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired one branch: %s.", gateway.Title, started[0]))
	default:
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired %d branches: %s.",
			gateway.Title, len(started), strings.Join(started, ", ")))
	}
}

// forkRun starts one branch leaving a fired Gateway as a run of its own: the same board, the same
// owner, a name saying which play it branched from — and the trail behind it, so a branch looping
// back onto a card its play has already fired ends instead of forking for ever.
func (r *ChainRunner) forkRun(parent *ChainRun, board *pkgBoards.BoardContent, startID string) {
	r.Mu.Lock()
	trail := append([]string(nil), parent.trail...)
	name, owner := parent.Name, parent.Owner
	chat := ""
	if at := board.FlowNode(startID); at != nil {
		chat = at.Chat
	}
	child := &ChainRun{
		Id:             "run-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4],
		Name:           name + " / " + startTitle(board, startID),
		Handle:         parent.Handle,
		Owner:          owner,
		RootFlowNodeID: startID,
		FlowNodeID:     startID,
		Chat:           chat,
		trail:          trail,
		State:          ChainRunStatePlaying,
		startedAt:      time.Now(),
		Done:           make(chan struct{}),
		wake:           make(chan struct{}),
	}
	ctx := r.startLocked(child, board)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("branch started", "run", child.Id, "name", child.Name,
		"board", child.Handle, "flowNode", startID, "chat", chat)
	r.runLogs.Create(child.Id, child.Name, child.Handle, startID, owner.User, child.startedAt)
	r.announce(nil)
	go r.loop(ctx, child, startID, chat, false)
}

// startTitle is what a forked branch is named after: the card it starts on, or the id where the
// card has no title to give.
func startTitle(board *pkgBoards.BoardContent, startID string) string {
	if at := board.FlowNode(startID); at != nil && strings.TrimSpace(at.Title) != "" {
		return strings.TrimSpace(at.Title)
	}
	return startID
}

// imagesOf is the images a flow node hands its turn: the files of the store its body links,
// resolved from the store root (flow_node_images.go).
//
// A link naming nothing is said out loud and nothing more. A dead image is a mistake in a card
// somebody is still writing — a file renamed, a flow node pasted in from another store — and it is
// not worth stopping an hour of work over: the flow node is played as it stands, and the user is
// told which picture the turn was never given.
func (r *ChainRunner) ImagesOf(run *ChainRun, flowNode pkgBoards.FlowNode) []agentapi.PromptFile {
	images, missing, dropped := pkgBoards.FlowNodeImages(r.cfg.RootPath, flowNode.Body)
	if len(missing) == 1 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links an image the store does not hold, so the turn was "+
			"not given it: %s", flowNode.Title, missing[0]))
	} else if len(missing) > 1 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links %d images the store does not hold, so the turn was "+
			"not given them: %s", flowNode.Title, len(missing), strings.Join(missing, ", ")))
	}
	if dropped > 0 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links %d images; the turn was given the first %d.",
			flowNode.Title, len(images)+dropped, pkgBoards.MaxFlowNodeImages))
	}
	return images
}

// turn sends one prompt and waits for the turn to end, or attaches to the one already running.
//
// It reports the reply as the transcript holds it, the refusal where no turn ever ran, and whether
// the turn was *stopped* rather than finished. A turn killed mid-sentence is often recorded as
// having said nothing at all: the CLI does not hand over a message it never finished, and inventing
// one here would put words in the model's mouth.
func (r *ChainRunner) turn(ctx context.Context, run *ChainRun, chat string, req turns.TurnRequest, attach bool) (reply agentfaults.TurnReply, refusal *agentfaults.TurnRefusal, stopped bool) {
	var job *turns.Turn
	if attach && chat != "" {
		job = r.awaitTurnStart(ctx, chat)
		if ctx.Err() == nil {
			if job != nil {
				r.LogNote(run, req.FlowNodeID, chat, "", "joined the turn started in this chat")
			} else {
				r.LogNote(run, req.FlowNodeID, chat, "", "no turn started in time; the flow node is played as written")
			}
		}
	}
	if job == nil {
		if ctx.Err() != nil {
			return agentfaults.TurnReply{}, nil, false
		}
		job, refusal = r.Hub.ExecuteTurn(run.Owner, req)
		if refusal != nil {
			return agentfaults.TurnReply{}, refusal, false
		}
	}

	select {
	case <-job.Settled:
		// The turn is over and its bill is final: filed on the card it ran for, where there
		// is one. Handed off, not awaited — the filing queues and returns, so the play loop
		// never waits on the network for it.
		r.ReportTurnUsage(job)
	case <-ctx.Done():
		return agentfaults.TurnReply{}, nil, false
	}

	interrupted, failure := job.Outcome()
	if failure != "" {
		// The turn was recorded and then never got off the ground. It is a refusal as far as the run
		// is concerned: nothing ran, and nothing waits for it.
		return agentfaults.TurnReply{}, &agentfaults.TurnRefusal{Code: turnevents.ErrCodeSpawnFailed, Message: failure}, false
	}
	// The transcript holds what the turn *said*; the job holds what it reported going wrong, which is
	// where `codex exec` puts an error and where the transcript therefore has nothing. Both readings
	// travel, and replyFault decides which of them is the turn's story.
	said := r.lastReply(chat)
	said.Failure = job.LastFailure()
	return said, nil, interrupted
}

// awaitTurnStart waits for a turn to start in a conversation, for as long as a resumed run gives
// the message it is expecting. Nil when none came, which is what makes the run play its flow node
// itself.
func (r *ChainRunner) awaitTurnStart(ctx context.Context, chat string) *turns.Turn {
	deadline := time.Now().Add(r.ResumeWindow)
	for {
		if job := r.Hub.RunningTurn(chat); job != nil {
			job.Mu.Lock()
			live := !job.IsDone
			job.Mu.Unlock()
			if live {
				return job
			}
		}
		if time.Now().After(deadline) {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// lastReply is what the turn said, as the transcript holds it: the last assistant record of the
// conversation, which is the record the turn wrote when it settled — every settled turn writes one,
// blocks or none, so this is always *this* turn’s and never the one before it.
func (r *ChainRunner) lastReply(chat string) agentfaults.TurnReply {
	records, err := r.convs.Messages(chat)
	if err != nil {
		pkgBoards.LogChainRun.Warn("cannot read back the reply", "conversation", chat, "error", err)
		return agentfaults.TurnReply{}
	}
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].Role == conversations.RoleAssistant {
			return agentfaults.TurnReply{
				Text:     records[i].BlockText(),
				Tail:     records[i].BlockTail(),
				ExitCode: records[i].ExitCode,
			}
		}
	}
	return agentfaults.TurnReply{}
}

// compact shortens the chat a flow node was played in, once that flow node is done: `/compact`,
// sent as a prompt, which is exactly what typing it into the chat's own box does.
//
// False is the end of the run, and it has said why. A compaction that came back an error is not
// waited out and tried again the way a flow node is: the card asked for a shorter chat when it was
// over, and carrying on — forking that chat for the next flow node, or leaving it as the record of
// this one — is doing something other than what was asked.
func (r *ChainRunner) compact(ctx context.Context, run *ChainRun, chat string) bool {
	flowNodeID := run.FlowNodeID
	reply, refusal, stopped := r.turn(ctx, run, chat, turns.TurnRequest{
		ConversationID: chat, Prompt: briefing.ChainRunCompactCommand,
		RunID: run.Id, FlowNodeID: flowNodeID, Board: run.Handle,
	}, false)
	if ctx.Err() != nil {
		return false
	}
	agent := ""
	if r.convs != nil {
		if meta, err := r.convs.Get(chat); err == nil {
			agent = meta.Agent
		}
	}
	var fault *agentfaults.TurnFault
	if refusal == nil && !stopped {
		fault = agentfaults.ReplyFault(reply, r.chatAgentLabel(chat))
	}
	r.LogTurn(run, flowNodeID, chat, ChainRunTurnOutcome{
		Prompt: ChainRunPromptCompact, Agent: agent,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: fault,
	})
	if refusal != nil {
		r.say(run, runstate.NoticeError, "The chat could not be shortened: "+refusal.Message)
		return false
	}
	if stopped {
		r.say(run, runstate.NoticeInfo, "The compaction was stopped, so the play stops with it.")
		return false
	}
	if fault != nil {
		r.say(run, runstate.NoticeError, "The chat could not be shortened — "+fault.Summary+" — and the play stops here.")
		return false
	}
	return !r.stopping(run)
}

// waitToRetry waits until `at` before the flow node goes back in, reporting itself as `state`
// meanwhile — the twenty minutes an error that passes is given, or the hours a usage limit names
// for itself. False when the wait was cut short — Stop, or the run being abandoned — which is the
// end of the run rather than the start of another try.
func (r *ChainRunner) waitToRetry(ctx context.Context, run *ChainRun, flowNodeID, chat, state string, at time.Time, reason string) bool {
	r.Mu.Lock()
	moved := !run.gone
	if moved {
		run.FlowNodeID, run.Chat = flowNodeID, chat
		run.State = state
		run.retryAt = at
		markChain(run)
	}
	r.Mu.Unlock()
	if moved {
		r.LogState(run, flowNodeID, chat, state)
		r.LogWait(run, flowNodeID, chat, state, at, reason)
	}
	r.announce(nil)

	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-run.waking():
	case <-ctx.Done():
	}
	return !r.stopping(run) && ctx.Err() == nil
}

// Prefer the provider's reset, then account quota, then retryWait. Resets get refreshLeeway,
// including instants that elapsed while the turn settled.
func (r *ChainRunner) RefreshAt(fault agentfaults.TurnFault, agent string) time.Time {
	now := time.Now()
	if !fault.ResetAt.IsZero() {
		if fault.ResetAt.Before(now) {
			return now.Add(r.RefreshLeeway)
		}
		return fault.ResetAt.Add(r.RefreshLeeway)
	}
	if at, known := r.QuotaResetAt(agent); known {
		return at.Add(r.RefreshLeeway)
	}
	return time.Now().Add(r.RetryWait)
}

// Rolling quotas can read slightly below full by the time a refusal is processed.
const quotaSpentPercent = 95

// Every exhausted window must reopen before a turn can run. Near-full windows are only a fallback
// when none reports exhaustion; an almost-full weekly window must not delay a spent short one.
func (r *ChainRunner) QuotaResetAt(agent string) (time.Time, bool) {
	if r.Hub == nil {
		return time.Time{}, false
	}
	port := r.Hub.AgentRegistry().UsageFor(agent)
	if port == nil {
		return time.Time{}, false
	}
	usage, err := port.Usage()
	if err != nil {
		pkgBoards.LogChainRun.Warn("cannot read the account's limits to know when they lift",
			"agent", agent, "error", err)
		return time.Time{}, false
	}
	now := time.Now()
	var exhausted, nearFull time.Time
	for _, window := range usage.Windows {
		if window.PercentUsed < quotaSpentPercent || window.ResetAtEpochSeconds <= 0 {
			continue
		}
		at := time.Unix(window.ResetAtEpochSeconds, 0)
		if !at.After(now) || at.Sub(now) > agentfaults.RefreshCeiling {
			continue
		}
		if window.PercentUsed >= 100 {
			if exhausted.IsZero() || at.After(exhausted) {
				exhausted = at
			}
		} else if nearFull.IsZero() || at.Before(nearFull) {
			nearFull = at
		}
	}
	if !exhausted.IsZero() {
		return exhausted, true
	}
	return nearFull, !nearFull.IsZero()
}

// agentLabel is what to call an agent in a sentence said about a flow node — the registry's label,
// or the bare name on a service assembled without one. It is a method rather than a reach into the
// hub at every call site because a fault is read in three places and must read the same in all of
// them.
func (r *ChainRunner) agentLabel(agent string) string {
	if r.Hub == nil || r.Hub.AgentRegistry() == nil {
		return protocol.OrDefault(agent, "the agent")
	}
	// A card that names no agent is one no run reaches — a flow node missing any of its five settings
	// is not playable — but a summary is a sentence shown to somebody, and " is overloaded" is not
	// one.
	if strings.TrimSpace(agent) == "" {
		agent = r.Hub.AgentRegistry().DefaultName()
	}
	return protocol.OrDefault(r.Hub.AgentRegistry().Label(agent), "the agent")
}

// chatAgentLabel is the same for a turn that has a conversation rather than a card behind it: the
// compaction, which is played into a chat and belongs to whatever engine that chat runs on.
func (r *ChainRunner) chatAgentLabel(chat string) string {
	if r.convs == nil || chat == "" {
		return r.agentLabel("")
	}
	meta, err := r.convs.Get(chat)
	if err != nil {
		return r.agentLabel("")
	}
	return r.agentLabel(meta.Agent)
}

// hold marks the flow node the run is holding until the agent's usage limit lifts.
//
// A mark that could not be written is said in the log and nowhere else. The wait is the substance
// of this and the mark is what the board says about it, so a board that has gone unreadable is
// not worth ending a run over here: the round after the wait reads it again, and stops there with a
// sentence about the board rather than about the limit.
func (r *ChainRunner) hold(run *ChainRun, flowNodeID string) {
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Hold(run.Handle, flowNodeID, run.Id) }); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the held card could not be marked: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the held flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

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

// stoppedReason is what an ending says where the round said nothing: Stop having been pressed, or —
// for the endings this covers that are not a Stop — whatever the run last said, which is what ""
// asks for.
func (r *ChainRunner) stoppedReason(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	if run.ended {
		return chainRunStopped
	}
	return ""
}

// nameOf is what the run is called, for a sentence about the run rather than about a card.
func (r *ChainRunner) nameOf(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.Name
}

// chatOf is the chat the run reports itself in, for a note filed where no chat is at hand.
func (r *ChainRunner) chatOf(run *ChainRun) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.Chat
}

// walked records a flow node the run has finished with, which is what the panel draws behind it and
// what tells a card it has played from one it is heading for.
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

// holderOf is the name of the live run playing this flow node of this board, or "" — the question a
// chain asks before stepping onto its next card.
func (r *ChainRunner) holderOf(handle, flowNodeID string) string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	if held := r.holder(handle, flowNodeID); held != nil {
		return held.Name
	}
	return ""
}

// stopping reports whether the run is to end after the round it is in, or has been abandoned.
func (r *ChainRunner) stopping(run *ChainRun) bool {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.gone || run.stopping
}

// ended reports whether Stop was pressed, which is the one way a run is over rather than kept.
func (r *ChainRunner) ended(run *ChainRun) bool {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	return run.gone || run.ended
}

// fail marks a flow node whose turn came back an error, reporting nothing: it is the last thing a
// losing round does, and a board that could not be written has already been said out loud by
// whatever tried before it.
func (r *ChainRunner) fail(run *ChainRun, flowNodeID string) {
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		// What the turn said before it failed is in its conversation, which the card names and
		// opens. The description stays, so the card still asks what it was asking.
		return r.Boards.Finish(run.Handle, flowNodeID, run.Id, pkgBoards.FlowNodeStatusError)
	}); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the card could not be marked failed: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

// dropFlowNode marks the flow node a run was holding when it ended without finishing it.
//
// **Only a flow node still marked as being worked on is touched.** A round that answered its flow
// node, failed it or gave up on it has already said what became of it, and the mark on a done flow
// node is not to be contradicted by the run's last act. What is left is the endings that say
// nothing at all — and none of those is a failure of the flow node's, so none of them is an error:
// somebody stopped the run, or started another, or the board went unreadable under it.
//
// A **suspended** run is not one of them and does not come through here: its flow node was marked
// interrupted by the round itself, and the run is kept precisely so it can be picked back up — a
// sweep on the way out would be racing the resume for the same field.
func (r *ChainRunner) dropFlowNode(run *ChainRun, flowNodeID string) {
	if flowNodeID == "" {
		return
	}
	// Drop and not Finish: this is the run giving a card back rather than a play ending, so the card
	// is only marked if this run still holds it. By now it may have been marked a moment ago by the
	// run itself, or picked up by somebody else, and neither is this run's to write over.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Drop(run.Handle, flowNodeID, run.Id)
	}); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the card could not be given back: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

// read reads the board afresh. Every step does, and nothing is carried across an await but ids: the
// board is live throughout a run — dragged, edited, pulled — and a copy held from one turn to the
// next would be yesterday's board.
//
// A runner with no board store — a deployment naming no hybridflow-store — refuses here, with the
// variable that would name one. Every play and every restart comes through this read, so this one
// refusal covers them all.
func (r *ChainRunner) read(handle string) (*pkgBoards.BoardContent, error) {
	if r.Boards == nil {
		return nil, pkgBoards.ErrNoHybridflowStore("is no board to play")
	}
	return r.Boards.Board(handle)
}

// mark is every write of a board: one named operation on one card, and the bookkeeping that follows
// any of them.
//
// **There is no lock here.** A named operation is one card and one field of it, so two of them
// never touch the same row and the store itself keeps whatever invariant they share (see
// BoardStore): two runs marking two cards of one board never queue behind each other.
func (r *ChainRunner) mark(run *ChainRun, write func() (*pkgBoards.BoardContent, error)) error {
	board, err := write()
	if err != nil {
		return err
	}

	// The board is something somebody may have open, so every write says so: a client holding it
	// reloads rather than typing on top of a mark it never saw. Said even for a run on its way
	// out — the last thing a dying loop does is take the mark off the card it was holding, and that
	// is precisely a change somebody looking at the board has to see.
	//
	// The board that came back is also the freshest view there is, so the run's chain — the titles
	// and statuses a panel draws — is worked out from it here rather than by reading again for the
	// sake of a row of text.
	r.Mu.Lock()
	run.documentAt = time.Now()
	run.chain = pkgBoards.ChainFrom(board, run.trail, run.FlowNodeID)
	markChain(run)
	r.Mu.Unlock()
	r.announce(nil)
	return nil
}

// conversationFor makes the conversation a flow node is played in, with everything its settings
// state and everything its agent resolved to — those being what made it playable at all. Nothing is
// defaulted, the permission mode least of all: it is the line that says what the agent may do to
// the store while nobody is looking.
func (r *ChainRunner) ConversationFor(run *ChainRun, flowNode pkgBoards.FlowNode, resolved PlayAgent) (string, error) {
	if resolved.Snapshot != nil {
		fresh, err := r.ResolveAgent(FlowNodeWithAgent(resolved.Id))
		if err != nil {
			return "", err
		}
		resolved = fresh
	}
	if resolved.Model == "" && r.Hub != nil {
		resolved.Model, _ = r.Hub.AgentRegistry().DefaultsFor(resolved.Platform)
	}
	folder, err := runnerconfig.ResolveFolder(r.cfg.RootPath, flowNode.Settings.WorkFolder())
	if err != nil {
		return "", err
	}
	if resolved.Platform == agentapi.AgentPi && r.Hub != nil {
		p, err := r.Hub.AgentRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
		if err != nil {
			return "", err
		}
		resolved.profileID, resolved.Model = p.Profile.ID, p.Provider+"/"+p.ModelID
	}
	meta, err := r.convs.Create(conversations.ConversationMeta{
		AgentVersion:   pkgBoards.ConfiguredAgentVersion(resolved.Snapshot, resolved.Model, resolved.profileID),
		Title:          strings.TrimSpace(flowNode.Title),
		TitleSetByUser: strings.TrimSpace(flowNode.Title) != "",
		Folder:         folder.Virtual,
		Agent:          resolved.Platform,
		ProfileID:      resolved.profileID,
		Owner:          run.Owner.User,
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Thinking:       true,
	})
	if err != nil {
		return "", err
	}
	// The id is the join between this log and the conversation registry: a reader with the run's
	// log and the chat's transcript has both halves of the play.
	r.LogNote(run, flowNode.ID, meta.ID, "",
		"conversation made in "+protocol.OrDefault(folder.Virtual, "/")+" on "+resolved.Platform)
	if r.Hub != nil {
		r.Hub.NotifyRegistry(r.Hub.ConversationEvent(meta))
	}
	return meta.ID, nil
}

// forkChat copies the conversation a chain is running in into one of its own, for the flow node
// that comes next to be played in. The copy carries the transcript and — where the agent can branch
// a session — the session itself, so the flow node after starts *remembering* what the chain has
// done rather than merely being shown it (see ConversationStore.fork).
//
// **Named after the flow node it is made for**, like the conversation a flow node with no chat is
// given: each card of a chain now has a chat of its own, and a switcher holding six copies of
// "Write the plan" would have lost the one thing a title is for. The fork's own notice says what it
// was forked from, which is where that is read.
//
// A successor selects its own engine and profile. Compatible targets branch the native session;
// other targets receive the common transcript as context in their own session.
func (r *ChainRunner) forkChat(run *ChainRun, chat, title string, targets ...PlayAgent) (string, error) {
	source, err := r.convs.Get(chat)
	if err != nil {
		return "", err
	}
	agent := agentapi.ResolvedAgent(source.Agent)
	target := conversations.ForkTarget{Agent: agent, Label: r.agentLabel(agent), Branches: r.branches(agent), ProfileID: source.ProfileID}
	if len(targets) > 0 {
		onto := targets[0]
		if onto.Snapshot != nil {
			fresh, err := r.ResolveAgent(FlowNodeWithAgent(onto.Id))
			if err != nil {
				return "", err
			}
			onto = fresh
		}
		if onto.Model == "" && r.Hub != nil && onto.Platform != agentapi.AgentPi {
			onto.Model, _ = r.Hub.AgentRegistry().DefaultsFor(onto.Platform)
		}
		target.AgentVersion, target.ReplaceVersion = onto.Snapshot, true
		target.Effort = source.Effort
		target.Agent, target.Label, target.Branches = onto.Platform, r.agentLabel(onto.Platform), r.branches(onto.Platform)
		target.ProfileID, target.Model = onto.profileID, onto.Model
		target.PermissionMode = source.PermissionMode
		if onto.Platform == agentapi.AgentPi && r.Hub != nil {
			profile, err := r.Hub.AgentRegistry().Profiles.ResolveProfile(onto.profileID, onto.Model, "")
			if err != nil {
				return "", err
			}
			target.ProfileID, target.Model, target.Effort = profile.Profile.ID, profile.Provider+"/"+profile.ModelID, profile.Effort
		}
	}
	forked, err := r.convs.Fork(chat, run.Owner.User, "", target)
	if err != nil {
		return "", err
	}
	named := strings.TrimSpace(title)
	if named != "" {
		// The rename is a second write rather than an argument to the fork: forking is the
		// conversation store's business and what a board calls the copy is this runner's.
		if renamed, err := r.convs.Update(forked.ID, func(meta *conversations.ConversationMeta) {
			meta.Title, meta.TitleSetByUser = conversations.NormaliseTitle(named), true
		}); err == nil {
			forked = renamed
		} else {
			// A copy under the fork's own title is a copy that works; the run is not stopped over
			// what it is called.
			pkgBoards.LogChainRun.Warn("cannot name the forked chat after its flow node",
				"run", run.Id, "conversation", forked.ID, "error", err)
		}
	}
	if r.Hub != nil {
		r.Hub.NotifyRegistry(r.Hub.ConversationEvent(forked))
	}
	pkgBoards.LogChainRun.Info("chat forked for the next flow node", "run", run.Id, "from", chat, "to", forked.ID)
	return forked.ID, nil
}

// branches reports whether an agent's sessions can be branched rather than only continued, which is
// what decides whether a fork carries the session or only the transcript. A runner with no hub —
// every board test that is not about a turn — has no registry to ask, and a fork there is the
// transcript it can honestly be.
func (r *ChainRunner) branches(agent string) bool {
	return r.Hub != nil && r.Hub.AgentRegistry() != nil && r.Hub.AgentRegistry().Branches(agent)
}

// agentRefusal is why an AI flow node cannot be played as its settings ask, or "" when it can.
// Three things can be wrong and they read differently: an agent id this store does not hold, a
// platform this deployment does not offer, and a permission mode that platform does not have.
//
// A runner with no hub — every board test that is not about a turn — has no registry to ask and
// refuses nothing, which is the same forgiving reading every other seam here gets when it is not
// wired.
func (r *ChainRunner) AgentRefusal(flowNode pkgBoards.FlowNode) string {
	if !flowNode.IsAI() || r.Hub == nil || r.Hub.AgentRegistry() == nil {
		return ""
	}
	resolved, err := r.ResolveAgent(flowNode)
	if err != nil {
		return err.Error()
	}
	if !r.Hub.AgentRegistry().Known(resolved.Platform) {
		// By its name where the card named an agent, and by the platform where it named an
		// engine: a legacy card reads as it always did, while a managed agent is refused as the
		// thing it is rather than as an id nobody reads.
		if resolved.Name != "" {
			return "the agent \"" + resolved.Name + "\" runs on " + resolved.Platform +
				", which this service does not offer"
		}
		return "this flow node asks for the agent " + resolved.Platform + ", which this service does not offer"
	}
	if resolved.Platform == agentapi.AgentPi {
		profile, err := r.Hub.AgentRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
		if err == nil {
			err = r.Hub.AgentRegistry().Profiles.ValidateTurn(profile, true)
		}
		if err != nil {
			return err.Error()
		}
	}
	if !r.Hub.AgentRegistry().PublishesMode(resolved.Platform, flowNode.Settings.Permission) {
		return agentapi.ModeUnsupportedMessage(r.Hub.AgentRegistry().Label(resolved.Platform), flowNode.Settings.Permission)
	}
	return ""
}

// runnerRefusal is why a card pinned to a runner cannot be played here, or "" when it can —
// unpinned, or pinned to this service's own runner.
func (r *ChainRunner) RunnerRefusal(flowNode pkgBoards.FlowNode) string {
	want := strings.TrimSpace(flowNode.Settings.Runner)
	if want == "" {
		return ""
	}
	mine := r.cfg.CurrentRunnerID()
	if want == mine {
		return ""
	}
	pinned := r.runnerName(want)
	if mine == "" {
		return "this flow node runs on " + pinned + ", and this service names no runner"
	}
	return "this flow node runs on " + pinned + ", and this service is " + r.runnerName(mine)
}

// runnerName is a runner by the name the store keeps for the id — or the id itself, where no
// store answers or nothing holds it. Best-effort either way: it is a refusal's wording, and a
// name that cannot be resolved must not become a second reason to refuse.
func (r *ChainRunner) runnerName(id string) string {
	if r.Runners != nil {
		if found, err := r.Runners.Runner(id); err == nil && strings.TrimSpace(found.Name) != "" {
			return "“" + strings.TrimSpace(found.Name) + "”"
		}
	}
	return "“" + id + "”"
}

// Notices carry absolute instants; Dashboard supplies the reader's local datetime.
func said(at time.Time) string {
	return at.UTC().Format(time.RFC3339)
}

// capitalise puts a sentence's first letter up. The summaries read as clauses — "the connection to
// Claude was lost" — because they are mostly used inside one, and this is the one place a summary
// opens a sentence of its own.
func capitalise(text string) string {
	runes := []rune(text)
	if len(runes) == 0 {
		return text
	}
	return strings.ToUpper(string(runes[0])) + string(runes[1:])
}

var ErrNoChainRunner = errors.New("this service runs no chain runner")
