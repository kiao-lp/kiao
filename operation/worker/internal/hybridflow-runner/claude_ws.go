package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"fmt"
	"kiao/worker/internal/core"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ClaudeHub owns the turns behind /ws/hybridflow-runner, using AgentDriver for agent operations.
// The agent and folder are bound to the conversation, never chosen by a prompt.
//
// A socket multiplexes subscriptions; turns and pending asks outlive disconnected sockets.
// Protocol changes must update PROTOCOL.md and ClaudeClientMessage / ClaudeServerMessage
// in reference/npm/kiao-worker/src/agent-types.ts, and bump agentProtocolVersion.
type ClaudeHub struct {
	cfg      *Config
	upgrader websocket.Upgrader

	// store is fixed at construction; nil is supported in tests and refuses prompts.
	store *ConversationStore

	// agents holds the deployment's agents and defaults; tests can substitute drivers.
	agents *agentRegistry

	// mu guards jobs, subs and conns together. Lock order: h.mu → job.mu.
	// The emit path releases job.mu before taking h.mu to fan out.
	mu    sync.Mutex
	jobs  map[string]*claudeJob         // conversationId → its running turn, or the last one until swept
	subs  map[string]map[string]*wsConn // conversationId → socketId → socket
	conns map[string]*wsConn            // socketId → socket
	// Reject reservations once shutdown starts, including requests already validating.
	shuttingDown bool

	jobTTL time.Duration
	// autoAllowDelay is configurable here so tests need not wait ten seconds.
	autoAllowDelay time.Duration
	maxTurns       int
	janitorStop    chan struct{}
	stopOnce       sync.Once

	// turnTokens authenticates callbacks from bundled MCP servers; bundledNames identifies them.
	turnTokens   *core.TurnTokenRegistry
	bundledNames map[string]bool

	// registry is queried at each spawn so toolbox installs reach the next turn. Nil means no servers.
	registry MCPRegistry

	// attachments resolves uploaded ids to host files. Nil refuses prompts with attachments.
	attachments *AttachmentStore

	// chainRunner supplies hello's run snapshots and receives chat stops. May be nil.
	chainRunner *ChainRunner
}

const (
	// Retain settled turns to close the gap between a REST read and a socket subscribe.
	defaultJobTTL = 30 * time.Minute
	// Fallback for hand-built configs; Config.Validate requires a positive cap.
	defaultMaxTurns = 4
	janitorInterval = 5 * time.Minute

	// Bump whenever a frame's shape changes; clients with a different version must reload.
	agentProtocolVersion = 19
)

// Wire values shared with conversationBlock and ClaudeWireBlock in agent-types.ts.
// Claude often emits empty thinking text/deltas; retain the blocks to preserve turn order.
// redacted_thinking uses the same kind because empty thinking is already normal.
const (
	blockKindText     = "text"
	blockKindThinking = "thinking"
	blockKindToolUse  = "tool_use"
	blockKindSubagent = "subagent"
)

// Wire values shared with claudeAllPermissionModes and AgentPermissionMode.
// manual waits for human decisions; manualLive adds a server-side auto-allow countdown;
// bypassPermissions allows tool calls without asking. Questions still require answers.
const (
	permissionModeManual     = "manual"
	permissionModeManualLive = "manualLive"
	permissionModeBypass     = "bypassPermissions"
)

// claudeAutoAllowDelay applies only to manualLive permissions, never questions.
// The server owns the countdown so it runs without a browser; decideAt tells clients the deadline.
const claudeAutoAllowDelay = 10 * time.Second

func asksBeforeTools(mode string) bool {
	return mode == permissionModeManual || mode == permissionModeManualLive
}

// allowsPermissionMode gates the known bypass mode by deployment policy.
func (c *Config) allowsPermissionMode(mode string) bool {
	return mode != permissionModeBypass || c.BypassEnabled
}

// Preserve the legacy bypass default when allowed; otherwise default to manual.
func (c *Config) defaultPermissionMode() string {
	if c.BypassEnabled {
		return permissionModeBypass
	}
	return permissionModeManual
}

// A lost-session notice is not a model reply; retained history is no longer model context.
const sessionLostNotice = "The Claude session for this conversation has expired. " +
	"The next message starts a new session — the history above is kept for reading, " +
	"but Claude will not remember it."

