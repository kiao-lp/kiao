package turns

import (
	"encoding/base64"
	"errors"
	"fmt"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/errors"
	idgen "kiao/worker/internal/core/ids"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Engine owns the turns behind /ws/hybridflow-runner, using AgentDriver for agent operations.
// The agent and folder are bound to the conversation, never chosen by a prompt.
//
// A socket multiplexes subscriptions; turns and pending asks outlive disconnected sockets.
// Protocol changes must update PROTOCOL.md and ClaudeClientMessage / ClaudeServerMessage
// in reference/kiao-worker/src/agent-types.ts, and bump AgentProtocolVersion.
type Engine struct {
	*turnevents.Subscriptions
	cfg *runnerconfig.Config

	// store is fixed at construction; nil is supported in tests and refuses prompts.
	store *conversations.ConversationStore

	// agents holds the deployment's agents and defaults; tests can substitute drivers.
	Agents *agentapi.AgentRegistry

	// mu guards jobs, subs and conns together. Lock order: h.mu → job.mu.
	// The emit path releases job.mu before taking h.mu to fan out.
	Mu   *sync.Mutex
	Jobs map[string]*Turn // conversationId → its running turn, or the last one until swept
	// Reject reservations once shutdown starts, including requests already validating.
	shuttingDown bool

	JobTTL time.Duration
	// autoAllowDelay is configurable here so tests need not wait ten seconds.
	AutoAllowDelay time.Duration
	MaxTurns       int
	janitorStop    chan struct{}
	stopOnce       sync.Once

	// turnTokens authenticates callbacks from bundled MCP servers; bundledNames identifies them.
	TurnTokens   *access.TurnTokenRegistry
	BundledNames map[string]bool

	// registry is queried at each spawn so toolbox installs reach the next turn. Nil means no servers.
	Registry agentapi.MCPRegistry

	// attachments resolves uploaded ids to host files. Nil refuses prompts with attachments.
	Attachments *conversations.AttachmentStore

	// chainRunner supplies hello's run snapshots and receives chat stops. May be nil.
	ChainRunner RunObserver
}

// Retain settled turns to close the gap between a REST read and a socket subscribe.
const defaultJobTTL = 30 * time.Minute

// Fallback for hand-built configs; Config.Validate requires a positive cap.
const defaultMaxTurns = 4

const janitorInterval = 5 * time.Minute

// Bump whenever a frame's shape changes; clients with a different version must reload.
const AgentProtocolVersion = 20

// ClaudeAutoAllowDelay applies only to manualLive permissions, never questions.
// The server owns the countdown so it runs without a browser; decideAt tells clients the deadline.
// The seconds live in `.kiao-config/conversations.json` under `manualLiveCountdownSeconds`,
// seeded with this default when missing; see manual_live.go.
const ClaudeAutoAllowDelay = 10 * time.Second

// A lost-session notice is not a model reply; retained history is no longer model context.
const sessionLostNotice = "The Claude session for this conversation has expired. " +
	"The next message starts a new session — the history above is kept for reading, " +
	"but Claude will not remember it."

func NewEngine(cfg *runnerconfig.Config, store *conversations.ConversationStore, registry *agentapi.AgentRegistry) *Engine {
	maxTurns := cfg.MaxTurns
	if maxTurns < 1 {
		// Zero means unset, not "refuse every turn".
		maxTurns = defaultMaxTurns
	}
	mu := &sync.Mutex{}
	h := &Engine{
		Mu: mu, Subscriptions: turnevents.NewSubscriptions(mu),
		cfg:            cfg,
		store:          store,
		Agents:         registry,
		Jobs:           map[string]*Turn{},
		JobTTL:         defaultJobTTL,
		AutoAllowDelay: manualLiveDelay(cfg),
		MaxTurns:       maxTurns,
		TurnTokens:     access.NewTurnTokenRegistry(),
		janitorStop:    make(chan struct{}),
	}
	go h.janitor(janitorInterval)
	return h
}

// Turn retains execution state; subscriptions belong to the engine and outlive individual turns.
type Turn struct {
	InstallationID string
	profileID      string
	execution      *turntrace.AgentTurnExecution
	queue          []agentapi.AgentQueuedMessage
	stopRequested  bool
	ConversationID string
	TurnID         string
	Owner          string
	Folder         string // normalised virtual folder; "" is the store root
	workDir        string // absolute, symlink-resolved cwd handed to the agent
	PromptText     string // the user's prompt verbatim, for `sync` and the transcript record
	Model          string
	effort         string
	PermissionMode string
	thinking       bool
	// agentName comes from the conversation, never the request.
	AgentName string
	// resumed records whether the turn was spawned with --resume.
	Resumed   bool
	StartedAt time.Time
	// These are the actual composed prompt, system briefing and standing orders sent to the model;
	// file them beside the user's verbatim prompt for transcript auditing.
	composedPrompt string
	systemPrompt   string
	instructions   string
	// Play context from the runner, recorded with both prompt and reply; empty for chat turns.
	playedBy     string
	agentRef     string
	agentVersion int64
	RunID        string
	FlowNodeID   string
	Board        string

	// mcpToken is minted before spawn and revoked by finishTurn on every settlement path.
	mcpToken string

	// emitMu serialises the superseded check and fan-out so stopped is the final frame.
	// Checking under mu alone allows a frame to pass the check and arrive after stopped.
	// Lock order: emitMu → mu or Engine.mu; never acquire emitMu while holding either.
	emitMu sync.Mutex

	// settled closes after the transcript write so in-process waiters can immediately read the reply.
	Settled    chan struct{}
	settleOnce sync.Once

	Mu sync.Mutex
	// trace closes when the driver's stream ends, not in finishTurn: after a stop,
	// driver goroutines may still write stderr and protocol frames. Nil if no trace was opened.
	trace *turntrace.TurnTrace
	// driver is published only after spawn succeeds. A stop before publication settles the job;
	// startTurn must then stop the newly spawned driver. processPending keeps the
	// reservation until Spawn fails or the driver's event stream has fully closed.
	Driver         agentapi.AgentDriver
	ProcessPending bool
	SessionID      string
	// forkPending is cleared when the agent announces the branched session id; guarded by mu.
	forkPending bool
	// For a resumed, uninterrupted turn, non-zero exit before any session announcement implies session loss.
	SawSession bool
	// messageUUID is the last agent message id, recorded as SessionAnchor for a later fork.
	messageUUID string
	// blocks preserves agent order for sync and the transcript.
	Blocks []agentapi.TurnBlock
	// betweens holds user interruptions separately from reply blocks for sync replay;
	// subscribed tabs do not re-read the transcript until the turn ends.
	Betweens []string
	// background is a replacement roster, including finished work, replayed on sync
	// and settled at turn end.
	Background []agentapi.BackgroundTask
	Pending    []*claudePermission
	IsDone     bool
	// superseded suppresses client output while a stopped driver's stream is still draining.
	Superseded bool
	// interrupted distinguishes stop, deletion or spawn failure from an agent's own failure.
	interrupted bool
	// failureNotice holds the last agent failure event, not model speech. Guarded by mu;
	// written by the stream consumer and read by the runner after settled.
	FailureNotice string
	// failure is the spawn failure message, also exposed to in-process callers.
	failure string
	// terminal records an agent's completed/cancelled/failed status to distinguish
	// synthesised exit codes from process exits.
	Terminal string
	// usage is the agent's last cost report.
	Usage *agentapi.TurnUsage
	// Zero means no reply block arrived.
	FirstBlockAt time.Time
	// askHistory retains asks as they leave pending: answered, withdrawn or cancelled at settlement.
	AskHistory []conversations.ConversationAsk
	ExitCode   int
	FinishedAt time.Time
}

// Hand-built test jobs may omit the settle signal.
func (job *Turn) markSettled() {
	if job.Settled == nil {
		return
	}
	job.settleOnce.Do(func() { close(job.Settled) })
}

// lastFailure is separate from the reply: codex exec can report errors on its stream,
// produce no reply and exit zero. The runner uses this to avoid marking an empty answer done.
func (job *Turn) LastFailure() string {
	job.Mu.Lock()
	defer job.Mu.Unlock()
	return job.FailureNotice
}

func (job *Turn) Outcome() (interrupted bool, failure string) {
	job.Mu.Lock()
	defer job.Mu.Unlock()
	return job.interrupted, job.failure
}

// claudePermission retains an AgentAsk and its replay frame until answered or withdrawn.
type claudePermission struct {
	requestID string
	// input must remain verbatim: the agent runs updatedInput against the tool's schema,
	// so the truncated display summary cannot be returned here.
	input any
	// message is retained for sync replay while the ask is pending.
	Message map[string]any
	// Non-nil questions distinguishes a question from a permission; order matches the ask.
	questions []map[string]any
	// questionKeys preserves exact agent question texts for the answers map. The frame's
	// trimmed text cannot be used as a key or the tool treats the question as unanswered.
	questionKeys []string
	// timer auto-allows manualLive permissions; nil for questions and other modes.
	// Stop it when the ask leaves pending.
	timer *time.Timer
}

func (perm *claudePermission) IsQuestion() bool { return perm.questions != nil }

type Command struct {
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

func (msg Command) conversationIDs() []string {
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

// helloFrame describes the socket, with no conversationId.
func (h *Engine) HelloFrame(c *turnevents.Client) map[string]any {
	h.Mu.Lock()
	running := []string{}
	for conversationID, job := range h.Jobs {
		job.Mu.Lock()
		live := !job.IsDone
		job.Mu.Unlock()
		if live {
			running = append(running, conversationID)
		}
	}
	h.Mu.Unlock()
	sort.Strings(running)

	frame := map[string]any{
		"type":                 "hello",
		"protocolVersion":      AgentProtocolVersion,
		"socketId":             c.Id,
		"runningConversations": running,
		"maxConcurrentTurns":   h.MaxTurns,
		// Default agent first; capabilities are fetched separately from /hybridflow-runner/options.
		"agents": h.Agents.Names(),
	}
	if h.ChainRunner != nil {
		frame["chainRuns"] = h.ChainRunner.RunSnapshots()
	}
	return frame
}

// handleSubscribe is additive and repeatable, answering each id with sync or not_running.
// It must not evict held turns: another subscriber may still need them.
func (h *Engine) HandleSubscribe(c *turnevents.Client, id access.Identity, msg Command) {
	ids := msg.conversationIDs()
	if len(ids) == 0 {
		return
	}
	agentapi.LogClaudeWS.Info("subscribed", "user", id.User, "socket", c.Id, "conversations", len(ids))
	for _, conversationID := range ids {
		job := h.subscribe(c, conversationID)
		if job == nil {
			h.EmitTo(c, conversationID, map[string]any{"type": "not_running"})
			continue
		}
		h.EmitTo(c, conversationID, h.SyncFrame(job))
	}
}

// Unsubscribing does not stop turns.
func (h *Engine) HandleUnsubscribe(c *turnevents.Client, msg Command) {
	for _, conversationID := range msg.conversationIDs() {
		h.Unsubscribe(c, conversationID)
	}
}

// syncFrame replaces the client's current/last held turn state, including all blocks.
// Completed transcripts come from REST. Clone retained maps because emit stamps ids onto them.
func (h *Engine) SyncFrame(job *Turn) map[string]any {
	job.Mu.Lock()
	defer job.Mu.Unlock()

	blocks := make([]map[string]any, 0, len(job.Blocks))
	for _, block := range job.Blocks {
		blocks = append(blocks, agentapi.WireBlock(block))
	}
	// Replay pending asks so reconnecting clients can answer them. Keep questions separate
	// from permissions: allowing a question's tool without collecting answers loses the ask.
	pending := make([]map[string]any, 0, len(job.Pending))
	questions := make([]map[string]any, 0, len(job.Pending))
	for _, perm := range job.Pending {
		if perm.IsQuestion() {
			questions = append(questions, turnevents.CloneFrame(perm.Message))
			continue
		}
		pending = append(pending, turnevents.CloneFrame(perm.Message))
	}

	frame := map[string]any{
		"type":               "sync",
		"turnId":             job.TurnID,
		"running":            !job.IsDone,
		"userText":           job.PromptText,
		"betweens":           append([]string{}, job.Betweens...),
		"queue":              append([]agentapi.AgentQueuedMessage{}, job.queue...),
		"blocks":             blocks,
		"permissionMode":     job.PermissionMode,
		"agent":              agentapi.ResolvedAgent(job.AgentName),
		"pendingPermissions": pending,
		"pendingQuestions":   questions,
		"background":         agentapi.WireBackground(job.Background),
		"startedAt":          job.StartedAt.UnixMilli(),
	}
	if job.SessionID != "" {
		frame["sessionId"] = job.SessionID
	}
	if job.IsDone {
		frame["finishedAt"] = job.FinishedAt.UnixMilli()
		frame["exitCode"] = job.ExitCode
	}
	return frame
}

// storeRoot resolves --add-dir like the working directory. Resolve per turn because the
// root symlink may have been repointed. Failure omits the flag; folder validation normally catches it first.
func (h *Engine) storeRoot() string {
	root, err := runnerconfig.ResolveFolder(h.cfg.RootPath, "")
	if err != nil {
		agentapi.LogClaudeWS.Warn("cannot resolve the store root; the turn runs with its folder alone",
			"root", h.cfg.RootPath, "error", err)
		return ""
	}
	return root.Abs
}

// turnRequest comes from a socket or runner. Folder, session and defaults come only
// from the conversation record.
type TurnRequest struct {
	ConversationID string
	Prompt         string
	Model          string
	Effort         string
	PermissionMode string
	// instructions are managed-agent standing orders in the briefing, recorded separately
	// from the user's prompt.
	Instructions string
	// Runner-only play context: managed agent name, card's agent reference, run, flow node and board.
	// Recorded in the transcript; empty for chat turns.
	ManagedAgent string
	AgentRef     string
	RunID        string
	FlowNodeID   string
	Board        string
	// nil keeps the conversation setting; false disables extended thinking for this turn.
	thinking *bool
	// attachments are ids from POST /hybridflow-runner/attachments, in the order the user attached them.
	attachments []string
	// images are resolved store files named by a flow node's body. The prompt names their paths;
	// the transcript retains the original markdown rather than attachment records.
	Images []agentapi.PromptFile
}

func (h *Engine) HandlePrompt(c *turnevents.Client, id access.Identity, msg Command) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		// No conversation id means no route for a refusal frame.
		agentapi.LogClaudeWS.Warn("prompt without a conversation id", "user", id.User, "socket", c.Id)
		return
	}
	// Prompting subscribes, so a client cannot miss its own reply by forgetting to ask for it first.
	h.subscribe(c, conversationID)
	h.StartTurnFor(c, id, TurnRequest{
		ConversationID: conversationID,
		Prompt:         msg.Prompt,
		Model:          msg.Model,
		Effort:         msg.Effort,
		PermissionMode: msg.PermissionMode,
		thinking:       msg.Thinking,
		attachments:    msg.Attachments,
	})
}

// startTurnFor validates and spawns; c is nil for in-process callers and used only for logging.
// Validate request fields before consulting resources so capacity cannot mask malformed requests.
// Failures after recording a turn return a settled job, not a refusal.
func (h *Engine) StartTurnFor(c *turnevents.Client, id access.Identity, req TurnRequest) (*Turn, *agentfaults.TurnRefusal) {
	conversationID := strings.TrimSpace(req.ConversationID)
	refuse := func(code, message string) (*Turn, *agentfaults.TurnRefusal) {
		agentapi.LogClaudeWS.Warn("prompt refused",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "code", code)
		h.EmitFor(conversationID, "", turnevents.ErrorFrame(conversationID, code, message))
		return nil, &agentfaults.TurnRefusal{Code: code, Message: message}
	}

	// Never interpret an unknown mode as a different permission policy.
	if req.PermissionMode != "" && !runnerconfig.KnownPermissionMode(req.PermissionMode) {
		return refuse(turnevents.ErrCodeUnknownPermissionMode, "Unknown permission mode: "+req.PermissionMode)
	}
	// Check explicit deployment policy before reading the conversation; check its stored mode below.
	if !h.cfg.AllowsPermissionMode(req.PermissionMode) {
		return refuse(turnevents.ErrCodeBypassDisabled, turnevents.BypassDisabledMessage)
	}
	if len(req.attachments) > agentapi.MaxPromptAttachments {
		return refuse(turnevents.ErrCodeBadAttachment, fmt.Sprintf(
			"A message may carry at most %d attachments; this one carries %d.",
			agentapi.MaxPromptAttachments, len(req.attachments)))
	}
	if h.store == nil {
		return refuse(turnevents.ErrCodeUnknownConversation, "This service has no conversation registry.")
	}
	meta, err := h.store.Get(conversationID)
	if err != nil {
		return refuse(turnevents.ErrCodeUnknownConversation, "This conversation no longer exists.")
	}
	// Recheck stored policy so conversations cannot retain bypass after it is disabled.
	// Refuse rather than silently run a mode different from the displayed one.
	if !h.cfg.AllowsPermissionMode(protocol.OrDefault(req.PermissionMode, meta.PermissionMode)) {
		return refuse(turnevents.ErrCodeBypassDisabled, turnevents.BypassDisabledMessage)
	}
	// Sessions belong to their engine and cannot move when that agent is withdrawn.
	if !h.Agents.Known(meta.Agent) {
		return refuse(turnevents.ErrCodeUnknownAgent,
			"This conversation runs on "+protocol.OrDefault(meta.Agent, "an agent")+
				", which this service no longer offers. Fork it onto another agent to carry on.")
	}
	// Agent support is a separate gate from deployment policy: Codex cannot fulfil manual asks.
	mode := protocol.OrDefault(req.PermissionMode, protocol.OrDefault(meta.PermissionMode, h.cfg.DefaultPermissionMode()))
	if !h.Agents.PublishesMode(meta.Agent, mode) {
		return refuse(turnevents.ErrCodeModeUnsupported, agentapi.ModeUnsupportedMessage(h.Agents.Label(meta.Agent), mode))
	}
	// Re-resolve each turn: renames, deletions or symlinks outside the store must prevent spawning.
	folder, err := runnerconfig.ResolveFolder(h.cfg.RootPath, meta.Folder)
	if err != nil {
		return refuse(turnevents.ErrCodeBadFolder, "The conversation's folder is unusable: "+faults.ClientMessage(err))
	}
	// Missing attachments must refuse the turn; silently dropping them would misrepresent its context.
	attachments, err := h.ResolveAttachments(req.attachments)
	if err != nil {
		return refuse(turnevents.ErrCodeBadAttachment, err.Error())
	}

	return h.startTurn(c, id, meta, folder, req, attachments)
}

// Preserve attachment order so references such as "the first screenshot" remain meaningful.
func (h *Engine) ResolveAttachments(ids []string) ([]conversations.ClaudeAttachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if h.Attachments == nil {
		return nil, errors.New("This service stores no attachments.")
	}
	resolved := make([]conversations.ClaudeAttachment, 0, len(ids))
	for _, id := range ids {
		found, err := h.Attachments.Resolve(strings.TrimSpace(id))
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
func (h *Engine) startTurn(c *turnevents.Client, id access.Identity, meta conversations.ConversationMeta,
	folder runnerconfig.WorkingFolder, req TurnRequest, attachments []conversations.ClaudeAttachment) (*Turn, *agentfaults.TurnRefusal) {
	var version int64
	if meta.AgentVersion != nil {
		version = meta.AgentVersion.Version
		req.Model = meta.AgentVersion.ConversationModel(meta.Model)
		req.Instructions = meta.AgentVersion.Instructions
		req.ManagedAgent, req.AgentRef = meta.AgentVersion.Name, meta.AgentVersion.AgentID
	}
	// Per-turn settings become conversation defaults. Model/effort fallbacks must be agent-specific.
	defaultModel, defaultEffort := h.Agents.DefaultsFor(meta.Agent)
	model := protocol.OrDefault(req.Model, protocol.OrDefault(meta.Model, defaultModel))
	effort := protocol.OrDefault(req.Effort, protocol.OrDefault(meta.Effort, defaultEffort))
	permissionMode := protocol.OrDefault(req.PermissionMode, protocol.OrDefault(meta.PermissionMode, h.cfg.DefaultPermissionMode()))
	thinking := meta.Thinking
	if req.thinking != nil {
		thinking = *req.thinking
	}

	var pi *agentapi.PiResolvedProfile
	var nativeImages []agentapi.AgentImage
	if agentapi.ResolvedAgent(meta.Agent) == agentapi.AgentPi {
		var err error
		pi, err = h.Agents.Profiles.ResolveProfile(meta.ProfileID, model, effort)
		if err == nil {
			err = h.Agents.Profiles.ValidateTurn(pi, thinking)
		}
		if err != nil {
			message := err.Error()
			h.EmitFor(meta.ID, "", turnevents.ErrorFrame(meta.ID, "profile_unavailable", message))
			return nil, &agentfaults.TurnRefusal{Code: "profile_unavailable", Message: message}
		}
		model, effort = pi.Provider+"/"+pi.ModelID, pi.Effort
		meta.ProfileID = pi.Profile.ID
		files := append([]agentapi.PromptFile{}, req.Images...)
		for _, attachment := range attachments {
			if strings.HasPrefix(attachment.MediaType, "image/") {
				files = append(files, agentapi.PromptFile{Path: attachment.Path, MediaType: attachment.MediaType})
			}
		}
		if len(files) > 0 {
			models, _ := h.Agents.Profiles.ModelsFor(pi.Profile, pi.Installation, false)
			supported := false
			for _, candidate := range models {
				if candidate.Value == model {
					supported = candidate.Capabilities.ImageInput
				}
			}
			if !supported {
				message := "This model does not support image input"
				h.EmitFor(meta.ID, "", turnevents.ErrorFrame(meta.ID, turnevents.ErrCodeBadAttachment, message))
				return nil, &agentfaults.TurnRefusal{Code: turnevents.ErrCodeBadAttachment, Message: message}
			}
		}
		for _, file := range files {
			data, err := os.ReadFile(file.Path)
			if err != nil {
				h.EmitFor(meta.ID, "", turnevents.ErrorFrame(meta.ID, turnevents.ErrCodeBadAttachment, "An image could not be read"))
				return nil, &agentfaults.TurnRefusal{Code: turnevents.ErrCodeBadAttachment, Message: "An image could not be read"}
			}
			nativeImages = append(nativeImages, agentapi.AgentImage{Type: "image", MimeType: file.MediaType, Data: base64.StdEncoding.EncodeToString(data)})
		}
	}
	job := &Turn{
		ConversationID: meta.ID,
		profileID:      meta.ProfileID, execution: pi.Execution(),
		TurnID:         "turn-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4],
		Owner:          id.User,
		Folder:         folder.Virtual,
		workDir:        folder.Abs,
		PromptText:     req.Prompt,
		Model:          model,
		effort:         effort,
		PermissionMode: permissionMode,
		thinking:       thinking,
		AgentName:      h.Agents.Name(meta.Agent),
		instructions:   req.Instructions,
		playedBy:       req.ManagedAgent,
		agentRef:       req.AgentRef,
		agentVersion:   version,
		RunID:          req.RunID,
		FlowNodeID:     req.FlowNodeID,
		Board:          req.Board,
		Resumed:        strings.TrimSpace(meta.SessionID) != "",
		// ForkPending alone cannot branch: a parent session must also exist.
		forkPending:    meta.ForkPending && strings.TrimSpace(meta.SessionID) != "",
		StartedAt:      time.Now(),
		Settled:        make(chan struct{}),
		ProcessPending: true,
	}
	if pi != nil {
		job.InstallationID = pi.Profile.InstallationID
	}
	// Capture before publishing the job: applySession clears forkPending asynchronously.
	// The anchor only has meaning with the fork it cuts.
	forkSession, forkAnchor := job.forkPending, meta.ForkAnchor
	if code, message := h.reserveTurn(job); code != "" {
		agentapi.LogClaudeWS.Warn("turn refused",
			"user", id.User, "conversation", meta.ID, "code", code, "max_turns", h.MaxTurns)
		h.EmitFor(meta.ID, "", turnevents.ErrorFrame(meta.ID, code, message))
		return nil, &agentfaults.TurnRefusal{Code: code, Message: message}
	}

	agentapi.LogClaudeWS.Info("prompt received",
		"user", id.User, "socket", socketID(c), "conversation", meta.ID, "turn", job.TurnID,
		"agent", job.AgentName, "model", model, "effort", effort,
		"thinking", thinking, "permission_mode", permissionMode,
		"folder", folder.Virtual, "resumed", job.Resumed, "prompt_chars", len(req.Prompt),
		"attachments", len(attachments), "images", len(req.Images))

	// Compose once so the driver and transcript get the same model context.
	job.composedPrompt = PromptWithContext(req.Prompt, attachments, req.Images)
	if meta.ContextPending && meta.SessionID == "" {
		job.composedPrompt = h.ForkTranscriptContext(meta.ID) + job.composedPrompt
	}
	storeRoot := h.storeRoot()
	job.systemPrompt = briefing.AgentBriefingWith(storeRoot, req.Instructions)

	// Write the user record before spawning so sweepInterrupted always has a dangling prompt to close.
	meta, err := h.store.AppendAndUpdate(meta.ID, conversations.ConversationRecord{
		Role: conversations.RoleUser, Text: req.Prompt, TurnID: job.TurnID,
		ProfileID: job.profileID, Execution: job.execution,
		Model: model, Effort: effort, PermissionMode: permissionMode,
		Attachments:    attachmentRecords(attachments),
		ComposedPrompt: job.composedPrompt,
		SystemPrompt:   job.systemPrompt,
		Instructions:   req.Instructions,
		PlayedBy:       req.ManagedAgent,
		AgentRef:       req.AgentRef,
		AgentVersion:   version,
		RunID:          req.RunID,
		FlowNodeID:     req.FlowNodeID,
		Board:          req.Board,
	}, func(stored *conversations.ConversationMeta) {
		stored.Model, stored.Effort = model, effort
		stored.ProfileID = job.profileID
		stored.PermissionMode, stored.Thinking = permissionMode, thinking
		stored.RunningAt = protocol.NowConversationTime()
		stored.RunningTurn = job.TurnID
	})
	if err != nil {
		// No consumer will settle this unspawned job; release the reservation explicitly.
		job.releaseProcess()
		h.RemoveJob(job.ConversationID)
		agentapi.LogClaudeWS.Error("cannot record the prompt", "conversation", job.ConversationID, "error", err)
		const message = "The message could not be recorded, so no turn was started."
		h.EmitFor(job.ConversationID, "", turnevents.ErrorFrame(job.ConversationID, turnevents.ErrCodeSpawnFailed, message))
		return nil, &agentfaults.TurnRefusal{Code: turnevents.ErrCodeSpawnFailed, Message: message}
	}

	// The prompt is on record; subsequent failures must settle it through failTurn.
	failWith := func(message string, err error) (*Turn, *agentfaults.TurnRefusal) {
		defer job.releaseProcess()
		agentapi.LogClaudeWS.Error("spawn failed",
			"user", id.User, "conversation", job.ConversationID, "turn", job.TurnID, "error", err)
		// No driver stream will close this trace after a failed spawn.
		job.endTrace(message)
		h.FailTurn(job, message)
		return job, nil
	}
	fail := func(prefix string, err error) (*Turn, *agentfaults.TurnRefusal) {
		return failWith(prefix+": "+err.Error(), err)
	}

	// Resolve the agent once for MCP rendering and spawning. Query tools at spawn time;
	// rendering errors fail the turn rather than silently removing tools.
	// Agents without AgentMCP receive no servers or callback credential.
	agent := h.Agents.DriverFor(job.AgentName)

	servers := h.mcpServers()
	mcpConfig := ""
	if renderer, ok := agent.(agentapi.AgentMCP); ok {
		mcpConfig, err = renderer.RenderMCP(servers)
		if err != nil {
			return fail("The turn could not be given its tools", err)
		}
	} else {
		servers = nil
	}

	// Mint a caller-bound credential before spawn, only if bundled MCP servers need callbacks.
	if h.NeedsTurnToken(servers) {
		token, err := h.TurnTokens.Issue(id, job.ConversationID+"/"+job.TurnID)
		if err != nil {
			return fail("The turn could not be given its tools", err)
		}
		job.mcpToken = token
	}

	// Open before spawn so failures have a trace too; redact the MCP credential.
	// The driver writes runtime details; the hub closes the trace after the stream ends.
	trace := h.store.OpenTurnTrace(job.ConversationID, job.TurnID, meta.TraceStream, []string{job.mcpToken})
	job.Mu.Lock()
	job.trace = trace
	job.Mu.Unlock()
	trace.Run(turntrace.TraceRun{
		Conversation: job.ConversationID, Turn: job.TurnID,
		Agent: agentapi.ResolvedAgent(job.AgentName), Owner: job.Owner,
		ProfileID: job.profileID, Execution: job.execution,
		Folder: job.Folder, WorkDir: job.workDir, StoreRoot: storeRoot,
		Model: model, Effort: effort, PermissionMode: permissionMode, Thinking: thinking,
		AllowBypass: h.cfg.BypassEnabled,
		Session:     meta.SessionID, ForkSession: forkSession, ResumeAt: forkAnchor,
		MCPServers: turntrace.TraceMCPServers(servers), MCPConfig: mcpConfig, MCPToken: job.mcpToken != "",
		PlayedBy: req.ManagedAgent, RunID: req.RunID, FlowNodeID: req.FlowNodeID, Board: req.Board,
		AgentRef: req.AgentRef, AgentVersion: version,
	})

	run := agentapi.AgentRun{
		ProfileID: job.profileID, Pi: pi, Images: nativeImages, Compact: strings.TrimSpace(req.Prompt) == "/compact",
		Conversation: job.ConversationID, Turn: job.TurnID,
		Prompt:  job.composedPrompt,
		WorkDir: job.workDir, StoreRoot: storeRoot,
		Model: model, Effort: effort, PermissionMode: permissionMode, Thinking: thinking,
		Instructions: req.Instructions,
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
	job.Mu.Lock()
	settled := job.IsDone || job.Superseded
	stopRequested := job.stopRequested
	if !settled {
		job.Driver = driver
	}
	job.Mu.Unlock()
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

	if stopRequested {
		driver.Stop()
	}
	// Broadcast registry state before start so every tab's list already marks the conversation busy.
	h.BroadcastRegistry(h.ConversationFrame(meta))
	h.Emit(job, map[string]any{
		"type": "start", "model": job.Model, "effort": job.effort, "thinking": job.thinking,
		"permissionMode": job.PermissionMode, "agent": agentapi.ResolvedAgent(job.AgentName), "folder": job.Folder,
		"startedAt": job.StartedAt.UnixMilli(),
	})

	go h.consume(job, driver)
	return job, nil
}

// bareSlashCommand excludes arguments and prose, even if they start with a slash.
var bareSlashCommand = regexp.MustCompile(`^\s*/[A-Za-z0-9][A-Za-z0-9_:.-]*\s*$`)

// promptWithContext adds absolute paths for attachments and linked store images.
// Bare slash commands bypass notes: commands such as /compact treat appended text as arguments.
// Commands with arguments are treated as ordinary messages.
func PromptWithContext(prompt string, attachments []conversations.ClaudeAttachment, images []agentapi.PromptFile) string {
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
func attachmentRecords(attachments []conversations.ClaudeAttachment) []conversations.ConversationAttachment {
	if len(attachments) == 0 {
		return nil
	}
	records := make([]conversations.ConversationAttachment, 0, len(attachments))
	for _, att := range attachments {
		records = append(records, conversations.ConversationAttachment{
			ID: att.ID, Name: att.Name, Size: att.Size, MediaType: att.MediaType,
		})
	}
	return records
}

// handleBetween delivers into the current turn without changing its settings or starting another.
// Send before recording/echoing: unlike a new prompt, it must not claim delivery if Say fails.
// Unsendable messages are refused rather than queued; the sender can retry as a prompt.
func (h *Engine) HandleBetween(c *turnevents.Client, id access.Identity, msg Command) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		agentapi.LogClaudeWS.Warn("between without a conversation id", "user", id.User, "socket", socketID(c))
		return
	}
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		agentapi.LogClaudeWS.Warn("empty between", "user", id.User, "socket", socketID(c),
			"conversation", conversationID)
		return
	}

	// Betweens use the prompt's inbound-frame cap and normaliseRecord truncation.

	refuse := func(code, message string) {
		agentapi.LogClaudeWS.Warn("between refused",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "code", code)
		h.EmitFor(conversationID, "", turnevents.ErrorFrame(conversationID, code, message))
	}

	job := h.GetJob(conversationID)
	if job == nil {
		refuse(turnevents.ErrCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}
	if !h.mayAct(conversationID, id) {
		agentapi.LogClaudeWS.Warn("between refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "owner", job.Owner)
		h.EmitFor(conversationID, "", turnevents.ErrorFrame(conversationID, turnevents.ErrCodeNotPermitted,
			"This turn was started by another user."))
		return
	}
	// The driver rechecks liveness: the turn can settle after this snapshot.
	job.Mu.Lock()
	settled := job.IsDone
	driver := job.Driver
	job.Mu.Unlock()
	if settled || driver == nil {
		refuse(turnevents.ErrCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}

	if err := driver.Say(text); err != nil {
		agentapi.LogClaudeWS.Warn("between could not be said into the turn",
			"user", id.User, "conversation", conversationID, "turn", job.TurnID, "error", err)
		refuse(turnevents.ErrCodeNoRunningTurn, betweenNoTurnMessage)
		return
	}

	// Snapshot the reply position when filing the interruption in the transcript.
	job.Mu.Lock()
	landed := len(job.Blocks)
	job.Mu.Unlock()
	after := landed

	// Record before announcing. If recording fails, only log: the agent already received the message,
	// so refusing it would falsely report non-delivery.
	if h.store != nil {
		if _, err := h.store.AppendAndUpdate(conversationID,
			conversations.ConversationRecord{Role: conversations.RoleUser, Text: text, TurnID: job.TurnID,
				Between: true, AfterBlocks: &after}, nil); err != nil {
			agentapi.LogClaudeWS.Error("cannot record a between",
				"conversation", conversationID, "turn", job.TurnID, "error", err)
		}
	}

	job.Mu.Lock()
	job.Betweens = append(job.Betweens, text)
	job.Mu.Unlock()

	agentapi.LogClaudeWS.Info("between sent",
		"user", id.User, "socket", socketID(c), "conversation", conversationID,
		"turn", job.TurnID, "chars", len(text))
	h.Emit(job, map[string]any{"type": "between", "text": text})
}

const betweenNoTurnMessage = "No turn is running in this conversation, so nothing was said into it. " +
	"Your message is back in the box — send it again and it starts a turn of its own."

// reserveTurn checks capacity and installs the job atomically so concurrent prompts cannot both spawn.
// Busy conversations are refused; replacing a turn would interrupt a durable prompt without consent.
// An empty code means success.
func (h *Engine) reserveTurn(job *Turn) (string, string) {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	if h.shuttingDown {
		return turnevents.ErrCodeSpawnFailed, "The service is shutting down; no turn was started."
	}

	if existing := h.Jobs[job.ConversationID]; existing != nil {
		existing.Mu.Lock()
		running := !existing.IsDone || existing.ProcessPending
		existing.Mu.Unlock()
		if running {
			return turnevents.ErrCodeConversationBusy,
				"This conversation is already working on a message; wait for it, or stop it first."
		}
	}
	active := 0
	for _, other := range h.Jobs {
		other.Mu.Lock()
		done := other.IsDone && !other.ProcessPending
		other.Mu.Unlock()
		if !done {
			active++
		}
	}
	if active >= h.MaxTurns {
		return turnevents.ErrCodeTooManyTurns, fmt.Sprintf(
			"Claude is already running %d turns at once; wait for one to finish.", h.MaxTurns)
	}
	h.Jobs[job.ConversationID] = job
	return "", ""
}

// finishTurn records and settles once, whether stop or agent exit wins.
// Reply blocks stay in memory until settlement.
// Write before done/stopped triggers a client REST read; announceSettled follows that frame.
// Keep the job until TTL eviction so a subscribe racing the REST read can still recover the outcome.
func (h *Engine) FinishTurn(job *Turn, exitCode int, interrupted bool) (conversations.ConversationMeta, bool) {
	job.Mu.Lock()
	if job.IsDone {
		job.Mu.Unlock()
		return conversations.ConversationMeta{}, false
	}
	// Waiters wake only after the transcript write, on every return path.
	defer job.markSettled()
	job.IsDone = true
	job.ExitCode = exitCode
	job.interrupted = interrupted
	job.FinishedAt = time.Now()
	// Stop countdowns and retain unanswered asks as cancelled for transcript replay.
	for _, perm := range job.Pending {
		if perm.timer != nil {
			perm.timer.Stop()
		}
		by := "end"
		if interrupted {
			by = "stop"
		}
		job.AskHistory = append(job.AskHistory, askFromPerm(perm, conversations.AskOutcomeCancelled, by, nil))
	}
	job.Pending = nil
	// Abandon remaining background work so sync cannot replay it as still running.
	job.Background = agentapi.SettleBackground(job.Background)
	blocks := make([]conversations.ConversationBlock, 0, len(job.Blocks))
	for _, block := range job.Blocks {
		blocks = append(blocks, conversations.BlockToRecord(block))
	}
	sessionID := job.SessionID
	messageUUID := job.messageUUID
	mcpToken := job.mcpToken
	terminal := job.Terminal
	usage := job.Usage
	firstBlockAt := job.FirstBlockAt
	failure := job.failure
	failureNotice := job.FailureNotice
	asks := append([]conversations.ConversationAsk{}, job.AskHistory...)
	queue := append([]agentapi.AgentQueuedMessage{}, job.queue...)
	job.Mu.Unlock()

	// All settlement paths revoke here once, outside job.mu to avoid nesting registry locks.
	h.TurnTokens.Revoke(mcpToken)

	if h.store == nil {
		return conversations.ConversationMeta{}, false
	}
	// A refused resume must clear the session so the next turn starts fresh.
	resumeLost := job.resumeFailed(exitCode, interrupted)

	// Prefer spawn/agent failure messages, then the failed reply's tail.
	// An interrupted turn needs no tail-derived reason; the flag explains its end.
	endReason := protocol.OrDefault(failure, failureNotice)
	if endReason == "" && exitCode != 0 && !interrupted {
		endReason = conversations.ConversationRecord{Blocks: blocks}.BlockTail()
	}
	var storedUsage *conversations.ConversationUsage
	if usage != nil {
		storedUsage = &conversations.ConversationUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
			ReasoningTokens: usage.ReasoningTokens,
			TotalCostUSD:    usage.TotalCostUSD, Scope: usage.Scope,
		}
	}
	finishedAt := job.FinishedAt
	var firstBlockMs int64
	if !firstBlockAt.IsZero() {
		firstBlockMs = firstBlockAt.Sub(job.StartedAt).Milliseconds()
	}

	meta, err := h.store.AppendAndUpdate(job.ConversationID, conversations.ConversationRecord{
		Role: conversations.RoleAssistant, TurnID: job.TurnID, Blocks: blocks,
		Model: job.Model, Effort: job.effort, PermissionMode: job.PermissionMode,
		ExitCode: &exitCode, Interrupted: interrupted, SessionAnchor: messageUUID,
		ProfileID: job.profileID, Execution: job.execution, Queue: queue,
		StartedAt:    job.StartedAt.UTC().Format(protocol.ConversationTimeFormat),
		FinishedAt:   finishedAt.UTC().Format(protocol.ConversationTimeFormat),
		DurationMs:   finishedAt.Sub(job.StartedAt).Milliseconds(),
		FirstBlockMs: firstBlockMs,
		EndReason:    endReason,
		Terminal:     terminal,
		Usage:        storedUsage,
		Asks:         asks,
		PlayedBy:     job.playedBy,
		AgentRef:     job.agentRef,
		AgentVersion: job.agentVersion,
		RunID:        job.RunID,
		FlowNodeID:   job.FlowNodeID,
		Board:        job.Board,
	}, func(stored *conversations.ConversationMeta) {
		stored.RunningAt, stored.RunningTurn = "", ""
		stored.LastExitCode = &exitCode
		if exitCode == 0 {
			stored.ContextPending = false
		}
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
		turntrace.LogConv.Warn("cannot record a finished turn",
			"conversation", job.ConversationID, "turn", job.TurnID, "error", err)
		return conversations.ConversationMeta{}, false
	}
	if resumeLost {
		agentapi.LogClaudeWS.Warn("the agent's session could not be resumed",
			"conversation", job.ConversationID, "turn", job.TurnID, "exit_code", exitCode)
		if lost, err := h.store.AppendAndUpdate(job.ConversationID,
			conversations.ConversationRecord{Role: conversations.RoleNotice, TurnID: job.TurnID, Text: sessionLostNotice}, nil); err == nil {
			meta = lost
		}
	}
	return meta, true
}

// failTurn writes the transcript before reporting failure, as for all turn endings.
// Use emit's gate: a stop may have settled the job while startTurn was assembling the run.
func (h *Engine) FailTurn(job *Turn, message string) {
	job.Mu.Lock()
	job.failure = message
	job.Mu.Unlock()
	meta, recorded := h.FinishTurn(job, -1, true)
	h.Emit(job, turnevents.ErrorFrame(job.ConversationID, turnevents.ErrCodeSpawnFailed, message))
	h.announceSettled(meta, recorded)
}

// announceSettled broadcasts registry state after the turn's own settling frame.
func (h *Engine) announceSettled(meta conversations.ConversationMeta, recorded bool) {
	if !recorded {
		return
	}
	h.BroadcastRegistry(h.ConversationFrame(meta))
}

// resumeFailed identifies an agent's non-zero exit before any session announcement.
// Exclude stops and spawn failures: they also use exit -1 without implying session loss.
func (job *Turn) resumeFailed(exitCode int, interrupted bool) bool {
	if interrupted {
		return false
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	return job.Resumed && exitCode != 0 && !job.SawSession
}

func (h *Engine) ConversationFrame(meta conversations.ConversationMeta) map[string]any {
	return map[string]any{
		"type":           "conversation",
		"conversationId": meta.ID,
		"conversation":   conversations.ConversationDtoOf(meta, h.IsRunning(meta.ID)),
	}
}

// consume is the sole stream consumer and appends blocks/asks in agent order.
// The stream always ends in agentDone.
func (h *Engine) consume(job *Turn, driver agentapi.AgentDriver) {
	defer job.releaseProcess()
	for event := range driver.Events() {
		h.Apply(job, event)
	}
	// Close only after the stream ends; stopped drivers may still write after finishTurn.
	job.endTrace("")
}

func (job *Turn) releaseProcess() {
	job.Mu.Lock()
	job.ProcessPending = false
	job.Mu.Unlock()
}

// endTrace takes the handle under lock so repeated closes are harmless.
func (job *Turn) endTrace(note string) {
	job.Mu.Lock()
	trace := job.trace
	job.trace = nil
	job.Mu.Unlock()
	if trace == nil {
		return
	}
	trace.Note(note)
	trace.Close()
}

func (h *Engine) Apply(job *Turn, event agentapi.AgentEvent) {
	switch event.Kind {
	case agentapi.EventBlock:
		h.ApplyBlock(job, event)
	case agentapi.EventAsk:
		h.ApplyAsk(job, event.Ask)
	case agentapi.EventWithdraw:
		h.CancelPermission(job, event.AskID)
	case agentapi.EventSession:
		if event.MessageID != "" {
			job.Mu.Lock()
			job.messageUUID = event.MessageID
			job.Mu.Unlock()
		}
		h.applySession(job, event.SessionID)
	case agentapi.EventQueue:
		job.Mu.Lock()
		job.queue = append([]agentapi.AgentQueuedMessage{}, event.Queue...)
		job.Mu.Unlock()
		if h.store != nil {
			if err := h.store.SaveQueue(job.ConversationID, job.TurnID, event.Queue); err != nil {
				turntrace.LogConv.Warn("cannot persist the message queue", "conversation", job.ConversationID, "error", err)
			}
		}
		h.Emit(job, map[string]any{"type": "queue", "messages": event.Queue})
	case agentapi.EventFailure:
		message := agentfaults.AbsoluteLimitNotice(event.Message, time.Now())
		job.Mu.Lock()
		job.FailureNotice = message
		job.Mu.Unlock()
		// Credential failures use a separate code so the client can offer sign-in.
		code := turnevents.ErrCodeCLIError
		if event.AuthRequired {
			code = turnevents.ErrCodeNotSignedIn
		}
		h.Emit(job, turnevents.ErrorFrame(job.ConversationID, code, message))
	case agentapi.EventNotice:
		// Transient notices are displayed without becoming model speech or a failure record.
		if event.Message != "" {
			h.Emit(job, map[string]any{"type": "notice", "text": event.Message})
		}
	case agentapi.EventToolResult:
		h.applyToolResult(job, event)
	case agentapi.EventUsage:
		if event.Usage != nil {
			job.Mu.Lock()
			job.Usage = event.Usage
			job.Mu.Unlock()
		}
	case agentapi.EventBackground:
		h.applyBackground(job, event)
	case agentapi.EventDone:
		h.applyDone(job, event)
	}
}

// Replace the entire background roster, but ignore late events after settlement
// so abandoned work cannot become running again.
func (h *Engine) applyBackground(job *Turn, event agentapi.AgentEvent) {
	job.Mu.Lock()
	if job.IsDone {
		job.Mu.Unlock()
		return
	}
	job.Background = event.Background
	job.Mu.Unlock()
	h.Emit(job, map[string]any{"type": "background", "tasks": agentapi.WireBackground(event.Background)})
}

// Persist the session immediately so a killed service can resume it after sweepInterrupted,
// instead of silently starting fresh. finishTurn alone cannot cover a mid-turn shutdown.
func (h *Engine) applySession(job *Turn, sessionID string) {
	job.Mu.Lock()
	fresh := job.SessionID != sessionID
	job.SessionID = sessionID
	// The announced id is the fork's own. Clear the marker even if unchanged,
	// otherwise every subsequent turn would fork again.
	forking := job.forkPending
	job.forkPending = false
	// Even an unchanged announcement rules out the refused-resume diagnosis.
	job.SawSession = true
	job.Mu.Unlock()

	if (fresh || forking) && h.store != nil {
		if _, err := h.store.Update(job.ConversationID, func(stored *conversations.ConversationMeta) {
			stored.SessionID, stored.SessionLost = sessionID, false
			stored.ForkPending, stored.ForkAnchor = false, ""
		}); err != nil {
			turntrace.LogConv.Warn("cannot record the agent's session",
				"conversation", job.ConversationID, "turn", job.TurnID, "error", err)
		}
	}
	h.Emit(job, map[string]any{"type": "session", "sessionId": sessionID})
}

// applyBlock appends blocks in agent order. Each block arrives once; tool results may arrive later.
func (h *Engine) ApplyBlock(job *Turn, event agentapi.AgentEvent) {
	block := event.Block
	if block.At.IsZero() {
		block.At = time.Now()
	}
	if block.Kind == agentapi.BlockKindText {
		if fault := agentfaults.NoticeFault(block.Text, job.AgentName); fault != nil && fault.Limit {
			block.Text = agentfaults.AbsoluteLimitNotice(block.Text, block.At)
		}
	}
	job.Mu.Lock()
	index := len(job.Blocks)
	if job.FirstBlockAt.IsZero() {
		job.FirstBlockAt = block.At
	}
	job.Blocks = append(job.Blocks, block)
	// The last message id is the resume anchor for a later fork.
	if event.MessageID != "" {
		job.messageUUID = event.MessageID
	}
	job.Mu.Unlock()

	if block.Kind == agentapi.BlockKindToolUse {
		agentapi.LogClaudeWS.Info("tool use",
			"user", job.Owner, "conversation", job.ConversationID, "turn", job.TurnID,
			"tool", block.Name, "block", index)
	}
	h.Emit(job, BlockFrame(index, block))
}

// Match a result to the last tool block with that id. Log/drop unmatched results; do not invent calls.
func (h *Engine) applyToolResult(job *Turn, event agentapi.AgentEvent) {
	if event.ToolUseID == "" {
		return
	}
	arrived := time.Now()
	job.Mu.Lock()
	defer job.Mu.Unlock()
	for i := len(job.Blocks) - 1; i >= 0; i-- {
		block := &job.Blocks[i]
		if block.Kind != agentapi.BlockKindToolUse || block.ToolUseID != event.ToolUseID {
			continue
		}
		block.Result = event.ToolResult
		block.IsError = event.ToolIsError
		block.ExitCode = event.ToolExitCode
		block.DurationMs = event.ToolDurationMs
		if block.DurationMs == 0 && !block.At.IsZero() {
			block.DurationMs = arrived.Sub(block.At).Milliseconds()
		}
		return
	}
	agentapi.LogClaudeWS.Warn("tool result for a call this turn never made",
		"conversation", job.ConversationID, "turn", job.TurnID, "tool_use_id", event.ToolUseID)
}

func (h *Engine) applyDone(job *Turn, event agentapi.AgentEvent) {
	exitCode := event.ExitCode
	agentapi.LogClaudeWS.Info("process finished",
		"user", job.Owner, "conversation", job.ConversationID, "turn", job.TurnID,
		"exit_code", exitCode, "terminal", event.Terminal)
	if event.Terminal != "" {
		job.Mu.Lock()
		job.Terminal = event.Terminal
		job.Mu.Unlock()
	}

	job.Mu.Lock()
	stopped := job.stopRequested
	job.Mu.Unlock()
	meta, recorded := h.FinishTurn(job, exitCode, stopped)
	if stopped {
		h.emitFinal(job, map[string]any{"type": "stopped"})
		h.announceSettled(meta, recorded)
		if h.ChainRunner != nil {
			h.ChainRunner.OnTurnStopped(job.ConversationID)
		}
		return
	}
	// emit suppresses done after a stopped turn; never send a second settling frame.
	h.Emit(job, map[string]any{"type": "done", "exitCode": exitCode})
	h.announceSettled(meta, recorded)
}

// blockFrame sends text/thinking as deltas, including empty redacted thinking,
// so live clients create the same blocks that sync and transcripts retain.
func BlockFrame(index int, block agentapi.TurnBlock) map[string]any {
	if block.Kind == agentapi.BlockKindSubagent {
		frame := map[string]any{"type": "subagent", "index": index,
			"kind": agentapi.BlockKindSubagent, "text": block.Text}
		if block.Subagent != nil {
			frame["subagent"] = agentapi.WireSubagent(block.Subagent)
		}
		return frame
	}
	if block.Kind == agentapi.BlockKindToolUse {
		frame := map[string]any{"type": "tool_use", "index": index, "name": block.Name}
		if block.Input != "" {
			frame["input"] = block.Input
		}
		if block.Detail != "" {
			frame["detail"] = block.Detail
		}
		// Inline results travel with their calls. Later Claude results update the transcript only;
		// sync repairs live clients without a second tool_use frame.
		if block.ToolUseID != "" {
			frame["toolUseId"] = block.ToolUseID
		}
		if block.Result != "" {
			frame["result"] = block.Result
		}
		if block.IsError {
			frame["isError"] = true
		}
		if block.ExitCode != nil {
			frame["exitCode"] = *block.ExitCode
		}
		return frame
	}
	return map[string]any{"type": "output", "index": index, "kind": block.Kind, "data": block.Text}
}

func (h *Engine) ApplyAsk(job *Turn, ask *agentapi.AgentAsk) {
	if ask == nil || ask.ID == "" {
		return
	}

	// Bypass still needs an ask channel for questions; allow other asks immediately.
	if !ask.IsQuestion() && job.PermissionMode == runnerconfig.PermissionModeBypass {
		agentapi.LogClaudeWS.Info("permission auto-allowed in bypass mode",
			"conversation", job.ConversationID, "turn", job.TurnID, "request", ask.ID, "tool", ask.Tool)
		job.recordAsk(conversations.ConversationAsk{
			ID: ask.ID, Tool: ask.Tool, DisplayName: ask.DisplayName,
			Description: ask.Description, Input: ask.InputSummary,
			Outcome: conversations.AskOutcomeAllow, DecidedBy: "bypass", At: protocol.NowConversationTime(),
		})
		h.answerAsk(job, ask.ID, agentapi.AskDecision{Allow: true, Input: ask.Input})
		return
	}

	perm := &claudePermission{
		requestID: ask.ID, input: ask.Input, questions: ask.Questions, questionKeys: ask.QuestionKeys,
	}
	if perm.IsQuestion() {
		perm.Message = map[string]any{
			"type":      "question_request",
			"requestId": ask.ID,
			"toolName":  ask.Tool,
			"questions": ask.Questions,
		}
	} else {
		perm.Message = map[string]any{
			"type":      "permission_request",
			"requestId": ask.ID,
			"toolName":  ask.Tool,
		}
		if ask.DisplayName != "" {
			perm.Message["displayName"] = ask.DisplayName
		}
		if ask.Description != "" {
			perm.Message["description"] = ask.Description
		}
		if ask.InputSummary != "" {
			perm.Message["input"] = ask.InputSummary
		}
	}
	if ask.ToolUseID != "" {
		perm.Message["toolUseId"] = ask.ToolUseID
	}

	// The server's manualLive deadline travels on the frame so all tabs share one countdown.
	live := !perm.IsQuestion() && job.PermissionMode == runnerconfig.PermissionModeManualLive
	if live {
		perm.Message["decideAt"] = time.Now().Add(h.AutoAllowDelay).UnixMilli()
	}

	job.Mu.Lock()
	job.Pending = append(job.Pending, perm)
	if live {
		perm.timer = time.AfterFunc(h.AutoAllowDelay, func() { h.autoAllow(job, ask.ID) })
	}
	job.Mu.Unlock()

	asked := "permission requested"
	if perm.IsQuestion() {
		asked = "question asked"
	}
	agentapi.LogClaudeWS.Info(asked,
		"user", job.Owner, "conversation", job.ConversationID, "turn", job.TurnID,
		"request", ask.ID, "tool", ask.Tool,
		"subscribers", h.SubscriberCount(job.ConversationID))
	// Clone: emit mutates maps and sync reuses the retained one.
	h.Emit(job, turnevents.CloneFrame(perm.Message))
}

func (h *Engine) HandlePermissionDecision(c *turnevents.Client, id access.Identity, msg Command) {
	conversationID := msg.ConversationID
	if msg.Behavior != "allow" && msg.Behavior != "deny" {
		agentapi.LogClaudeWS.Warn("unknown permission behavior", "user", id.User, "socket", socketID(c),
			"conversation", conversationID, "request", msg.RequestID, "behavior", msg.Behavior)
		return
	}
	job, perm := h.pendingAsk(c, id, msg, false)
	if job == nil {
		return
	}

	decision := agentapi.AskDecision{
		Allow: msg.Behavior == "allow",
		Input: perm.input,
	}
	if !decision.Allow {
		decision.Message = protocol.OrDefault(msg.Message, "The user denied this tool call.")
	}
	agentapi.LogClaudeWS.Info("permission decided",
		"decided_by", id.User, "conversation", conversationID, "turn", job.TurnID,
		"request", msg.RequestID, "tool", perm.Message["toolName"], "behavior", msg.Behavior)
	outcome := conversations.AskOutcomeDeny
	if decision.Allow {
		outcome = conversations.AskOutcomeAllow
	}
	job.recordAsk(askFromPerm(perm, outcome, protocol.OrDefault(id.User, "user"), nil))
	h.answerAsk(job, perm.requestID, decision)
	h.notifyPermissionResolved(job, perm.requestID, msg.Behavior)
}

// autoAllow runs even without subscribers. Taking the ask atomically makes a concurrent
// human decision and the countdown mutually exclusive.
func (h *Engine) autoAllow(job *Turn, requestID string) {
	perm := job.takeAsk(requestID, false)
	if perm == nil {
		return
	}
	agentapi.LogClaudeWS.Info("permission allowed by the countdown",
		"conversation", job.ConversationID, "turn", job.TurnID, "request", requestID,
		"tool", perm.Message["toolName"], "after", h.AutoAllowDelay)
	job.recordAsk(askFromPerm(perm, conversations.AskOutcomeAllow, "countdown", nil))
	h.answerAsk(job, requestID, agentapi.AskDecision{Allow: true, Input: perm.input})
	h.notifyPermissionResolved(job, requestID, "allow")
}

// handleQuestionAnswer returns an allow with answers keyed by exact question text.
// Omit blanks: a missing key means unanswered; an empty entry is still an answer to the tool.
// Questions are never auto-answered, in any mode; dismissal sends an empty answer map.
func (h *Engine) HandleQuestionAnswer(c *turnevents.Client, id access.Identity, msg Command) {
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
		filed[key] = protocol.CutRunes(answer, protocol.MaxPermissionInputChars)
		// Return the chosen option's preview too; the tool only shows it to the model when supplied.
		if preview := selectedPreview(perm.questions[i], answer); preview != "" {
			annotations[key] = map[string]any{"preview": preview}
		}
	}

	// Clone the original schema-valid input, not the trimmed display frame.
	input, _ := perm.input.(map[string]any)
	updated := turnevents.CloneFrame(input)
	updated["answers"] = answers
	if len(annotations) > 0 {
		updated["annotations"] = annotations
	}

	agentapi.LogClaudeWS.Info("question answered",
		"answered_by", id.User, "conversation", msg.ConversationID, "turn", job.TurnID,
		"request", msg.RequestID, "questions", len(perm.questions), "answers", len(answers))
	job.recordAsk(askFromPerm(perm, conversations.AskOutcomeAllow, protocol.OrDefault(id.User, "user"), filed))
	h.answerAsk(job, perm.requestID, agentapi.AskDecision{Allow: true, Input: updated})
	h.notifyPermissionResolved(job, perm.requestID, "allow")
}

// selectedPreview returns no preview for unmatched/free-text or multi-select answers.
func selectedPreview(question map[string]any, answer string) string {
	options, _ := question["options"].([]map[string]any)
	for _, option := range options {
		if protocol.AsString(option["label"]) == answer {
			return protocol.AsString(option["preview"])
		}
	}
	return ""
}

// pendingAsk checks ownership and atomically removes an ask of the correct kind.
// Only the first answer may reach the agent; crossed question/permission answers are refused.
func (h *Engine) pendingAsk(c *turnevents.Client, id access.Identity, msg Command, question bool) (*Turn, *claudePermission) {
	conversationID := msg.ConversationID
	job := h.GetJob(conversationID)
	if job == nil {
		agentapi.LogClaudeWS.Warn("answer for a conversation with no turn",
			"user", id.User, "socket", socketID(c), "conversation", conversationID)
		return nil, nil
	}
	if !h.mayAct(conversationID, id) {
		agentapi.LogClaudeWS.Warn("answer refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID, "owner", job.Owner)
		h.EmitFor(conversationID, "", turnevents.ErrorFrame(conversationID, turnevents.ErrCodeNotPermitted,
			"This turn was started by another user."))
		return nil, nil
	}
	perm := job.takeAsk(msg.RequestID, question)
	if perm == nil {
		agentapi.LogClaudeWS.Warn("answer for unknown request",
			"user", id.User, "conversation", conversationID, "request", msg.RequestID, "question", question)
		return nil, nil
	}
	return job, perm
}

// Answer errors are logged: an agent that stopped listening has already ended its turn.
func (h *Engine) answerAsk(job *Turn, requestID string, decision agentapi.AskDecision) {
	driver := job.Agent()
	if driver == nil {
		agentapi.LogClaudeWS.Warn("no agent to answer",
			"conversation", job.ConversationID, "request", requestID)
		return
	}
	if err := driver.Answer(requestID, decision); err != nil {
		agentapi.LogClaudeWS.Warn("answering the agent failed",
			"conversation", job.ConversationID, "request", requestID, "error", err)
	}
}

// The driver may be nil while spawn has not yet published it.
func (job *Turn) Agent() agentapi.AgentDriver {
	job.Mu.Lock()
	defer job.Mu.Unlock()
	return job.Driver
}

func (h *Engine) CancelPermission(job *Turn, requestID string) {
	if requestID == "" {
		return
	}
	if perm := job.takeWithdrawn(requestID); perm != nil {
		agentapi.LogClaudeWS.Info("permission request withdrawn",
			"conversation", job.ConversationID, "request", requestID)
		job.recordAsk(askFromPerm(perm, conversations.AskOutcomeCancelled, "agent", nil))
		h.notifyPermissionResolved(job, requestID, "cancelled")
	}
}

// recordAsk retains settled asks for the transcript.
func (job *Turn) recordAsk(ask conversations.ConversationAsk) {
	if ask.At == "" {
		ask.At = protocol.NowConversationTime()
	}
	job.Mu.Lock()
	job.AskHistory = append(job.AskHistory, ask)
	job.Mu.Unlock()
}

// Copy questions because the original frame remains the turn's to emit.
func askFromPerm(perm *claudePermission, outcome, decidedBy string, answers map[string]string) conversations.ConversationAsk {
	var questions []map[string]any
	for _, question := range perm.questions {
		questions = append(questions, turnevents.CloneFrame(question))
	}
	return conversations.ConversationAsk{
		ID:          perm.requestID,
		Tool:        protocol.OrDefault(protocol.AsString(perm.Message["toolName"]), "tool"),
		DisplayName: protocol.AsString(perm.Message["displayName"]),
		Description: protocol.AsString(perm.Message["description"]),
		Input:       protocol.AsString(perm.Message["input"]),
		Questions:   questions,
		Answers:     answers,
		Outcome:     outcome,
		DecidedBy:   decidedBy,
		At:          protocol.NowConversationTime(),
	}
}

// Notify all subscribers so other tabs also remove the resolved ask.
func (h *Engine) notifyPermissionResolved(job *Turn, requestID, outcome string) {
	h.Emit(job, map[string]any{
		"type": "permission_resolved", "requestId": requestID, "outcome": outcome,
	})
}

// takeAsk atomically removes only the expected kind: a permission decision must never
// allow a question's tool without collecting its answers.
func (job *Turn) takeAsk(requestID string, question bool) *claudePermission {
	return job.takeMatching(func(perm *claudePermission) bool {
		return perm.requestID == requestID && perm.IsQuestion() == question
	})
}

// Withdrawals name only an id and can remove either kind of ask.
func (job *Turn) takeWithdrawn(requestID string) *claudePermission {
	return job.takeMatching(func(perm *claudePermission) bool { return perm.requestID == requestID })
}

func (job *Turn) takeMatching(match func(*claudePermission) bool) *claudePermission {
	job.Mu.Lock()
	defer job.Mu.Unlock()
	for i, perm := range job.Pending {
		if match(perm) {
			job.Pending = append(job.Pending[:i], job.Pending[i+1:]...)
			// Removal prevents double answers; stopping the timer releases its reference to the job.
			if perm.timer != nil {
				perm.timer.Stop()
			}
			return perm
		}
	}
	return nil
}

func (h *Engine) HandleStop(c *turnevents.Client, id access.Identity, msg Command) {
	conversationID := strings.TrimSpace(msg.ConversationID)
	if conversationID == "" {
		return
	}
	if !h.mayAct(conversationID, id) {
		agentapi.LogClaudeWS.Warn("stop refused: not the turn's owner",
			"user", id.User, "socket", socketID(c), "conversation", conversationID)
		h.EmitFor(conversationID, "", turnevents.ErrorFrame(conversationID, turnevents.ErrCodeNotPermitted,
			"This turn was started by another user."))
		return
	}
	h.StopProcess(conversationID, id.User)
}

// Mark superseded before stopping the driver so its draining consumer cannot emit stale output.
func (h *Engine) StopProcess(conversationID, requestedBy string) bool {
	job := h.GetJob(conversationID)
	if job == nil {
		return false
	}
	job.Mu.Lock()
	if job.IsDone {
		job.Mu.Unlock()
		return false
	}
	driver := job.Driver
	deferredSettlement := job.execution != nil
	if deferredSettlement {
		job.stopRequested = true
	} else {
		job.Superseded = true
	}
	job.Mu.Unlock()
	if deferredSettlement {
		if driver != nil {
			driver.Stop()
		}
		return true
	}

	agentapi.LogClaudeWS.Info("turn stopped",
		"requested_by", requestedBy, "conversation", conversationID, "turn", job.TurnID,
		"owner", job.Owner, "agent", driver != nil)
	if driver != nil {
		driver.Stop()
	}
	meta, recorded := h.FinishTurn(job, -1, true)
	// emitFinal bypasses superseded but still waits for any frame already being written.
	h.emitFinal(job, map[string]any{"type": "stopped"})
	h.announceSettled(meta, recorded)
	// Pause the chain at its current node rather than advancing after a chat stop.
	// Notify after settlement, which the runner is waiting on.
	if h.ChainRunner != nil {
		h.ChainRunner.OnTurnStopped(conversationID)
	}
	return true
}

// mayAct restricts turn actions to its owner without restricting subscriptions.
// Empty owner/caller permits debug auth mode.
func (h *Engine) mayAct(conversationID string, id access.Identity) bool {
	job := h.GetJob(conversationID)
	if job == nil {
		return true
	}
	if job.Owner == "" || id.User == "" {
		return true
	}
	return job.Owner == id.User
}

// Disconnect only drops subscriptions and the socket; turns and pending asks survive it.
func (h *Engine) AfterConnectionClosed(c *turnevents.Client, id access.Identity) {
	dropped := h.UnsubscribeAll(c)
	h.DropConn(c)
	agentapi.LogClaudeWS.Info("disconnected",
		"user", id.User, "socket", c.Id, "conversations", len(dropped))
	c.Close()
}

func (h *Engine) janitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-h.janitorStop:
			return
		case now := <-ticker.C:
			h.SweepExpiredJobs(now)
		}
	}
}

// Evict only settled turns older than jobTTL; never evict running turns.
func (h *Engine) SweepExpiredJobs(now time.Time) {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	for conversationID, job := range h.Jobs {
		job.Mu.Lock()
		expired := job.IsDone && !job.ProcessPending && now.Sub(job.FinishedAt) > h.JobTTL
		job.Mu.Unlock()
		if expired {
			agentapi.LogClaudeWS.Info("turn evicted", "conversation", conversationID)
			delete(h.Jobs, conversationID)
		}
	}
}

func (h *Engine) ActiveTurnCount() int {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	n := 0
	for _, job := range h.Jobs {
		job.Mu.Lock()
		done := job.IsDone && !job.ProcessPending
		job.Mu.Unlock()
		if !done {
			n++
		}
	}
	return n
}

// Live status comes only from the job. Disk metadata records starts for restart recovery,
// not proof that a turn is still running.
func (h *Engine) IsRunning(conversationID string) bool {
	job := h.GetJob(conversationID)
	if job == nil {
		return false
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	return !job.IsDone
}

// shutdown drops the registry and stops the janitor and drivers. Leave conversation
// metadata for sweepInterrupted at startup; writing records here would race the shutdown deadline.
func (h *Engine) Shutdown() {
	h.stopOnce.Do(func() { close(h.janitorStop) })
	h.Mu.Lock()
	h.shuttingDown = true
	jobs := make([]*Turn, 0, len(h.Jobs))
	for _, job := range h.Jobs {
		job.Mu.Lock()
		// A driver still in Spawn must be stopped as soon as it returns, too.
		job.Superseded = true
		job.Mu.Unlock()
		jobs = append(jobs, job)
	}
	h.Jobs = map[string]*Turn{}
	h.Mu.Unlock()

	for _, job := range jobs {
		if driver := job.Agent(); driver != nil {
			agentapi.LogClaudeWS.Info("shutdown kill",
				"conversation", job.ConversationID, "turn", job.TurnID)
			driver.Stop()
		}
	}
}

func (h *Engine) GetJob(conversationID string) *Turn {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	return h.Jobs[conversationID]
}

func (h *Engine) PutJob(conversationID string, job *Turn) {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	h.Jobs[conversationID] = job
}

func (h *Engine) RemoveJob(conversationID string) {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	delete(h.Jobs, conversationID)
}

func socketID(c *turnevents.Client) string {
	if c == nil {
		return "-"
	}
	return c.Id
}

func (h *Engine) HandleDeferred(c *turnevents.Client, id access.Identity, msg Command) {
	job := h.GetJob(strings.TrimSpace(msg.ConversationID))
	if job == nil || !h.mayAct(msg.ConversationID, id) {
		h.EmitTo(c, msg.ConversationID, turnevents.ErrorFrame(msg.ConversationID, turnevents.ErrCodeNoRunningTurn, betweenNoTurnMessage))
		return
	}
	job.Mu.Lock()
	driver, stopped := job.Driver, job.IsDone || job.stopRequested
	job.Mu.Unlock()
	deferred, ok := driver.(agentapi.AgentDeferred)
	if !ok || stopped {
		h.EmitTo(c, msg.ConversationID, turnevents.ErrorFrame(msg.ConversationID, turnevents.ErrCodeNoRunningTurn, "This turn does not accept deferred messages"))
		return
	}
	var err error
	if msg.Type == "clear_queue" {
		err = deferred.ClearQueue()
	} else if text := strings.TrimSpace(msg.Text); text != "" {
		err = deferred.FollowUp("queued-"+idgen.RandID(), text)
	}
	if err != nil {
		h.EmitTo(c, msg.ConversationID, turnevents.ErrorFrame(msg.ConversationID, turnevents.ErrCodeNoRunningTurn, err.Error()))
	}
}

func (h *Engine) ForkTranscriptContext(conversationID string) string {
	records, err := h.store.Messages(conversationID)
	if err != nil {
		return ""
	}
	var context strings.Builder
	context.WriteString("Previous conversation transcript, supplied as context for this distinct session:\n<conversation-history>\n")
	for _, record := range records {
		if record.Role != conversations.RoleUser && record.Role != conversations.RoleAssistant {
			continue
		}
		fmt.Fprintf(&context, "%s:\n%s\n", record.Role, record.BlockText())
		for _, block := range record.Blocks {
			if block.Kind == agentapi.BlockKindToolUse {
				fmt.Fprintf(&context, "Tool %s: %s\n%s\n", block.Name, block.Input, block.Result)
			}
		}
	}
	context.WriteString("</conversation-history>\n\nCurrent message:\n")
	return context.String()
}