func newClaudeHub(cfg *Config, store *ConversationStore) *ClaudeHub {
	maxTurns := cfg.MaxTurns
	if maxTurns < 1 {
		// Zero means unset, not "refuse every turn".
		maxTurns = defaultMaxTurns
	}
	h := &ClaudeHub{
		cfg:            cfg,
		store:          store,
		agents:         newAgentRegistry(cfg),
		jobs:           map[string]*claudeJob{},
		subs:           map[string]map[string]*wsConn{},
		conns:          map[string]*wsConn{},
		jobTTL:         defaultJobTTL,
		autoAllowDelay: claudeAutoAllowDelay,
		maxTurns:       maxTurns,
		turnTokens:     core.NewTurnTokenRegistry(),
		janitorStop:    make(chan struct{}),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
	go h.janitor(janitorInterval)
	return h
}

// claudeJob is one turn. Subscriptions live on the hub because conversations outlive turns.
type claudeJob struct {
	conversationID string
	turnID         string
	owner          string
	folder         string // normalised virtual folder; "" is the store root
	workDir        string // absolute, symlink-resolved cwd handed to the agent
	promptText     string // the user's prompt verbatim, for `sync` and the transcript record
	model          string
	effort         string
	permissionMode string
	thinking       bool
	// agentName comes from the conversation, never the request.
	agentName string
	// resumed records whether the turn was spawned with --resume.
	resumed   bool
	startedAt time.Time
	// These are the actual composed prompt, system briefing and standing orders sent to the model;
	// file them beside the user's verbatim prompt for transcript auditing.
	composedPrompt string
	systemPrompt   string
	instructions   string
	// Play context from the runner, recorded with both prompt and reply; empty for chat turns.
	playedBy   string
	agentRef   string
	runID      string
	flowNodeID string
	board      string

	// mcpToken is minted before spawn and revoked by finishTurn on every settlement path.
	mcpToken string

	// emitMu serialises the superseded check and fan-out so stopped is the final frame.
	// Checking under mu alone allows a frame to pass the check and arrive after stopped.
	// Lock order: emitMu → mu or ClaudeHub.mu; never acquire emitMu while holding either.
	emitMu sync.Mutex

	// settled closes after the transcript write so in-process waiters can immediately read the reply.
	settled    chan struct{}
	settleOnce sync.Once

	mu sync.Mutex
	// trace closes when the driver's stream ends, not in finishTurn: after a stop,
	// driver goroutines may still write stderr and protocol frames. Nil if no trace was opened.
	trace *turnTrace
	// driver is published only after spawn succeeds. A stop before publication settles the job;
	// startTurn must then stop the newly spawned driver. processPending keeps the
	// reservation until Spawn fails or the driver's event stream has fully closed.
	driver         AgentDriver
	processPending bool
	sessionID      string
	// forkPending is cleared when the agent announces the branched session id; guarded by mu.
	forkPending bool
	// For a resumed, uninterrupted turn, non-zero exit before any session announcement implies session loss.
	sawSession bool
	// messageUUID is the last agent message id, recorded as SessionAnchor for a later fork.
	messageUUID string
	// blocks preserves agent order for sync and the transcript.
	blocks []turnBlock
	// betweens holds user interruptions separately from reply blocks for sync replay;
	// subscribed tabs do not re-read the transcript until the turn ends.
	betweens []string
	// background is a replacement roster, including finished work, replayed on sync
	// and settled at turn end.
	background []BackgroundTask
	pending    []*claudePermission
	isDone     bool
	// superseded suppresses client output while a stopped driver's stream is still draining.
	superseded bool
	// interrupted distinguishes stop, deletion or spawn failure from an agent's own failure.
	interrupted bool
	// failureNotice holds the last agent failure event, not model speech. Guarded by mu;
	// written by the stream consumer and read by the runner after settled.
	failureNotice string
	// failure is the spawn failure message, also exposed to in-process callers.
	failure string
	// terminal records an agent's completed/cancelled/failed status to distinguish
	// synthesised exit codes from process exits.
	terminal string
	// usage is the agent's last cost report.
	usage *turnUsage
	// Zero means no reply block arrived.
	firstBlockAt time.Time
	// askHistory retains asks as they leave pending: answered, withdrawn or cancelled at settlement.
	askHistory []conversationAsk
	exitCode   int
	finishedAt time.Time
}

// Hand-built test jobs may omit the settle signal.
func (job *claudeJob) markSettled() {
	if job.settled == nil {
		return
	}
	job.settleOnce.Do(func() { close(job.settled) })
}

// lastFailure is separate from the reply: codex exec can report errors on its stream,
// produce no reply and exit zero. The runner uses this to avoid marking an empty answer done.
func (job *claudeJob) lastFailure() string {
	job.mu.Lock()
	defer job.mu.Unlock()
	return job.failureNotice
}

func (job *claudeJob) outcome() (interrupted bool, failure string) {
	job.mu.Lock()
	defer job.mu.Unlock()
	return job.interrupted, job.failure
}

// turnBlock preserves the agent's reply order.
type turnBlock struct {
	kind string
	// text carries blockKindText and blockKindThinking. A redacted thinking block has none.
	text string
	// For tool_use: tool name, short input summary, and full input.
	name   string
	input  string
	detail string
	// toolUseID joins separately arriving calls and results.
	toolUseID string
	// Codex/Muse results arrive with the call; Claude results are filled in later.
	result   string
	isError  bool
	exitCode *int
	// Timing is transcript-only; the wire omits it.
	at         time.Time
	durationMs int64
	// subagent is non-nil only for blockKindSubagent.
	subagent *turnSubagent
}

// wireBlock is the live subset of a transcript block, also used by sync. Timing stays on disk.
func wireBlock(block turnBlock) map[string]any {
	frame := map[string]any{"kind": block.kind}
	if block.kind == blockKindSubagent {
		frame["text"] = block.text
		if block.subagent != nil {
			frame["subagent"] = wireSubagent(block.subagent)
		}
		return frame
	}
	if block.kind == blockKindToolUse {
		frame["name"] = block.name
		if block.input != "" {
			frame["input"] = block.input
		}
		if block.detail != "" {
			frame["detail"] = block.detail
		}
		if block.toolUseID != "" {
			frame["toolUseId"] = block.toolUseID
		}
		if block.result != "" {
			frame["result"] = block.result
		}
		if block.isError {
			frame["isError"] = true
		}
		if block.exitCode != nil {
			frame["exitCode"] = *block.exitCode
		}
		return frame
	}
	frame["text"] = block.text
	return frame
}

// wireSubagent includes nested delegation blocks recursively.
func wireSubagent(sub *turnSubagent) map[string]any {
	frame := map[string]any{}
	if sub.SubagentID != "" {
		frame["subagentId"] = sub.SubagentID
	}
	if sub.ChildSessionID != "" {
		frame["childSessionId"] = sub.ChildSessionID
	}
	if sub.Role != "" {
		frame["role"] = sub.Role
	}
	if sub.Objective != "" {
		frame["objective"] = sub.Objective
	}
	if sub.Status != "" {
		frame["status"] = sub.Status
	}
	if sub.Result != "" {
		frame["result"] = sub.Result
	}
	if sub.DurationMs != 0 {
		frame["durationMs"] = sub.DurationMs
	}
	if sub.Truncated {
		frame["truncated"] = true
	}
	if len(sub.Blocks) > 0 {
		blocks := make([]any, 0, len(sub.Blocks))
		for _, block := range sub.Blocks {
			blocks = append(blocks, wireBlock(block))
		}
		frame["blocks"] = blocks
	}
	return frame
}

// claudePermission retains an AgentAsk and its replay frame until answered or withdrawn.
type claudePermission struct {
	requestID string
	// input must remain verbatim: the agent runs updatedInput against the tool's schema,
	// so the truncated display summary cannot be returned here.
	input any
	// message is retained for sync replay while the ask is pending.
	message map[string]any
	// Non-nil questions distinguishes a question from a permission; order matches the ask.
	questions []map[string]any
	// questionKeys preserves exact agent question texts for the answers map. The frame's
	// trimmed text cannot be used as a key or the tool treats the question as unanswered.
	questionKeys []string
	// timer auto-allows manualLive permissions; nil for questions and other modes.
	// Stop it when the ask leaves pending.
	timer *time.Timer
}

func (perm *claudePermission) isQuestion() bool { return perm.questions != nil }

type wsIncoming struct {
	Type string `json:"type"`

	// ConversationID and ConversationIDs are accepted as a union; singular ids are normally
	// used for turn actions, lists for subscribe/unsubscribe.
	ConversationID  string   `json:"conversationId"`
	ConversationIDs []string `json:"conversationIds"`

	Prompt string `json:"prompt"`
	// Text carries a between into an existing turn; Prompt starts a new turn.
	Text   string `json:"text"`
	Model  string `json:"model"`
	Effort string `json:"effort"`
	// nil keeps the conversation setting; false disables extended thinking via CLAUDE_CODE_DISABLE_THINKING.
	Thinking *bool `json:"thinking"`
	// Empty PermissionMode keeps the conversation's setting.
	PermissionMode string `json:"permissionMode"`
	// Attachments are ordered ids from POST /hybridflow-runner/attachments, never client-supplied
	// host paths: clients must not choose arbitrary files for a turn to read.
	Attachments []string `json:"attachments"`

	RequestID string `json:"requestId"`
	Behavior  string `json:"behavior"`
	Message   string `json:"message"`

	// Answers is positional to preserve identically worded questions. Blanks mean unanswered;
	// dismissing a card sends blanks rather than inventing answers.
	Answers []string `json:"answers"`
}

func (msg wsIncoming) conversationIDs() []string {
	seen := map[string]struct{}{}
	ids := []string{}
	for _, id := range append([]string{msg.ConversationID}, msg.ConversationIDs...) {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, already := seen[id]; already {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func (h *ClaudeHub) handle(w http.ResponseWriter, r *http.Request) {
	reqID := core.RequestID(r.Context())
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logClaudeWS.Warn("upgrade failed", "request_id", reqID, "error", err)
		return
	}

	id := core.IdentityFromRequest(r)
	c := newWSConn(conn, id.User)
	h.addConn(c)
	logClaudeWS.Info("connected", "user", id.User, "socket", c.id, "request_id", reqID)
	defer h.afterConnectionClosed(c, id)

	conn.SetReadLimit(maxIncomingFrameBytes)
	_ = conn.SetReadDeadline(time.Now().Add(pongTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongTimeout))
	})
	go h.heartbeat(c)

	// Send hello first so reconnecting clients learn the protocol and running turns before asking.
	if err := c.sendJSON(h.helloFrame(c)); err != nil {
		return
	}

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg wsIncoming
		if err := json.Unmarshal(data, &msg); err != nil {
			logClaudeWS.Warn("message parse failed", "user", id.User, "socket", c.id, "error", err)
			continue
		}
		switch msg.Type {
		case "subscribe":
			h.handleSubscribe(c, id, msg)
		case "unsubscribe":
			h.handleUnsubscribe(c, msg)
		case "prompt":
			h.handlePrompt(c, id, msg)
		case "between":
			h.handleBetween(c, id, msg)
		case "stop":
			h.handleStop(c, id, msg)
		case "permission_decision":
			h.handlePermissionDecision(c, id, msg)
		case "question_answer":
			h.handleQuestionAnswer(c, id, msg)
		default:
			logClaudeWS.Warn("unknown message type", "user", id.User, "socket", c.id, "type", msg.Type)
		}
	}
}

// helloFrame describes the socket, with no conversationId.
func (h *ClaudeHub) helloFrame(c *wsConn) map[string]any {
	h.mu.Lock()
	running := []string{}
	for conversationID, job := range h.jobs {
		job.mu.Lock()
		live := !job.isDone
		job.mu.Unlock()
		if live {
			running = append(running, conversationID)
		}
	}
	h.mu.Unlock()
	sort.Strings(running)

	frame := map[string]any{
		"type":                 "hello",
		"protocolVersion":      agentProtocolVersion,
		"socketId":             c.id,
		"runningConversations": running,
		"maxConcurrentTurns":   h.maxTurns,
		// Default agent first; capabilities are fetched separately from /hybridflow-runner/options.
		"agents": h.agents.names(),
	}
	if h.chainRunner != nil {
		frame["chainRuns"] = h.chainRunner.snapshots()
	}
	return frame
}

// handleSubscribe is additive and repeatable, answering each id with sync or not_running.
// It must not evict held turns: another subscriber may still need them.
func (h *ClaudeHub) handleSubscribe(c *wsConn, id core.Identity, msg wsIncoming) {
	ids := msg.conversationIDs()
	if len(ids) == 0 {
		return
	}
	logClaudeWS.Info("subscribed", "user", id.User, "socket", c.id, "conversations", len(ids))
	for _, conversationID := range ids {
		job := h.subscribe(c, conversationID)
		if job == nil {
			h.emitTo(c, conversationID, map[string]any{"type": "not_running"})
			continue
		}
		h.emitTo(c, conversationID, h.syncFrame(job))
	}
}

// Unsubscribing does not stop turns.
func (h *ClaudeHub) handleUnsubscribe(c *wsConn, msg wsIncoming) {
	for _, conversationID := range msg.conversationIDs() {
		h.unsubscribe(c, conversationID)
	}
}

// syncFrame replaces the client's current/last held turn state, including all blocks.
// Completed transcripts come from REST. Clone retained maps because emit stamps ids onto them.
func (h *ClaudeHub) syncFrame(job *claudeJob) map[string]any {
	job.mu.Lock()
	defer job.mu.Unlock()

	blocks := make([]map[string]any, 0, len(job.blocks))
	for _, block := range job.blocks {
		blocks = append(blocks, wireBlock(block))
	}
	// Replay pending asks so reconnecting clients can answer them. Keep questions separate
	// from permissions: allowing a question's tool without collecting answers loses the ask.
	pending := make([]map[string]any, 0, len(job.pending))
	questions := make([]map[string]any, 0, len(job.pending))
	for _, perm := range job.pending {
		if perm.isQuestion() {
			questions = append(questions, cloneFrame(perm.message))
			continue
		}
		pending = append(pending, cloneFrame(perm.message))
	}

	frame := map[string]any{
		"type":               "sync",
		"turnId":             job.turnID,
		"running":            !job.isDone,
		"userText":           job.promptText,
		"betweens":           append([]string{}, job.betweens...),
		"blocks":             blocks,
		"permissionMode":     job.permissionMode,
		"agent":              resolvedAgent(job.agentName),
		"pendingPermissions": pending,
		"pendingQuestions":   questions,
		"background":         wireBackground(job.background),
		"startedAt":          job.startedAt.UnixMilli(),
	}
	if job.sessionID != "" {
		frame["sessionId"] = job.sessionID
	}
	if job.isDone {
		frame["finishedAt"] = job.finishedAt.UnixMilli()
		frame["exitCode"] = job.exitCode
	}
	return frame
}

// storeRoot resolves --add-dir like the working directory. Resolve per turn because the
// root symlink may have been repointed. Failure omits the flag; folder validation normally catches it first.
func (h *ClaudeHub) storeRoot() string {
	root, err := resolveClaudeFolder(h.cfg.RootPath, "")
	if err != nil {
		logClaudeWS.Warn("cannot resolve the store root; the turn runs with its folder alone",
			"root", h.cfg.RootPath, "error", err)
		return ""
	}
	return root.abs
}

// turnRequest comes from a socket or runner. Folder, session and defaults come only
// from the conversation record.
type turnRequest struct {
	conversationID string
	prompt         string
	model          string
	effort         string
	permissionMode string
	// instructions are managed-agent standing orders in the briefing, recorded separately
	// from the user's prompt.
	instructions string
	// Runner-only play context: managed agent name, card's agent reference, run, flow node and board.
	// Recorded in the transcript; empty for chat turns.
	managedAgent string
	agentRef     string
	runID        string
	flowNodeID   string
	board        string
	// nil keeps the conversation setting; false disables extended thinking for this turn.
	thinking *bool
	// attachments are ids from POST /hybridflow-runner/attachments, in the order the user attached them.
	attachments []string
	// images are resolved store files named by a flow node's body. The prompt names their paths;
	// the transcript retains the original markdown rather than attachment records.
	images []promptFile
}

// promptFile covers uploaded attachments and store images; store images have no upload id or TTL.
type promptFile struct {
	Path      string
	MediaType string
	Size      int64
}

// turnRefusal means nothing was spawned; the same refusal is emitted to conversation subscribers.
type turnRefusal struct {
	code    string
	message string
}

func (h *ClaudeHub) handlePrompt(c *wsConn, id core.Identity, msg wsIncoming) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		// No conversation id means no route for a refusal frame.
		logClaudeWS.Warn("prompt without a conversation id", "user", id.User, "socket", c.id)
		return
	}
	// Prompting subscribes, so a client cannot miss its own reply by forgetting to ask for it first.
	h.subscribe(c, conversationID)
	h.startTurnFor(c, id, turnRequest{
		conversationID: conversationID,
		prompt:         msg.Prompt,
		model:          msg.Model,
		effort:         msg.Effort,
		permissionMode: msg.PermissionMode,
		thinking:       msg.Thinking,
		attachments:    msg.Attachments,
	})
}

// startTurnFor validates and spawns; c is nil for in-process callers and used only for logging.
// Validate request fields before consulting resources so capacity cannot mask malformed requests.
// Failures after recording a turn return a settled job, not a refusal.
func (h *ClaudeHub) startTurnFor(c *wsConn, id core.Identity, req turnRequest) (*claudeJob, *turnRefusal) {
	conversationID := strings.TrimSpace(req.conversationID)
	refuse := func(code, message string) (*claudeJob, *turnRefusal) {
		logClaudeWS.Warn("prompt refused",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "code", code)
		h.emitFor(conversationID, "", errorFrame(conversationID, code, message))
		return nil, &turnRefusal{code: code, message: message}
	}

	// Never interpret an unknown mode as a different permission policy.
	if req.permissionMode != "" && !knownPermissionMode(req.permissionMode) {
		return refuse(errCodeUnknownPermissionMode, "Unknown permission mode: "+req.permissionMode)
	}
	// Check explicit deployment policy before reading the conversation; check its stored mode below.
	if !h.cfg.allowsPermissionMode(req.permissionMode) {
		return refuse(errCodeBypassDisabled, bypassDisabledMessage)
	}
	if len(req.attachments) > maxPromptAttachments {
		return refuse(errCodeBadAttachment, fmt.Sprintf(
			"A message may carry at most %d attachments; this one carries %d.",
			maxPromptAttachments, len(req.attachments)))
	}
	if h.store == nil {
		return refuse(errCodeUnknownConversation, "This service has no conversation registry.")
	}
	meta, err := h.store.get(conversationID)
	if err != nil {
		return refuse(errCodeUnknownConversation, "This conversation no longer exists.")
	}
	// Recheck stored policy so conversations cannot retain bypass after it is disabled.
	// Refuse rather than silently run a mode different from the displayed one.
	if !h.cfg.allowsPermissionMode(orDefault(req.permissionMode, meta.PermissionMode)) {
		return refuse(errCodeBypassDisabled, bypassDisabledMessage)
	}
	// Sessions belong to their engine and cannot move when that agent is withdrawn.
	if !h.agents.known(meta.Agent) {
		return refuse(errCodeUnknownAgent,
			"This conversation runs on "+orDefault(meta.Agent, "an agent")+
				", which this service no longer offers. Fork it onto another agent to carry on.")
	}
	// Agent support is a separate gate from deployment policy: Codex cannot fulfil manual asks.
	mode := orDefault(req.permissionMode, orDefault(meta.PermissionMode, h.cfg.defaultPermissionMode()))
	if !h.agents.publishesMode(meta.Agent, mode) {
		return refuse(errCodeModeUnsupported, modeUnsupportedMessage(h.agents.label(meta.Agent), mode))
	}
	// Re-resolve each turn: renames, deletions or symlinks outside the store must prevent spawning.
	folder, err := resolveClaudeFolder(h.cfg.RootPath, meta.Folder)
	if err != nil {
		_, message := core.StatusForError(err)
		return refuse(errCodeBadFolder, "The conversation's folder is unusable: "+message)
	}
	// Missing attachments must refuse the turn; silently dropping them would misrepresent its context.
	attachments, err := h.resolveAttachments(req.attachments)
	if err != nil {
		return refuse(errCodeBadAttachment, err.Error())
	}

	return h.startTurn(c, id, meta, folder, req, attachments)
}

// Preserve attachment order so references such as "the first screenshot" remain meaningful.
func (h *ClaudeHub) resolveAttachments(ids []string) ([]claudeAttachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if h.attachments == nil {
		return nil, errors.New("This service stores no attachments.")
	}
	resolved := make([]claudeAttachment, 0, len(ids))
	for _, id := range ids {
		found, err := h.attachments.resolve(strings.TrimSpace(id))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, errors.New("An attached file is no longer on the server. " +
					"Attach it again and send the message once more.")
			}
			return nil, errors.New("An attachment could not be read: " + err.Error())
		}
		resolved = append(resolved, found)
	}
	return resolved, nil
}

// startTurn reserves the conversation and records the prompt before spawning.
// Once recorded, failures settle the job through failTurn and return it with failure set.
func (h *ClaudeHub) startTurn(c *wsConn, id core.Identity, meta conversationMeta,
	folder claudeFolder, req turnRequest, attachments []claudeAttachment) (*claudeJob, *turnRefusal) {
	// Per-turn settings become conversation defaults. Model/effort fallbacks must be agent-specific.
	defaultModel, defaultEffort := h.agents.defaultsFor(meta.Agent)
	model := orDefault(req.model, orDefault(meta.Model, defaultModel))
	effort := orDefault(req.effort, orDefault(meta.Effort, defaultEffort))
	permissionMode := orDefault(req.permissionMode, orDefault(meta.PermissionMode, h.cfg.defaultPermissionMode()))
	thinking := meta.Thinking
	if req.thinking != nil {
		thinking = *req.thinking
	}

	job := &claudeJob{
		conversationID: meta.ID,
		turnID:         "turn-" + core.NowMillisStr() + "-" + core.RandID()[:4],
		owner:          id.User,
		folder:         folder.virtual,
		workDir:        folder.abs,
		promptText:     req.prompt,
		model:          model,
		effort:         effort,
		permissionMode: permissionMode,
		thinking:       thinking,
		agentName:      h.agents.name(meta.Agent),
		instructions:   req.instructions,
		playedBy:       req.managedAgent,
		agentRef:       req.agentRef,
		runID:          req.runID,
		flowNodeID:     req.flowNodeID,
		board:          req.board,
		resumed:        strings.TrimSpace(meta.SessionID) != "",
		// ForkPending alone cannot branch: a parent session must also exist.
		forkPending:    meta.ForkPending && strings.TrimSpace(meta.SessionID) != "",
		startedAt:      time.Now(),
		settled:        make(chan struct{}),
		processPending: true,
	}
	// Capture before publishing the job: applySession clears forkPending asynchronously.
	// The anchor only has meaning with the fork it cuts.
	forkSession, forkAnchor := job.forkPending, meta.ForkAnchor
	if code, message := h.reserveTurn(job); code != "" {
		logClaudeWS.Warn("turn refused",
			"user", id.User, "conversation", meta.ID, "code", code, "max_turns", h.maxTurns)
		h.emitFor(meta.ID, "", errorFrame(meta.ID, code, message))
		return nil, &turnRefusal{code: code, message: message}
	}

	logClaudeWS.Info("prompt received",
		"user", id.User, "socket", socketID(c), "conversation", meta.ID, "turn", job.turnID,
		"agent", job.agentName, "model", model, "effort", effort,
		"thinking", thinking, "permission_mode", permissionMode,
		"folder", folder.virtual, "resumed", job.resumed, "prompt_chars", len(req.prompt),
		"attachments", len(attachments), "images", len(req.images))

	// Compose once so the driver and transcript get the same model context.
	job.composedPrompt = promptWithContext(req.prompt, attachments, req.images)
	storeRoot := h.storeRoot()
	job.systemPrompt = agentBriefingWith(storeRoot, req.instructions)

	// Write the user record before spawning so sweepInterrupted always has a dangling prompt to close.
	meta, err := h.store.appendAndUpdate(meta.ID, conversationRecord{
		Role: roleUser, Text: req.prompt, TurnID: job.turnID,
		Model: model, Effort: effort, PermissionMode: permissionMode,
		Attachments:    attachmentRecords(attachments),
		ComposedPrompt: job.composedPrompt,
		SystemPrompt:   job.systemPrompt,
		Instructions:   req.instructions,
		PlayedBy:       req.managedAgent,
		AgentRef:       req.agentRef,
		RunID:          req.runID,
		FlowNodeID:     req.flowNodeID,
		Board:          req.board,
	}, func(stored *conversationMeta) {
		stored.Model, stored.Effort = model, effort
		stored.PermissionMode, stored.Thinking = permissionMode, thinking
		stored.RunningAt = nowConversationTime()
		stored.RunningTurn = job.turnID
	})
	if err != nil {
		// No consumer will settle this unspawned job; release the reservation explicitly.
		job.releaseProcess()
		h.removeJob(job.conversationID)
		logClaudeWS.Error("cannot record the prompt", "conversation", job.conversationID, "error", err)
		const message = "The message could not be recorded, so no turn was started."
		h.emitFor(job.conversationID, "", errorFrame(job.conversationID, errCodeSpawnFailed, message))
		return nil, &turnRefusal{code: errCodeSpawnFailed, message: message}
	}

	// The prompt is on record; subsequent failures must settle it through failTurn.
	failWith := func(message string, err error) (*claudeJob, *turnRefusal) {
		defer job.releaseProcess()
		logClaudeWS.Error("spawn failed",
			"user", id.User, "conversation", job.conversationID, "turn", job.turnID, "error", err)
		// No driver stream will close this trace after a failed spawn.
		job.endTrace(message)
		h.failTurn(job, message)
		return job, nil
	}
	fail := func(prefix string, err error) (*claudeJob, *turnRefusal) {
		return failWith(prefix+": "+err.Error(), err)
	}

	// Resolve the agent once for MCP rendering and spawning. Query tools at spawn time;
	// rendering errors fail the turn rather than silently removing tools.
	// Agents without AgentMCP receive no servers or callback credential.
	agent := h.agents.driverFor(job.agentName)

	servers := h.mcpServers()
	mcpConfig := ""
	if renderer, ok := agent.(AgentMCP); ok {
		mcpConfig, err = renderer.RenderMCP(servers)
		if err != nil {
			return fail("The turn could not be given its tools", err)
		}
	} else {
		servers = nil
	}

	// Mint a caller-bound credential before spawn, only if bundled MCP servers need callbacks.
	if h.needsTurnToken(servers) {
		token, err := h.turnTokens.Issue(id, job.conversationID+"/"+job.turnID)
		if err != nil {
			return fail("The turn could not be given its tools", err)
		}
		job.mcpToken = token
	}

	// Open before spawn so failures have a trace too; redact the MCP credential.
	// The driver writes runtime details; the hub closes the trace after the stream ends.
	trace := h.store.openTurnTrace(job.conversationID, job.turnID, meta.TraceStream, []string{job.mcpToken})
	job.mu.Lock()
	job.trace = trace
	job.mu.Unlock()
	trace.run(traceRun{
		Conversation: job.conversationID, Turn: job.turnID,
		Agent: resolvedAgent(job.agentName), Owner: job.owner,
		Folder: job.folder, WorkDir: job.workDir, StoreRoot: storeRoot,
		Model: model, Effort: effort, PermissionMode: permissionMode, Thinking: thinking,
		AllowBypass: h.cfg.BypassEnabled,
		Session:     meta.SessionID, ForkSession: forkSession, ResumeAt: forkAnchor,
		MCPServers: traceMCPServers(servers), MCPConfig: mcpConfig, MCPToken: job.mcpToken != "",
		PlayedBy: req.managedAgent, RunID: req.runID, FlowNodeID: req.flowNodeID, Board: req.board,
	})

	run := AgentRun{
		Conversation: job.conversationID, Turn: job.turnID,
		Prompt:  job.composedPrompt,
		WorkDir: job.workDir, StoreRoot: storeRoot,
		Model: model, Effort: effort, PermissionMode: permissionMode, Thinking: thinking,
		Instructions: req.instructions,
		AllowBypass:  h.cfg.BypassEnabled,
		SessionID:    meta.SessionID,
		ForkSession:  forkSession,
		ResumeAt:     forkAnchor,
		MCPConfig:    mcpConfig,
		MCPToken:     job.mcpToken,
		Trace:        trace,
	}
	driver := agent.Driver()
	// Relay the driver's user-facing spawn error verbatim.
	if err := driver.Spawn(run); err != nil {
		return failWith(err.Error(), err)
	}

	// Publish the driver under job.mu only after spawn succeeds. A stop may already have settled
	// the reserved job; then stop the driver and drain its events to reap it, without emitting them.
	job.mu.Lock()
	settled := job.isDone || job.superseded
	if !settled {
		job.driver = driver
	}
	job.mu.Unlock()
	if settled {
		driver.Stop()
		go func() {
			defer job.releaseProcess()
			for range driver.Events() {
			}
			job.endTrace("stopped before its stream was read")
		}()
		return job, nil
	}

	// Broadcast registry state before start so every tab's list already marks the conversation busy.
	h.broadcastRegistry(h.conversationFrame(meta))
	h.emit(job, map[string]any{
		"type": "start", "model": job.model, "effort": job.effort, "thinking": job.thinking,
		"permissionMode": job.permissionMode, "agent": resolvedAgent(job.agentName), "folder": job.folder,
		"startedAt": job.startedAt.UnixMilli(),
	})

	go h.consume(job, driver)
	return job, nil
}

// bareSlashCommand excludes arguments and prose, even if they start with a slash.
var bareSlashCommand = regexp.MustCompile(`^\s*/[A-Za-z0-9][A-Za-z0-9_:.-]*\s*$`)

// promptWithContext adds absolute paths for attachments and linked store images.
// Bare slash commands bypass notes: commands such as /compact treat appended text as arguments.
// Commands with arguments are treated as ordinary messages.
func promptWithContext(prompt string, attachments []claudeAttachment, images []promptFile) string {
	if bareSlashCommand.MatchString(prompt) {
		return prompt
	}
	if len(attachments) == 0 && len(images) == 0 {
		return prompt
	}
	var sb strings.Builder
	sb.WriteString(prompt)
	if len(attachments) > 0 {
		sb.WriteString("\n\n---\nThe user attached ")
		if len(attachments) == 1 {
			sb.WriteString("this file")
		} else {
			sb.WriteString("these files")
		}
		sb.WriteString(" to the message above. Read them with the Read tool — the paths are absolute, " +
			"so use them as written:\n")
		for _, att := range attachments {
			fmt.Fprintf(&sb, "- %s (%s, %d bytes)\n", att.Path, att.MediaType, att.Size)
		}
		sb.WriteString("---")
	}
	if len(images) > 0 {
		sb.WriteString("\n\n---\nThe message above links ")
		if len(images) == 1 {
			sb.WriteString("this image, a file of the store. Read it with the Read tool — the path is " +
				"absolute, so use it as written:\n")
		} else {
			sb.WriteString("these images, files of the store. Read them with the Read tool — the paths " +
				"are absolute, so use them as written:\n")
		}
		for _, image := range images {
			fmt.Fprintf(&sb, "- %s (%s, %d bytes)\n", image.Path, image.MediaType, image.Size)
		}
		sb.WriteString("---")
	}
	return sb.String()
}

// Omit host paths from durable attachment records; they need not remain valid.
func attachmentRecords(attachments []claudeAttachment) []conversationAttachment {
	if len(attachments) == 0 {
		return nil
	}
	records := make([]conversationAttachment, 0, len(attachments))
	for _, att := range attachments {
		records = append(records, conversationAttachment{
			ID: att.ID, Name: att.Name, Size: att.Size, MediaType: att.MediaType,
		})
	}
	return records
}

// handleBetween delivers into the current turn without changing its settings or starting another.
// Send before recording/echoing: unlike a new prompt, it must not claim delivery if Say fails.
// Unsendable messages are refused rather than queued; the sender can retry as a prompt.
func (h *ClaudeHub) handleBetween(c *wsConn, id core.Identity, msg wsIncoming) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		logClaudeWS.Warn("between without a conversation id", "user", id.User, "socket", socketID(c))
		return
	}
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		logClaudeWS.Warn("empty between", "user", id.User, "socket", socketID(c),
			"conversation", conversationID)
		return
	}

	// Betweens use the prompt's inbound-frame cap and normaliseRecord truncation.

	refuse := func(code, message string) {
		logClaudeWS.Warn("between refused",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "code", code)
		h.emitFor(conversationID, "", errorFrame(conversationID, code, message))
	}

	job := h.getJob(conversationID)
	if job == nil {
		refuse(errCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}
	if !h.mayAct(conversationID, id) {
		logClaudeWS.Warn("between refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "owner", job.owner)
		h.emitFor(conversationID, "", errorFrame(conversationID, errCodeNotPermitted,
			"This turn was started by another user."))
		return
	}
	// The driver rechecks liveness: the turn can settle after this snapshot.
	job.mu.Lock()
	settled := job.isDone
	driver := job.driver
	job.mu.Unlock()
	if settled || driver == nil {
		refuse(errCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}

	if err := driver.Say(text); err != nil {
		logClaudeWS.Warn("between could not be said into the turn",
			"user", id.User, "conversation", conversationID, "turn", job.turnID, "error", err)
		refuse(errCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}

	// Snapshot the reply position when filing the interruption in the transcript.
	job.mu.Lock()
	landed := len(job.blocks)
	job.mu.Unlock()
	after := landed

	// Record before announcing. If recording fails, only log: the agent already received the message,
	// so refusing it would falsely report non-delivery.
	if h.store != nil {
		if _, err := h.store.appendAndUpdate(conversationID,
			conversationRecord{Role: roleUser, Text: text, TurnID: job.turnID,
				Between: true, AfterBlocks: &after}, nil); err != nil {
			logClaudeWS.Error("cannot record a between",
				"conversation", conversationID, "turn", job.turnID, "error", err)
		}
	}

	job.mu.Lock()
	job.betweens = append(job.betweens, text)
	job.mu.Unlock()

	logClaudeWS.Info("between sent",
		"user", id.User, "socket", socketID(c), "conversation", conversationID,
		"turn", job.turnID, "chars", len(text))
	h.emit(job, map[string]any{"type": "between", "text": text})
}

const betweenNoTurnMessage = "No turn is running in this conversation, so nothing was said into it. " +
	"Your message is back in the box — send it again and it starts a turn of its own."

// reserveTurn checks capacity and installs the job atomically so concurrent prompts cannot both spawn.
// Busy conversations are refused; replacing a turn would interrupt a durable prompt without consent.
// An empty code means success.
func (h *ClaudeHub) reserveTurn(job *claudeJob) (string, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.shuttingDown {
		return errCodeSpawnFailed, "The service is shutting down; no turn was started."
	}

	if existing := h.jobs[job.conversationID]; existing != nil {
		existing.mu.Lock()
		running := !existing.isDone || existing.processPending
		existing.mu.Unlock()
		if running {
			return errCodeConversationBusy,
				"This conversation is already working on a message; wait for it, or stop it first."
		}
	}
	active := 0
	for _, other := range h.jobs {
		other.mu.Lock()
		done := other.isDone && !other.processPending
		other.mu.Unlock()
		if !done {
			active++
		}
	}
	if active >= h.maxTurns {
		return errCodeTooManyTurns, fmt.Sprintf(
			"Claude is already running %d turns at once; wait for one to finish.", h.maxTurns)
	}
	h.jobs[job.conversationID] = job
	return "", ""
}

// finishTurn records and settles once, whether stop or agent exit wins.
// Reply blocks stay in memory until settlement.
// Write before done/stopped triggers a client REST read; announceSettled follows that frame.
// Keep the job until TTL eviction so a subscribe racing the REST read can still recover the outcome.
func (h *ClaudeHub) finishTurn(job *claudeJob, exitCode int, interrupted bool) (conversationMeta, bool) {
	job.mu.Lock()
	if job.isDone {
		job.mu.Unlock()
		return conversationMeta{}, false
	}
	// Waiters wake only after the transcript write, on every return path.
	defer job.markSettled()
	job.isDone = true
	job.exitCode = exitCode
	job.interrupted = interrupted
	job.finishedAt = time.Now()
	// Stop countdowns and retain unanswered asks as cancelled for transcript replay.
	for _, perm := range job.pending {
		if perm.timer != nil {
			perm.timer.Stop()
		}
		by := "end"
		if interrupted {
			by = "stop"
		}
		job.askHistory = append(job.askHistory, askFromPerm(perm, askOutcomeCancelled, by, nil))
	}
	job.pending = nil
	// Abandon remaining background work so sync cannot replay it as still running.
	job.background = settleBackground(job.background)
	blocks := make([]conversationBlock, 0, len(job.blocks))
	for _, block := range job.blocks {
		blocks = append(blocks, blockToRecord(block))
	}
	sessionID := job.sessionID
	messageUUID := job.messageUUID
	mcpToken := job.mcpToken
	terminal := job.terminal
	usage := job.usage
	firstBlockAt := job.firstBlockAt
	failure := job.failure
	failureNotice := job.failureNotice
	asks := append([]conversationAsk{}, job.askHistory...)
	job.mu.Unlock()

	// All settlement paths revoke here once, outside job.mu to avoid nesting registry locks.
	h.turnTokens.Revoke(mcpToken)

	if h.store == nil {
		return conversationMeta{}, false
	}
	// A refused resume must clear the session so the next turn starts fresh.
	resumeLost := job.resumeFailed(exitCode, interrupted)

	// Prefer spawn/agent failure messages, then the failed reply's tail.
	// An interrupted turn needs no tail-derived reason; the flag explains its end.
	endReason := orDefault(failure, failureNotice)
	if endReason == "" && exitCode != 0 && !interrupted {
		endReason = conversationRecord{Blocks: blocks}.blockTail()
	}
	var storedUsage *conversationUsage
	if usage != nil {
		storedUsage = &conversationUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
			ReasoningTokens: usage.ReasoningTokens,
			TotalCostUSD:    usage.TotalCostUSD, Scope: usage.Scope,
		}
	}
	finishedAt := job.finishedAt
	var firstBlockMs int64
	if !firstBlockAt.IsZero() {
		firstBlockMs = firstBlockAt.Sub(job.startedAt).Milliseconds()
	}

	meta, err := h.store.appendAndUpdate(job.conversationID, conversationRecord{
		Role: roleAssistant, TurnID: job.turnID, Blocks: blocks,
		Model: job.model, Effort: job.effort, PermissionMode: job.permissionMode,
		ExitCode: &exitCode, Interrupted: interrupted, SessionAnchor: messageUUID,
		StartedAt:    job.startedAt.UTC().Format(conversationTimeFormat),
		FinishedAt:   finishedAt.UTC().Format(conversationTimeFormat),
		DurationMs:   finishedAt.Sub(job.startedAt).Milliseconds(),
		FirstBlockMs: firstBlockMs,
		EndReason:    endReason,
		Terminal:     terminal,
		Usage:        storedUsage,
		Asks:         asks,
		PlayedBy:     job.playedBy,
		AgentRef:     job.agentRef,
		RunID:        job.runID,
		FlowNodeID:   job.flowNodeID,
		Board:        job.board,
	}, func(stored *conversationMeta) {
		stored.RunningAt, stored.RunningTurn = "", ""
		stored.LastExitCode = &exitCode
		switch {
		case resumeLost:
			// Clear fork state with a lost parent session; the next turn must start fresh.
			stored.SessionID, stored.SessionLost = "", true
			stored.ForkPending, stored.ForkAnchor = false, ""
		case sessionID != "":
			stored.SessionID, stored.SessionLost = sessionID, false
		}
	})
	if err != nil {
		logConv.Warn("cannot record a finished turn",
			"conversation", job.conversationID, "turn", job.turnID, "error", err)
		return conversationMeta{}, false
	}
	if resumeLost {
		logClaudeWS.Warn("the agent's session could not be resumed",
			"conversation", job.conversationID, "turn", job.turnID, "exit_code", exitCode)
		if lost, err := h.store.appendAndUpdate(job.conversationID,
			conversationRecord{Role: roleNotice, TurnID: job.turnID, Text: sessionLostNotice}, nil); err == nil {
			meta = lost
		}
	}
	return meta, true
}

// failTurn writes the transcript before reporting failure, as for all turn endings.
// Use emit's gate: a stop may have settled the job while startTurn was assembling the run.
func (h *ClaudeHub) failTurn(job *claudeJob, message string) {
	job.mu.Lock()
	job.failure = message
	job.mu.Unlock()
	meta, recorded := h.finishTurn(job, -1, true)
	h.emit(job, errorFrame(job.conversationID, errCodeSpawnFailed, message))
	h.announceSettled(meta, recorded)
}

// announceSettled broadcasts registry state after the turn's own settling frame.
func (h *ClaudeHub) announceSettled(meta conversationMeta, recorded bool) {
	if !recorded {
		return
	}
	h.broadcastRegistry(h.conversationFrame(meta))
}

// resumeFailed identifies an agent's non-zero exit before any session announcement.
// Exclude stops and spawn failures: they also use exit -1 without implying session loss.
func (job *claudeJob) resumeFailed(exitCode int, interrupted bool) bool {
	if interrupted {
		return false
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	return job.resumed && exitCode != 0 && !job.sawSession
}

func (h *ClaudeHub) conversationFrame(meta conversationMeta) map[string]any {
	return map[string]any{
		"type":           "conversation",
		"conversationId": meta.ID,
		"conversation":   conversationDtoOf(meta, h.isRunning(meta.ID)),
	}
}

// consume is the sole stream consumer and appends blocks/asks in agent order.
// The stream always ends in agentDone.
func (h *ClaudeHub) consume(job *claudeJob, driver AgentDriver) {
	defer job.releaseProcess()
	for event := range driver.Events() {
		h.apply(job, event)
	}
	// Close only after the stream ends; stopped drivers may still write after finishTurn.
	job.endTrace("")
}

func (job *claudeJob) releaseProcess() {
	job.mu.Lock()
	job.processPending = false
	job.mu.Unlock()
}

// endTrace takes the handle under lock so repeated closes are harmless.
func (job *claudeJob) endTrace(note string) {
	job.mu.Lock()
	trace := job.trace
	job.trace = nil
	job.mu.Unlock()
	if trace == nil {
		return
	}
	trace.note(note)
	trace.close()
}

func (h *ClaudeHub) apply(job *claudeJob, event AgentEvent) {
	switch event.Kind {
	case agentBlock:
		h.applyBlock(job, event)
	case agentAsk:
		h.applyAsk(job, event.Ask)
	case agentWithdraw:
		h.cancelPermission(job, event.AskID)
	case agentSession:
		h.applySession(job, event.SessionID)
	case agentFailure:
		job.mu.Lock()
		job.failureNotice = event.Message
		job.mu.Unlock()
		// Credential failures use a separate code so the client can offer sign-in.
		code := errCodeCLIError
		if event.AuthRequired {
			code = errCodeNotSignedIn
		}
		h.emit(job, errorFrame(job.conversationID, code, event.Message))
	case agentNotice:
		// Transient notices are displayed without becoming model speech or a failure record.
		if event.Message != "" {
			h.emit(job, map[string]any{"type": "notice", "text": event.Message})
		}
	case agentToolResult:
		h.applyToolResult(job, event)
	case agentUsage:
		if event.Usage != nil {
			job.mu.Lock()
			job.usage = event.Usage
			job.mu.Unlock()
		}
	case agentBackground:
		h.applyBackground(job, event)
	case agentDone:
		h.applyDone(job, event)
	}
}

// Replace the entire background roster, but ignore late events after settlement
// so abandoned work cannot become running again.
func (h *ClaudeHub) applyBackground(job *claudeJob, event AgentEvent) {
	job.mu.Lock()
	if job.isDone {
		job.mu.Unlock()
		return
	}
	job.background = event.Background
	job.mu.Unlock()
	h.emit(job, map[string]any{"type": "background", "tasks": wireBackground(event.Background)})
}

// Persist the session immediately so a killed service can resume it after sweepInterrupted,
// instead of silently starting fresh. finishTurn alone cannot cover a mid-turn shutdown.
func (h *ClaudeHub) applySession(job *claudeJob, sessionID string) {
	job.mu.Lock()
	fresh := job.sessionID != sessionID
	job.sessionID = sessionID
	// The announced id is the fork's own. Clear the marker even if unchanged,
	// otherwise every subsequent turn would fork again.
	forking := job.forkPending
	job.forkPending = false
	// Even an unchanged announcement rules out the refused-resume diagnosis.
	job.sawSession = true
	job.mu.Unlock()

	if (fresh || forking) && h.store != nil {
		if _, err := h.store.update(job.conversationID, func(stored *conversationMeta) {
			stored.SessionID, stored.SessionLost = sessionID, false
			stored.ForkPending, stored.ForkAnchor = false, ""
		}); err != nil {
			logConv.Warn("cannot record the agent's session",
				"conversation", job.conversationID, "turn", job.turnID, "error", err)
		}
	}
	h.emit(job, map[string]any{"type": "session", "sessionId": sessionID})
}

// applyBlock appends blocks in agent order. Each block arrives once; tool results may arrive later.
func (h *ClaudeHub) applyBlock(job *claudeJob, event AgentEvent) {
	block := event.Block
	if block.at.IsZero() {
		block.at = time.Now()
	}
	job.mu.Lock()
	index := len(job.blocks)
	if job.firstBlockAt.IsZero() {
		job.firstBlockAt = block.at
	}
	job.blocks = append(job.blocks, block)
	// The last message id is the resume anchor for a later fork.
	if event.MessageID != "" {
		job.messageUUID = event.MessageID
	}
	job.mu.Unlock()

	if block.kind == blockKindToolUse {
		logClaudeWS.Info("tool use",
			"user", job.owner, "conversation", job.conversationID, "turn", job.turnID,
			"tool", block.name, "block", index)
	}
	h.emit(job, blockFrame(index, block))
}

// Match a result to the last tool block with that id. Log/drop unmatched results; do not invent calls.
func (h *ClaudeHub) applyToolResult(job *claudeJob, event AgentEvent) {
	if event.ToolUseID == "" {
		return
	}
	arrived := time.Now()
	job.mu.Lock()
	defer job.mu.Unlock()
	for i := len(job.blocks) - 1; i >= 0; i-- {
		block := &job.blocks[i]
		if block.kind != blockKindToolUse || block.toolUseID != event.ToolUseID {
			continue
		}
		block.result = event.ToolResult
		block.isError = event.ToolIsError
		block.exitCode = event.ToolExitCode
		block.durationMs = event.ToolDurationMs
		if block.durationMs == 0 && !block.at.IsZero() {
			block.durationMs = arrived.Sub(block.at).Milliseconds()
		}
		return
	}
	logClaudeWS.Warn("tool result for a call this turn never made",
		"conversation", job.conversationID, "turn", job.turnID, "tool_use_id", event.ToolUseID)
}

func (h *ClaudeHub) applyDone(job *claudeJob, event AgentEvent) {
	exitCode := event.ExitCode
	logClaudeWS.Info("process finished",
		"user", job.owner, "conversation", job.conversationID, "turn", job.turnID,
		"exit_code", exitCode, "terminal", event.Terminal)
	if event.Terminal != "" {
		job.mu.Lock()
		job.terminal = event.Terminal
		job.mu.Unlock()
	}

	meta, recorded := h.finishTurn(job, exitCode, false)
	// emit suppresses done after a stopped turn; never send a second settling frame.
	h.emit(job, map[string]any{"type": "done", "exitCode": exitCode})
	h.announceSettled(meta, recorded)
}

// blockFrame sends text/thinking as deltas, including empty redacted thinking,
// so live clients create the same blocks that sync and transcripts retain.
func blockFrame(index int, block turnBlock) map[string]any {
	if block.kind == blockKindSubagent {
		frame := map[string]any{"type": "subagent", "index": index,
			"kind": blockKindSubagent, "text": block.text}
		if block.subagent != nil {
			frame["subagent"] = wireSubagent(block.subagent)
		}
		return frame
	}
	if block.kind == blockKindToolUse {
		frame := map[string]any{"type": "tool_use", "index": index, "name": block.name}
		if block.input != "" {
			frame["input"] = block.input
		}
		if block.detail != "" {
			frame["detail"] = block.detail
		}
		// Inline results travel with their calls. Later Claude results update the transcript only;
		// sync repairs live clients without a second tool_use frame.
		if block.toolUseID != "" {
			frame["toolUseId"] = block.toolUseID
		}
		if block.result != "" {
			frame["result"] = block.result
		}
		if block.isError {
			frame["isError"] = true
		}
		if block.exitCode != nil {
			frame["exitCode"] = *block.exitCode
		}
		return frame
	}
	return map[string]any{"type": "output", "index": index, "kind": block.kind, "data": block.text}
}

func (h *ClaudeHub) applyAsk(job *claudeJob, ask *AgentAsk) {
	if ask == nil || ask.ID == "" {
		return
	}

	// Bypass still needs an ask channel for questions; allow other asks immediately.
	if !ask.isQuestion() && job.permissionMode == permissionModeBypass {
		logClaudeWS.Info("permission auto-allowed in bypass mode",
			"conversation", job.conversationID, "turn", job.turnID, "request", ask.ID, "tool", ask.Tool)
		job.recordAsk(conversationAsk{
			ID: ask.ID, Tool: ask.Tool, DisplayName: ask.DisplayName,
			Description: ask.Description, Input: ask.InputSummary,
			Outcome: askOutcomeAllow, DecidedBy: "bypass", At: nowConversationTime(),
		})
		h.answerAsk(job, ask.ID, AskDecision{Allow: true, Input: ask.Input})
		return
	}

	perm := &claudePermission{
		requestID: ask.ID, input: ask.Input, questions: ask.Questions, questionKeys: ask.QuestionKeys,
	}
	if perm.isQuestion() {
		perm.message = map[string]any{
			"type":      "question_request",
			"requestId": ask.ID,
			"toolName":  ask.Tool,
			"questions": ask.Questions,
		}
	} else {
		perm.message = map[string]any{
			"type":      "permission_request",
			"requestId": ask.ID,
			"toolName":  ask.Tool,
		}
		if ask.DisplayName != "" {
			perm.message["displayName"] = ask.DisplayName
		}
		if ask.Description != "" {
			perm.message["description"] = ask.Description
		}
		if ask.InputSummary != "" {
			perm.message["input"] = ask.InputSummary
		}
	}
	if ask.ToolUseID != "" {
		perm.message["toolUseId"] = ask.ToolUseID
	}

	// The server's manualLive deadline travels on the frame so all tabs share one countdown.
	live := !perm.isQuestion() && job.permissionMode == permissionModeManualLive
	if live {
		perm.message["decideAt"] = time.Now().Add(h.autoAllowDelay).UnixMilli()
	}

	job.mu.Lock()
	job.pending = append(job.pending, perm)
	if live {
		perm.timer = time.AfterFunc(h.autoAllowDelay, func() { h.autoAllow(job, ask.ID) })
	}
	job.mu.Unlock()

	asked := "permission requested"
	if perm.isQuestion() {
		asked = "question asked"
	}
	logClaudeWS.Info(asked,
		"user", job.owner, "conversation", job.conversationID, "turn", job.turnID,
		"request", ask.ID, "tool", ask.Tool,
		"subscribers", h.subscriberCount(job.conversationID))
	// Clone: emit mutates maps and sync reuses the retained one.
	h.emit(job, cloneFrame(perm.message))
}

func (h *ClaudeHub) handlePermissionDecision(c *wsConn, id core.Identity, msg wsIncoming) {
	conversationID := msg.ConversationID
	if msg.Behavior != "allow" && msg.Behavior != "deny" {
		logClaudeWS.Warn("unknown permission behavior", "user", id.User, "socket", socketID(c),
			"conversation", conversationID, "request", msg.RequestID, "behavior", msg.Behavior)
		return
	}
	job, perm := h.pendingAsk(c, id, msg, false)
	if job == nil {
		return
	}

	decision := AskDecision{
		Allow: msg.Behavior == "allow",
		Input: perm.input,
	}
	if !decision.Allow {
		decision.Message = orDefault(msg.Message, "The user denied this tool call.")
	}
	logClaudeWS.Info("permission decided",
		"decided_by", id.User, "conversation", conversationID, "turn", job.turnID,
		"request", msg.RequestID, "tool", perm.message["toolName"], "behavior", msg.Behavior)
	outcome := askOutcomeDeny
	if decision.Allow {
		outcome = askOutcomeAllow
	}
	job.recordAsk(askFromPerm(perm, outcome, orDefault(id.User, "user"), nil))
	h.answerAsk(job, perm.requestID, decision)
	h.notifyPermissionResolved(job, perm.requestID, msg.Behavior)
}

// autoAllow runs even without subscribers. Taking the ask atomically makes a concurrent
// human decision and the countdown mutually exclusive.
func (h *ClaudeHub) autoAllow(job *claudeJob, requestID string) {
	perm := job.takeAsk(requestID, false)
	if perm == nil {
		return
	}
	logClaudeWS.Info("permission allowed by the countdown",
		"conversation", job.conversationID, "turn", job.turnID, "request", requestID,
		"tool", perm.message["toolName"], "after", h.autoAllowDelay)
	job.recordAsk(askFromPerm(perm, askOutcomeAllow, "countdown", nil))
	h.answerAsk(job, requestID, AskDecision{Allow: true, Input: perm.input})
	h.notifyPermissionResolved(job, requestID, "allow")
}

// handleQuestionAnswer returns an allow with answers keyed by exact question text.
// Omit blanks: a missing key means unanswered; an empty entry is still an answer to the tool.
// Questions are never auto-answered, in any mode; dismissal sends an empty answer map.
func (h *ClaudeHub) handleQuestionAnswer(c *wsConn, id core.Identity, msg wsIncoming) {
	job, perm := h.pendingAsk(c, id, msg, true)
	if job == nil {
		return
	}

	answers := map[string]any{}
	annotations := map[string]any{}
	filed := map[string]string{}
	for i, key := range perm.questionKeys {
		if i >= len(msg.Answers) {
			break
		}
		answer := strings.TrimSpace(msg.Answers[i])
		if answer == "" {
			continue
		}
		answers[key] = answer
		filed[key] = cutRunes(answer, maxPermissionInputChars)
		// Return the chosen option's preview too; the tool only shows it to the model when supplied.
		if preview := selectedPreview(perm.questions[i], answer); preview != "" {
			annotations[key] = map[string]any{"preview": preview}
		}
	}

	// Clone the original schema-valid input, not the trimmed display frame.
	input, _ := perm.input.(map[string]any)
	updated := cloneFrame(input)
	updated["answers"] = answers
	if len(annotations) > 0 {
		updated["annotations"] = annotations
	}

	logClaudeWS.Info("question answered",
		"answered_by", id.User, "conversation", msg.ConversationID, "turn", job.turnID,
		"request", msg.RequestID, "questions", len(perm.questions), "answers", len(answers))
	job.recordAsk(askFromPerm(perm, askOutcomeAllow, orDefault(id.User, "user"), filed))
	h.answerAsk(job, perm.requestID, AskDecision{Allow: true, Input: updated})
	h.notifyPermissionResolved(job, perm.requestID, "allow")
}

// selectedPreview returns no preview for unmatched/free-text or multi-select answers.
func selectedPreview(question map[string]any, answer string) string {
	options, _ := question["options"].([]map[string]any)
	for _, option := range options {
		if asString(option["label"]) == answer {
			return asString(option["preview"])
		}
	}
	return ""
}

// pendingAsk checks ownership and atomically removes an ask of the correct kind.
// Only the first answer may reach the agent; crossed question/permission answers are refused.
func (h *ClaudeHub) pendingAsk(c *wsConn, id core.Identity, msg wsIncoming, question bool) (*claudeJob, *claudePermission) {
	conversationID := msg.ConversationID
	job := h.getJob(conversationID)
	if job == nil {
		logClaudeWS.Warn("answer for a conversation with no turn",
			"user", id.User, "socket", socketID(c), "conversation", conversationID)
		return nil, nil
	}
	if !h.mayAct(conversationID, id) {
		logClaudeWS.Warn("answer refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "owner", job.owner)
		h.emitFor(conversationID, "", errorFrame(conversationID, errCodeNotPermitted,
			"This turn was started by another user."))
		return nil, nil
	}
	perm := job.takeAsk(msg.RequestID, question)
	if perm == nil {
		logClaudeWS.Warn("answer for unknown request",
			"user", id.User, "conversation", conversationID, "request", msg.RequestID, "question", question)
		return nil, nil
	}
	return job, perm
}

// Answer errors are logged: an agent that stopped listening has already ended its turn.
func (h *ClaudeHub) answerAsk(job *claudeJob, requestID string, decision AskDecision) {
	driver := job.agent()
	if driver == nil {
		logClaudeWS.Warn("no agent to answer",
			"conversation", job.conversationID, "request", requestID)
		return
	}
	if err := driver.Answer(requestID, decision); err != nil {
		logClaudeWS.Warn("answering the agent failed",
			"conversation", job.conversationID, "request", requestID, "error", err)
	}
}

// The driver may be nil while spawn has not yet published it.
func (job *claudeJob) agent() AgentDriver {
	job.mu.Lock()
	defer job.mu.Unlock()
	return job.driver
}

func (h *ClaudeHub) cancelPermission(job *claudeJob, requestID string) {
	if requestID == "" {
		return
	}
	if perm := job.takeWithdrawn(requestID); perm != nil {
		logClaudeWS.Info("permission request withdrawn",
			"conversation", job.conversationID, "request", requestID)
		job.recordAsk(askFromPerm(perm, askOutcomeCancelled, "agent", nil))
		h.notifyPermissionResolved(job, requestID, "cancelled")
	}
}

// recordAsk retains settled asks for the transcript.
func (job *claudeJob) recordAsk(ask conversationAsk) {
	if ask.At == "" {
		ask.At = nowConversationTime()
	}
	job.mu.Lock()
	job.askHistory = append(job.askHistory, ask)
	job.mu.Unlock()
}

// Copy questions because the original frame remains the turn's to emit.
func askFromPerm(perm *claudePermission, outcome, decidedBy string, answers map[string]string) conversationAsk {
	var questions []map[string]any
	for _, question := range perm.questions {
		questions = append(questions, cloneFrame(question))
	}
	return conversationAsk{
		ID:          perm.requestID,
		Tool:        orDefault(asString(perm.message["toolName"]), "tool"),
		DisplayName: asString(perm.message["displayName"]),
		Description: asString(perm.message["description"]),
		Input:       asString(perm.message["input"]),
		Questions:   questions,
		Answers:     answers,
		Outcome:     outcome,
		DecidedBy:   decidedBy,
		At:          nowConversationTime(),
	}
}

// Notify all subscribers so other tabs also remove the resolved ask.
func (h *ClaudeHub) notifyPermissionResolved(job *claudeJob, requestID, outcome string) {
	h.emit(job, map[string]any{
		"type": "permission_resolved", "requestId": requestID, "outcome": outcome,
	})
}

// takeAsk atomically removes only the expected kind: a permission decision must never
// allow a question's tool without collecting its answers.
func (job *claudeJob) takeAsk(requestID string, question bool) *claudePermission {
	return job.takeMatching(func(perm *claudePermission) bool {
		return perm.requestID == requestID && perm.isQuestion() == question
	})
}

// Withdrawals name only an id and can remove either kind of ask.
func (job *claudeJob) takeWithdrawn(requestID string) *claudePermission {
	return job.takeMatching(func(perm *claudePermission) bool { return perm.requestID == requestID })
}

func (job *claudeJob) takeMatching(match func(*claudePermission) bool) *claudePermission {
	job.mu.Lock()
	defer job.mu.Unlock()
	for i, perm := range job.pending {
		if match(perm) {
			job.pending = append(job.pending[:i], job.pending[i+1:]...)
			// Removal prevents double answers; stopping the timer releases its reference to the job.
			if perm.timer != nil {
				perm.timer.Stop()
			}
			return perm
		}
	}
	return nil
}

func (h *ClaudeHub) handleStop(c *wsConn, id core.Identity, msg wsIncoming) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		return
	}
	if !h.mayAct(conversationID, id) {
		logClaudeWS.Warn("stop refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID)
		h.emitFor(conversationID, "", errorFrame(conversationID, errCodeNotPermitted,
			"This turn was started by another user."))
		return
	}
	h.stopProcess(conversationID, id.User)
}

// Mark superseded before stopping the driver so its draining consumer cannot emit stale output.
func (h *ClaudeHub) stopProcess(conversationID, requestedBy string) bool {
	job := h.getJob(conversationID)
	if job == nil {
		return false
	}
	job.mu.Lock()
	if job.isDone {
		job.mu.Unlock()
		return false
	}
	job.superseded = true
	driver := job.driver
	job.mu.Unlock()

	logClaudeWS.Info("turn stopped",
		"requested_by", requestedBy, "conversation", conversationID, "turn", job.turnID,
		"owner", job.owner, "agent", driver != nil)
	if driver != nil {
		driver.Stop()
	}
	meta, recorded := h.finishTurn(job, -1, true)
	// emitFinal bypasses superseded but still waits for any frame already being written.
	h.emitFinal(job, map[string]any{"type": "stopped"})
	h.announceSettled(meta, recorded)
	// Pause the chain at its current node rather than advancing after a chat stop.
	// Notify after settlement, which the runner is waiting on.
	if h.chainRunner != nil {
		h.chainRunner.turnStopped(conversationID)
	}
	return true
}

// mayAct restricts turn actions to its owner without restricting subscriptions.
// Empty owner/caller permits debug auth mode.
func (h *ClaudeHub) mayAct(conversationID string, id core.Identity) bool {
	job := h.getJob(conversationID)
	if job == nil {
		return true
	}
	if job.owner == "" || id.User == "" {
		return true
	}
	return job.owner == id.User
}

// Disconnect only drops subscriptions and the socket; turns and pending asks survive it.
func (h *ClaudeHub) afterConnectionClosed(c *wsConn, id core.Identity) {
	dropped := h.unsubscribeAll(c)
	h.dropConn(c)
	logClaudeWS.Info("disconnected",
		"user", id.User, "socket", c.id, "conversations", len(dropped))
	c.close()
}

func (h *ClaudeHub) janitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-h.janitorStop:
			return
		case now := <-ticker.C:
			h.sweepExpiredJobs(now)
		}
	}
}

// Evict only settled turns older than jobTTL; never evict running turns.
func (h *ClaudeHub) sweepExpiredJobs(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conversationID, job := range h.jobs {
		job.mu.Lock()
		expired := job.isDone && !job.processPending && now.Sub(job.finishedAt) > h.jobTTL
		job.mu.Unlock()
		if expired {
			logClaudeWS.Info("turn evicted", "conversation", conversationID)
			delete(h.jobs, conversationID)
		}
	}
}

func (h *ClaudeHub) activeTurnCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, job := range h.jobs {
		job.mu.Lock()
		done := job.isDone && !job.processPending
		job.mu.Unlock()
		if !done {
			n++
		}
	}
	return n
}

// Live status comes only from the job. Disk metadata records starts for restart recovery,
// not proof that a turn is still running.
func (h *ClaudeHub) isRunning(conversationID string) bool {
	job := h.getJob(conversationID)
	if job == nil {
		return false
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	return !job.isDone
}

// shutdown drops the registry and stops the janitor and drivers. Leave conversation
// metadata for sweepInterrupted at startup; writing records here would race the shutdown deadline.
func (h *ClaudeHub) shutdown() {
	h.stopOnce.Do(func() { close(h.janitorStop) })
	h.mu.Lock()
	h.shuttingDown = true
	jobs := make([]*claudeJob, 0, len(h.jobs))
	for _, job := range h.jobs {
		job.mu.Lock()
		// A driver still in Spawn must be stopped as soon as it returns, too.
		job.superseded = true
		job.mu.Unlock()
		jobs = append(jobs, job)
	}
	h.jobs = map[string]*claudeJob{}
	h.mu.Unlock()

	for _, job := range jobs {
		if driver := job.agent(); driver != nil {
			logClaudeWS.Info("shutdown kill",
				"conversation", job.conversationID, "turn", job.turnID)
			driver.Stop()
		}
	}
}

func (h *ClaudeHub) getJob(conversationID string) *claudeJob {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.jobs[conversationID]
}

func (h *ClaudeHub) putJob(conversationID string, job *claudeJob) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.jobs[conversationID] = job
}

func (h *ClaudeHub) removeJob(conversationID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.jobs, conversationID)
}

func socketID(c *wsConn) string {
	if c == nil {
		return "-"
	}
	return c.id
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
