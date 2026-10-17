package hybridflowrunner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"kiao/worker/internal/core"
)

// The `muse` CLI behind the AgentDriver port (driver.go), beside the `claude` and `codex` ones.
// This is the only file that knows this CLI exists: its serve host, its MSP protocol, and the shape
// of what a turn on it is.
//
// Two objects, as on the other sides. museAgent is the CLI as a whole; museDriver is one turn.
//
// ── what `muse serve` is ──────────────────────────────────────────────────────
//
// `muse serve` is a session host speaking MSP — JSON-RPC over stdio — and this driver holds one for
// the life of a turn: spawned, handshaked, asked to open the conversation's session and run one
// turn on it, then killed. Sessions outlive the host that ran them — the log on disk is what a
// later turn resumes — so one host per turn is one process per turn, which is the lifecycle this
// half already has.
//
// A turn that ends with background work still running — a workflow, a subagent
// that outlived it, a backgrounded tool call — drains first: the host stays up
// until that work lands or the drain times out, and only then is it killed.
// Killing it at the turn's end instead would orphan the work with it, which is
// what the drain exists to stop.
//
// The protocol answers everything the port asks, which is why this agent runs all three permission
// modes where Codex runs one: approvals arrive as notifications and are decided over the same pipe,
// questions arrive as prompts and are answered the same way, `turn/steer` speaks into a running
// turn, and `session/fork` branches one. The port's five verbs map one by one:
//
//	Spawn   open the session (start, resume, or fork), set the model and the mode, start the turn
//	Events  the transcript items, the asks, the session, the turn's end
//	Answer  approval/decide for a call, userInput/answer for a question
//	Say     turn/steer into the running turn
//	Stop    turn/cancel, then the host is killed
//
// ── what travels where ────────────────────────────────────────────────────────
//
// The working folder is the host process's working directory, as on the other sides. The store root
// is the session's workspaceRoot — the whole store, deliberately: a conversation started in one
// unit routinely has to read another, and gating is the approval channel's business, not the
// sandbox's.
//
// The sandbox is off on every turn (`--disable-sandbox`), in every mode. Muse's sandbox would be a
// second gate beside the approvals — a write the user allowed refused by a policy nobody was shown
// — where the other agents have exactly one: what the user decided. Bypass is therefore
// `allowAll`, and both manual modes are `onRequest`, which asks about every tool call.
//
// The briefing travels in the turn's input text, prepended to the prompt. MSP has no per-turn
// system prompt to hang it on, and the hub's transcript records the prompt it composed rather than
// the text the driver sent — so it is read by the model and by nobody else, which is what the
// other renderings buy with a flag.
//
// ── the sign-in ─────────────────────────────────────────────────────────────────
//
// The usage panel signs this agent in (muse_login.go), two shapes under one gate: the device flow,
// `muse login` — a page to open, a code to confirm, a wait for the approval, driven as one parked
// process the panel polls — and the API key, `muse auth set --api-key-stdin`, for whoever already
// holds one. A turn refused for want of either ends `authRequired`, which is what points at the
// panel that offers them.
//
// The quota it does answer, but not by asking: a host fresh off `muse serve` has observed no
// quota to report, so there is no stateless read to make. Instead every turn's host is asked
// `usage/read` as its turn ends, and whatever `usage/changed` a turn emits is recorded as it
// lands (muse_usage.go). What the quota port answers is the newest observation any turn has
// brought back — the account as of the last Muse turn — and before any turn has run it reads as
// unavailable, which is the truth. A refresh the user asked for additionally runs one minimal
// turn on the cheapest model and records what that host observed, which is the only read of this
// account there is. What the agent also answers is the fork: sessions branch, so a fork of a
// Muse conversation is one Muse remembers.

type museAgent struct {
	cfg *Config
	// binary is the CLI to spawn. A field rather than a literal for the reason the Claude agent has
	// one: pointing it at a name that does not exist is the only way to reach the failure branch of
	// the spawn path without a real CLI on the host. Production never changes it.
	binary string

	options *MuseOptionsService
	usage   *MuseUsageService
	login   *MuseLoginService
}

const museBinaryName = "muse"

var (
	_ Agent             = (*museAgent)(nil)
	_ AgentOptions      = (*museAgent)(nil)
	_ AgentUsage        = (*museAgent)(nil)
	_ AgentUsageRefresh = (*museAgent)(nil)
	_ AgentMCP          = (*museAgent)(nil)
	_ AgentBranching    = (*museAgent)(nil)
	_ AgentAPIKeyLogin  = (*museAgent)(nil)
	_ AgentDeviceLogin  = (*museAgent)(nil)
)

func newMuseAgent(cfg *Config) *museAgent {
	agent := &museAgent{cfg: cfg, binary: museBinaryName,
		options: newMuseOptionsService(cfg), usage: newMuseUsageService(),
		login: newMuseLoginService(cfg)}
	agent.options.binary = agent.binary
	agent.usage.binary = agent.binary
	agent.login.binary = agent.binary
	return agent
}

// Driver returns the driver for one turn.
func (a *museAgent) Driver() AgentDriver {
	return &museDriver{cfg: a.cfg, binary: a.binary, events: make(chan AgentEvent), usage: a.usage}
}

// Options is the model, effort and permission-mode choices the prompt offers (muse_options.go).
func (a *museAgent) Options() agentOptionsDto { return a.options.get() }

// DefaultModel prefers the catalogue's isDefault row where the channel names one,
// falling back to the newest contributor. It is what new Muse conversations start on.
func (a *museAgent) DefaultModel() string { return a.options.defaultModel() }

// Usage is the account's rolling rate-limit windows as the turns have last observed them
// (muse_usage.go).
func (a *museAgent) Usage() (AgentUsageDto, error) { return a.usage.getUsage() }

// RefreshUsage is the same windows, refreshed: with nothing fresh to answer, one minimal turn is
// run on the cheapest model and what its host observed is recorded like any turn's. It is what
// the usage endpoint answers; the runner stays on Usage, which never spends a turn.
func (a *museAgent) RefreshUsage() (AgentUsageDto, error) { return a.usage.refresh() }

// RenderMCP turns the servers the toolbox offers into the `mcp_servers` fragment a turn's staged
// settings.json is written from (muse_mcp.go). The hub carries the answer to Spawn without reading
// it.
func (a *museAgent) RenderMCP(servers []core.MCPServer) (string, error) {
	return buildMuseMCPConfig(servers), nil
}

// BranchesSessions is yes: session/fork copies a session through a cut point under an id of its
// own, so a fork of a Muse conversation is one Muse remembers.
func (a *museAgent) BranchesSessions() bool { return true }

// APIKeyLoginEnabled is the deployment's say on signing in from the panel (muse_login.go).
func (a *museAgent) APIKeyLoginEnabled() bool { return a.login.enabled }

// SubmitAPIKey stores the key with the host CLI: `muse auth set --api-key-stdin`, the key on
// stdin and never in the process arguments.
func (a *museAgent) SubmitAPIKey(key string) (bool, string, error) { return a.login.submitKey(key) }

// APIKeyHostCommand is what to run on the host where the deployment keeps the endpoint off. It
// names the real CLI rather than the test's override: it is documentation, not an invocation.
func (a *museAgent) APIKeyHostCommand() string { return museBinaryName + " auth set --api-key-stdin" }

// DeviceLoginEnabled is the deployment's say on the device flow (muse_login.go): the same gate as
// the API key, since either shape binds the host's CLI to whoever signs in.
func (a *museAgent) DeviceLoginEnabled() bool { return a.login.enabled }

// DeviceLoginStart spawns `muse login` and returns the page to open and the code to confirm.
func (a *museAgent) DeviceLoginStart() (string, string, error) { return a.login.startDevice() }

// DeviceLoginStatus reports the approval wait: pending while the CLI is still parked, and once it
// has exited whether the approval landed.
func (a *museAgent) DeviceLoginStatus() (bool, bool, string, error) {
	return a.login.deviceStatus()
}

// DeviceLoginCancel kills the device flow in progress, reporting whether there was one.
func (a *museAgent) DeviceLoginCancel() bool { return a.login.cancelDevice() }

// DeviceLoginHostCommand is what to run on the host where the deployment keeps the endpoint off.
func (a *museAgent) DeviceLoginHostCommand() string { return museBinaryName + " login" }

// DeviceLoginShutdown kills the parked device flow, so none survives the service.
func (a *museAgent) DeviceLoginShutdown() { a.login.shutdownDevice() }

// museServeArgs is the host invocation. One flag, and it is on every turn: the sandbox stays off
// because the approval channel is the gate, in every mode — see the header above.
func museServeArgs() []string { return []string{"serve", "--disable-sandbox"} }

// ── the arguments ─────────────────────────────────────────────────────────────

// museRun is everything one turn needs from the host: AgentRun translated into the calls this CLI
// happens to spell it with.
type museRun struct {
	model, effort, permissionMode, sessionID string
	// instructions are the managed agent's standing orders, prepended to the input text with the
	// briefing. Empty is a turn with no standing orders.
	instructions string
	// thinking is the model's extended reasoning. False asks for the `none` tier rather than for
	// the conversation's effort — asking for no reasoning, which is what the switch means.
	thinking bool
	// forkSession asks for a branch off sessionID rather than a continuation of it: the first turn
	// of a forked conversation, which holds the session id of the conversation it was copied from.
	forkSession bool
	// resumeAt is where in that session the branch cuts: the MSP turn id the fork's copied history
	// ends at, carried on every block the driver emits (see AgentEvent.MessageID). Empty is the
	// session's end, which is a fork of a conversation whole.
	resumeAt string
	// storeRoot is the whole file store, absolute, handed over as the session's workspaceRoot. A
	// turn's working directory is one folder of it; without this every path outside that folder
	// would raise an approval in manual mode.
	storeRoot string
	// workDir is the turn's own folder, the host process's working directory.
	workDir string
	// mcpConfig is the `mcp_servers` fragment rendered from the ledger, with the turn's token
	// still written as ${KIAO_MCP_TURN_TOKEN}. Empty is a turn handed no servers at all — and one
	// whose host runs with the user's own configuration untouched.
	mcpConfig string
	// mcpToken is what that placeholder becomes.
	mcpToken string
	// allowBypass is Config.BypassEnabled, carried this far so the one place the allowAll mode is
	// selected is also the place that can refuse to select it. Every path here is gated already;
	// this is what makes a path added later fail closed.
	allowBypass bool
}

// runFor is the port's turn as this CLI spells it.
func (d *museDriver) runFor(run AgentRun) museRun {
	return museRun{
		model:          run.Model,
		effort:         run.Effort,
		permissionMode: run.PermissionMode,
		instructions:   run.Instructions,
		thinking:       run.Thinking,
		sessionID:      run.SessionID,
		forkSession:    run.ForkSession,
		resumeAt:       run.ResumeAt,
		storeRoot:      run.StoreRoot,
		workDir:        run.WorkDir,
		mcpConfig:      run.MCPConfig,
		mcpToken:       run.MCPToken,
		allowBypass:    run.AllowBypass,
	}
}

// museApprovalMode is the MSP approval mode a turn runs in: every tool call asked about, or none.
// `manualLive` is this service's word for a client behaviour and the host has never heard of it —
// the countdown is the hub's, so both manual modes select the same enforcement.
func museApprovalMode(permissionMode string, allowBypass bool) string {
	if asksBeforeTools(permissionMode) || !allowBypass {
		return "onRequest"
	}
	return "allowAll"
}

// museReasoningEffort is the tier a turn runs at: `none` when extended thinking is off, the
// conversation's effort when it names a tier of the protocol's closed vocabulary, and nothing
// otherwise — which runs the host's own default rather than refusing a turn over a word the
// catalogue has moved past.
func museReasoningEffort(thinking bool, effort string) string {
	if !thinking {
		return "none"
	}
	switch strings.TrimSpace(effort) {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra":
		return strings.TrimSpace(effort)
	default:
		return ""
	}
}

// ── the driver ────────────────────────────────────────────────────────────────

// museDriver is one turn's `muse serve` host. It is made per turn and never reused.
type museDriver struct {
	cfg    *Config
	binary string
	run    AgentRun
	// usage is the agent's quota, shared by every turn's driver: each turn's host is asked what
	// it observed of the account as its turn ends. Nil in the tests that build a driver by hand,
	// which harvest nothing.
	usage *MuseUsageService

	// events is unbuffered: the host is read exactly as fast as the hub relays it.
	events chan AgentEvent

	mu sync.Mutex
	// conn is the host, published once the handshake has succeeded. stopped latches a Stop that
	// arrived anywhere along the way — the reader reports the turn as service-ended rather than
	// failed, whatever the pipe still held.
	conn    *mspConn
	stopped bool
	// sessionID and turnID are the MSP session and the running turn, as the open calls answered
	// them. turnID is cleared the moment the turn ends, which is what makes a Say after the end
	// an error rather than input into a turn that will never read it.
	sessionID string
	turnID    string
	// turnTokens is what the running turn has cost so far: the sum of its model
	// completions' usage, one session/tokenUsage each. Taken and cleared when the
	// turn ends, dropped when it is resumed after a blockage — the resumed turn is
	// a turn of its own, and the old one's bill never closed. Written by the relay
	// alone, under this lock because the resync feeds through the same path.
	turnTokens turnUsage
	turnBilled bool
	// notifCounts counts the host's notifications by method, and lastNotif names the most
	// recent one. The census is what a turn that never ended is read for: a settled turn's
	// transcript proves what arrived, but a silent one leaves nothing else behind.
	notifCounts map[string]int
	lastNotif   string
	// lastNotifAt is when that most recent one arrived — the relay's start until the first
	// one does. It is what dates a silence: the census names the last word, this says how
	// long ago it was spoken.
	lastNotifAt time.Time
	// stagingDir is the per-turn configuration the host was pointed at, or "" for a host running
	// with the user's own. Removed when the turn ends — it holds the turn's credential.
	stagingDir string
	// prologue is what the reader emits before it starts relaying the host: the session the turn
	// runs on — or, for a turn that never got that far, the whole of what it says. prologueEnd is
	// set for the second kind, with the exit code the turn ends on.
	prologue    []AgentEvent
	prologueEnd bool
	prologueCod int
	// compacting is a turn whose work is a compaction rather than a reply: the reader ends on the
	// compaction item instead of on a turn of its own.
	compacting bool
	// idleTimeout bounds a turn's silence before the relay ends it rather than waiting for an
	// end that never comes. Zero is the default; a test names milliseconds.
	idleTimeout time.Duration
	// usageTimeout bounds the quota question a turn's end asks its host. Zero is the default;
	// a test names milliseconds.
	usageTimeout time.Duration
	// noticeTimeout is how long the relay waits before naming a silence. Zero is the default;
	// a test names milliseconds.
	noticeTimeout time.Duration
	// relaunches is how many times this turn has been stopped and asked to resume after a
	// blockage. Zero is a turn that never blocked; one is the most a turn ever holds, since a
	// second blockage ends it for the chain runner to fork. Read by the notices naming the
	// silence, written by the relay alone.
	relaunches int
	// lastCursor is the newest view cursor the host has shown, live or paged. It is where
	// a resync pages from: strictly after it is exactly what this turn has not seen.
	lastCursor string
	// viewDown latches a dead live view: the host said its projection failed closed, so
	// nothing past it arrives unless polled for. Set once, never cleared — a projection
	// that failed closed stays failed for the life of the session.
	viewDown bool
	// journalSize and journalAt are the host journal's last observed size and
	// modification time — the liveness signal when the view is down and the pipe is
	// silent. journalKnown says a baseline was ever taken; without one the first
	// sighting counts as growth, since a journal that appeared was written.
	journalSize  int64
	journalAt    time.Time
	journalKnown bool
	// blindParks counts consecutive resyncs finding the turn parked on asks nobody was
	// shown. One extra wait gives a host-side settlement a chance; past it the turn is
	// as stuck as a silent one and resumes or forks like one.
	blindParks int
	// resyncTimeout bounds one poll of a silent turn's session. Zero is the default; a
	// test names milliseconds.
	resyncTimeout time.Duration
	// subagentTimeout bounds one child transcript read. Zero is the default; a test names
	// milliseconds.
	subagentTimeout time.Duration
	// subagents reads back what this turn's subagents thought and did, over the turn's own
	// host. Published with the connection, read by the relay as delegations complete. Nil is
	// a turn with no host to read back through — a spawn that never got that far, or a driver
	// a test built by hand — whose delegations file the summary line alone.
	subagents SubagentReader
	// lastTurnID is the turn that just ended: every end that clears turnID files
	// it here first. Late items of that turn — background work completing after
	// it — are still this turn's own, and read back under this id.
	lastTurnID string
	// openWork is the turn's background work still running, by item id: workflow
	// runs, subagents, and backgrounded tool calls seen opening and not yet
	// completed. A turn that ends with work still open drains it before its host
	// is killed, which is what keeps a background workflow alive past its turn.
	openWork map[string]museWorkItem
	// roster is that same background work as the `background` frame reports it:
	// every background item this turn has handed off, by item id, in first-sight
	// order, finished ones kept. openWork above is what the drain waits on; this
	// is what the user watches. Updated on item opening, updating and completing,
	// and emitted whole on every change; it dies with the driver, like the turn
	// it belongs to.
	roster      map[string]BackgroundTask
	rosterOrder []string
	// draining is a turn whose end is deferred until its background work lands.
	// drainEnd, drainCode and drainTerminal are the deferred end itself: the
	// phrase the final note keeps, and the code and terminal it settles on.
	// drainTotal counts the work the drain started with, for the note that ends
	// it; drainCh fires the drain's bound, armed once at its start.
	draining      bool
	drainEnd      string
	drainCode     int
	drainTerminal string
	drainTotal    int
	drainStarted  time.Time
	drainCh       <-chan time.Time
	// drainTimeout bounds the whole drain. Zero is the default; a test names
	// milliseconds.
	drainTimeout time.Duration

	// asks is what this turn is parked on, by the hub's ask id. Read by Answer from the socket's
	// reader and written by the relay goroutine, so under a lock of its own.
	asksMu sync.Mutex
	asks   map[string]*museAsk
}

var _ AgentDriver = (*museDriver)(nil)

// museAsk is one thing the turn is parked on: an approval to decide, or a question to answer. It is
// the driver's copy of what the hub holds as a claudePermission — the AgentAsk that was emitted,
// and whatever answering it needs that the hub does not carry.
type museAsk struct {
	ask *AgentAsk
	// approvalID and requirement are the approval this ask decides: the id, and the
	// currentRequirementId verbatim — the multi-stage race guard a decision has to echo.
	approvalID  string
	requirement any
	choices     []museChoice
	// userInputID and questions are the prompt this ask answers: the id, and one entry per
	// question in the order asked, with what answering it needs — the question's own id, whether
	// several options may be chosen, and the labels an answer is matched against.
	userInputID string
	questions   []museQuestion
	// answered is set once the hub has answered; decidedBy holds the command ids the answers went
	// out under. A settlement decided by one of those is the answer landing, and anything else —
	// the judge, a timeout, another client — is a withdrawal.
	answered  bool
	decidedBy map[string]bool
}

// museChoice is one way an approval may be decided, as the host offered it.
type museChoice struct {
	choiceID        string
	decision        string
	scope           string
	acceptsFeedback bool
}

// museQuestion is one question of a user-input prompt.
type museQuestion struct {
	id       string
	multiple bool
	labels   []string
}

// isQuestion reports whether this ask is a question to answer rather than a call to allow.
func (ask *museAsk) isQuestion() bool { return ask.userInputID != "" }

// Spawn opens the session, sets the model and the mode, and starts the turn — then hands the host
// to the relay goroutine, which is what emits every event including the first: this call only ever
// returns an error, never an event, because the stream has no reader until it has returned.
func (d *museDriver) Spawn(run AgentRun) error {
	d.run = run
	mrun := d.runFor(run)

	// A compaction is not a turn and starts none: it shortens the session's context instead. The
	// runner sends it between two flow nodes of a chain, and the user may type it too — either way it
	// arrives as a bare command, because the hub passes one through without the context a message
	// carries. With no session there is nothing to shorten, and the turn says so without spawning
	// a host at all.
	if strings.TrimSpace(run.Prompt) == chainRunCompactCommand {
		return d.spawnCompact(mrun)
	}

	staging, env, err := d.stageConfig(mrun)
	if err != nil {
		return err
	}
	d.stagingDir = staging

	conn, err := spawnMSP(context.Background(), d.binary, museServeArgs(), mrun.workDir, env, run.Trace)
	if err != nil {
		d.cleanup()
		return err
	}
	run.Trace.exec(d.execRecord(conn.cmd, mrun))
	d.mu.Lock()
	d.conn = conn
	d.subagents = newMuseSubagentReader(conn, run.Trace, d.subagentWait())
	d.mu.Unlock()

	sessionID, err := d.openSession(conn, mrun)
	if err != nil {
		// A session the host would not open is not a turn that never ran — it is a turn whose
		// engine has forgotten the conversation, and the hub has a path for exactly that. The
		// reader emits the failure and a non-zero end with no session announced, which is what
		// the hub reads as a lost session: the conversation is marked, and the next turn starts
		// fresh instead of asking again for a session that is gone.
		conn.close()
		d.mu.Lock()
		d.conn = nil
		d.subagents = nil
		d.prologue = []AgentEvent{{Kind: agentFailure, Message: err.Error()}}
		d.prologueEnd, d.prologueCod = true, 1
		d.mu.Unlock()
		go d.relay()
		return nil
	}

	if model := strings.TrimSpace(mrun.model); model != "" {
		if _, err := conn.call("session/setModel", map[string]any{
			"commandId": mspCommandID(), "sessionId": sessionID,
			"model": map[string]any{"modelId": model},
		}); err != nil {
			conn.close()
			d.cleanup()
			return fmt.Errorf("Muse refused the model %q: %s", model, museSentence(err))
		}
	}
	// The mode is selected on every turn rather than only at creation: a prompt may override the
	// conversation's mode, and a resumed session otherwise keeps whatever the last turn selected.
	if _, err := conn.call("session/setApprovalMode", map[string]any{
		"commandId": mspCommandID(), "sessionId": sessionID,
		"mode": museApprovalMode(mrun.permissionMode, mrun.allowBypass),
	}); err != nil {
		conn.close()
		d.cleanup()
		return fmt.Errorf("Muse refused the permission mode: %s", museSentence(err))
	}

	input := map[string]any{"type": "text",
		"text": agentBriefingWith(mrun.storeRoot, mrun.instructions) + "\n\n" + run.Prompt}
	start := map[string]any{
		"commandId": mspCommandID(), "sessionId": sessionID,
		"input": []any{input},
		// A busy session is a stale one: KIAO runs one turn per conversation, so a turn already
		// running is one whose host died without ending it. Replacing it reclaims the session
		// rather than queueing behind a turn that will never finish.
		"ifBusy": "replace",
	}
	if effort := museReasoningEffort(mrun.thinking, mrun.effort); effort != "" {
		start["reasoningEffort"] = effort
	}
	raw, err := conn.call("turn/start", start)
	if err != nil {
		conn.close()
		d.cleanup()
		return fmt.Errorf("Muse would not start the turn: %s", museSentence(err))
	}
	var started struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.TurnID == "" {
		conn.close()
		d.cleanup()
		return errors.New("Muse started a turn and did not say which.")
	}

	logClaudeWS.Info("spawned",
		"agent", agentMuse, "conversation", run.Conversation, "turn", run.Turn,
		"work_dir", run.WorkDir, "store_root", run.StoreRoot,
		"session", sessionID, "msp_turn", started.TurnID)
	d.mu.Lock()
	d.sessionID, d.turnID = sessionID, started.TurnID
	d.prologue = []AgentEvent{{Kind: agentSession, SessionID: sessionID}}
	d.mu.Unlock()
	// The run's own ids, as the host answered them: the trace's run record names this turn,
	// and this names the run the host executes for it — the id its own journal files the turn
	// under, and the one a post-mortem joins the two logs on.
	d.run.Trace.note("muse turn " + started.TurnID + " on session " + sessionID)
	go d.relay()
	return nil
}

// openSession is the conversation's session on this host: started fresh, resumed, or forked off the
// session the fork was copied from. What comes back is the session id this turn runs on — the
// fork's own after a branch, which is the moment the branch exists.
func (d *museDriver) openSession(conn *mspConn, run museRun) (string, error) {
	if run.forkSession && strings.TrimSpace(run.sessionID) != "" {
		params := map[string]any{
			"commandId": mspCommandID(), "sessionId": strings.TrimSpace(run.sessionID),
		}
		// Where the copy stops. Without it the host copies every completed turn, which is right
		// for a fork of a whole conversation and wrong for a fork from a point: the copy would
		// show half the conversation and Muse would remember all of it.
		if anchor := strings.TrimSpace(run.resumeAt); anchor != "" {
			params["cutPoint"] = map[string]any{"lastTurnId": anchor}
		}
		raw, err := conn.call("session/fork", params)
		if err != nil {
			return "", fmt.Errorf("The Muse session could not be branched: %s", museSentence(err))
		}
		var forked struct {
			Session struct {
				SessionID string `json:"sessionId"`
			} `json:"session"`
		}
		if err := json.Unmarshal(raw, &forked); err != nil || forked.Session.SessionID == "" {
			return "", errors.New("Muse branched the session and did not name the branch.")
		}
		return forked.Session.SessionID, nil
	}
	if session := strings.TrimSpace(run.sessionID); session != "" {
		raw, err := conn.call("session/resume", map[string]any{
			"commandId": mspCommandID(), "sessionId": session,
			// The history stays server-side: the transcript is the hub's own, read from its
			// store, and paging the session's would be a second account of the same turns.
			"excludeItems": true,
		})
		if err != nil {
			return "", fmt.Errorf("The Muse session could not be resumed: %s", museSentence(err))
		}
		var resumed struct {
			Session struct {
				SessionID string `json:"sessionId"`
			} `json:"session"`
		}
		if err := json.Unmarshal(raw, &resumed); err != nil || resumed.Session.SessionID == "" {
			return "", errors.New("Muse resumed the session and did not name it.")
		}
		return resumed.Session.SessionID, nil
	}
	workspace := strings.TrimSpace(run.storeRoot)
	if workspace == "" {
		workspace = run.workDir
	}
	raw, err := conn.call("session/start", map[string]any{
		"commandId": mspCommandID(), "workspaceRoot": workspace,
		"approvalMode": museApprovalMode(run.permissionMode, run.allowBypass),
	})
	if err != nil {
		return "", fmt.Errorf("Muse would not start a session: %s", museSentence(err))
	}
	var started struct {
		Session struct {
			SessionID string `json:"sessionId"`
		} `json:"session"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.Session.SessionID == "" {
		return "", errors.New("Muse started a session and did not name it.")
	}
	return started.Session.SessionID, nil
}

// spawnCompact shortens the session's context instead of starting a turn. The compaction runs
// asynchronously; the reader ends on the compaction item landing, or on a wait no turn should
// outlast — whichever comes first.
func (d *museDriver) spawnCompact(run museRun) error {
	if strings.TrimSpace(run.sessionID) == "" {
		d.mu.Lock()
		d.prologue = []AgentEvent{{Kind: agentBlock,
			Block: turnBlock{kind: blockKindText, text: "Nothing to compact yet."}}}
		d.prologueEnd, d.prologueCod = true, 0
		d.mu.Unlock()
		go d.relay()
		return nil
	}
	conn, err := spawnMSP(context.Background(), d.binary, museServeArgs(), run.workDir, nil, d.run.Trace)
	if err != nil {
		return err
	}
	d.run.Trace.exec(d.execRecord(conn.cmd, run))
	d.mu.Lock()
	d.conn = conn
	d.mu.Unlock()
	// The session has to be loaded on this host before it can be compacted: one host per
	// turn means no session is loaded yet, and compacting an id no host holds is refused.
	sessionID, err := d.openSession(conn, museRun{sessionID: run.sessionID})
	if err != nil {
		conn.close()
		d.mu.Lock()
		d.conn = nil
		d.prologue = []AgentEvent{{Kind: agentFailure, Message: err.Error()}}
		d.prologueEnd, d.prologueCod = true, 1
		d.mu.Unlock()
		go d.relay()
		return nil
	}
	raw, err := conn.call("session/compact", map[string]any{
		"commandId": mspCommandID(), "sessionId": sessionID,
	})
	if err != nil {
		conn.close()
		d.cleanup()
		return fmt.Errorf("Muse would not compact the session: %s", museSentence(err))
	}
	var admitted struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(raw, &admitted); err != nil {
		conn.close()
		d.cleanup()
		return errors.New("Muse answered the compaction with something unreadable.")
	}
	if admitted.Status == "noop" {
		conn.close()
		d.mu.Lock()
		d.conn = nil
		d.prologue = []AgentEvent{{Kind: agentBlock,
			Block: turnBlock{kind: blockKindText, text: "Nothing to compact."}}}
		d.prologueEnd, d.prologueCod = true, 0
		d.mu.Unlock()
		go d.relay()
		return nil
	}
	d.mu.Lock()
	d.sessionID = sessionID
	d.prologue = []AgentEvent{{Kind: agentSession, SessionID: sessionID}}
	d.compacting = true
	d.mu.Unlock()
	go d.relay()
	return nil
}

// stageConfig points the host at the turn's own configuration: a settings.json carrying the
// ledger's servers with the credentials written in, beside the staged skills and a symlink to the
// login the host is still the user's own. It answers the staging directory — "" for a turn handed
// no servers, which runs with the user's configuration untouched — and the environment the host is
// spawned with.
//
// **No trust.json is staged**, and that absence is the point. Without one the workspace is
// untrusted, so no project skill, rule or MCP declaration loads from the store — the counterpart
// of the Claude driver's --setting-sources user, for a CLI with no such flag. The DCMS skills
// travel as user skills instead (stageMuseSkills): a turn reads those, the user's own skills and
// the toolbox's servers, and nothing the folder it works in declares.
func (d *museDriver) stageConfig(run museRun) (string, []string, error) {
	if strings.TrimSpace(run.mcpConfig) == "" {
		return "", nil, nil
	}
	staging, err := os.MkdirTemp("", "muse-turn-")
	if err != nil {
		return "", nil, fmt.Errorf("The turn could not be given its tools: %w", err)
	}
	// Everything below removes the directory on the way out; the turn's credential lives in it.
	fail := func(err error) (string, []string, error) {
		os.RemoveAll(staging)
		return "", nil, err
	}
	configDir := filepath.Join(staging, "config", "muse")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return fail(fmt.Errorf("The turn could not be given its tools: %w", err))
	}
	settings := museSettings(substituteMuseMCPPlaceholders(run.mcpConfig, run.mcpToken))
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), []byte(settings), 0o600); err != nil {
		return fail(fmt.Errorf("The turn could not be given its tools: %w", err))
	}
	if err := stageMuseSkills(filepath.Join(configDir, "skills"), run.storeRoot); err != nil {
		return fail(fmt.Errorf("The turn could not be given its skills: %w", err))
	}
	// The login, linked rather than copied: the host reads through the link, and nothing secret is
	// duplicated into a directory keyed by turn. Left out when there is nothing to link — a host
	// with no login says so honestly when the turn runs.
	if home, err := os.UserHomeDir(); err == nil {
		auth := filepath.Join(museConfigDir(home), "muse", "auth.json")
		if _, err := os.Stat(auth); err == nil {
			_ = os.Symlink(auth, filepath.Join(configDir, "auth.json"))
		}
	}
	return staging, museEnvWith(filepath.Join(staging, "config")), nil
}

// stageMuseSkills builds the skills directory a staged turn reads as its user skills: the store's
// DCMS skills, plus the user's own, each linked rather than copied. It is a directory of links
// rather than a link to a directory because the two halves live in two places — the store and the
// user's config home — and the host reads only one.
//
// Only a store skill carrying this installer's marker travels. The staged workspace is untrusted
// on purpose (stageConfig), so a project skill would not load from the store — and the store's own
// skills, or ones that arrived through `git pull`, must not reach the turn through this door
// either. Where both halves name a skill, the user's own wins: it is the skill nobody here wrote,
// and overwriting it here would undo the foreign rule that protects it everywhere else.
//
// Left out when there is nothing to link, like the login: no store skills, no user skills, no
// directory.
func stageMuseSkills(dir, storeRoot string) error {
	links := map[string]string{}
	if root := strings.TrimSpace(storeRoot); root != "" {
		if entries, err := os.ReadDir(storeAgentsSkills(root)); err == nil {
			for _, entry := range entries {
				if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
					continue
				}
				abs := filepath.Join(storeAgentsSkills(root), entry.Name())
				if _, err := readSkillMarker(abs); err != nil {
					continue // the store's own, or arrived uninvited: not ours to hand over
				}
				links[entry.Name()] = abs
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if userSkills := strings.TrimSpace(defaultMuseSkillsPath(home)); userSkills != "" {
			if entries, err := os.ReadDir(userSkills); err == nil {
				for _, entry := range entries {
					if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
						continue
					}
					links[entry.Name()] = filepath.Join(userSkills, entry.Name())
				}
			}
		}
	}
	if len(links) == 0 {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

// museSettings is the settings.json a staged turn is given: this service's whole say in how the
// host is configured, which is the servers and nothing else.
func museSettings(servers string) string {
	return `{"schema_version":1,"mcp_servers":` + servers + `}`
}

// execRecord is how this turn's host was actually run, for the trace.
//
// Muse is the case the run record exists for. Its argument list says almost nothing — `muse serve`
// and no more — because everything about the turn is in a settings.json staged in a temporary
// directory, pointed at with XDG_CONFIG_HOME, and deleted on the way out with the turn's credential
// in it. Without this line the only copy of what the turn was handed dies with the turn. What is
// recorded is that file as it stood *before* the credentials were written into it: the same text
// for every turn, and nothing that has to be kept secret.
func (d *museDriver) execRecord(cmd *exec.Cmd, run museRun) traceExec {
	path, version := binaryVersion(d.binary)
	skills := ""
	if root := storeRootOf(d.cfg); root != "" {
		skills = storeAgentsSkills(root)
	}
	// A staged turn reads neither that directory nor the user's own, but the merge of the two
	// stageMuseSkills built for it — which is deleted with the turn, so the names are recorded
	// while it still exists. What the trace keeps of a staging is the names, not the contents:
	// those live on in the store and the user's home.
	if d.stagingDir != "" {
		if staged := filepath.Join(d.stagingDir, "config", "muse", "skills"); isSkillsDir(staged) {
			skills = staged
		}
	}
	rec := traceExec{
		Binary: d.binary, Path: path, Version: version,
		Argv: cmd.Args, Env: addedEnv(cmd.Env), Dir: cmd.Dir,
		SkillsPath: skills, Skills: installedSkills(skills),
	}
	if cmd.Process != nil {
		rec.PID = cmd.Process.Pid
	}
	if strings.TrimSpace(run.mcpConfig) != "" {
		rec.Config = museSettings(run.mcpConfig)
	}
	return rec
}

// museConfigDir is where the CLI keeps its configuration: the XDG config home, or the home it
// falls back on. It is the staging half of defaultMuseSkillsPath, which names the skills under it.
func museConfigDir(home string) string {
	if configHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configHome != "" {
		return configHome
	}
	return filepath.Join(home, ".config")
}

// museEnvWith is this process's environment with XDG_CONFIG_HOME pointed at the staged
// configuration. The key is replaced rather than appended: a duplicated variable leaves which of
// the two a process reads to the reader.
func museEnvWith(configHome string) []string {
	env := os.Environ()
	out := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if !strings.HasPrefix(entry, "XDG_CONFIG_HOME=") {
			out = append(out, entry)
		}
	}
	return append(out, "XDG_CONFIG_HOME="+configHome)
}

// cleanup removes the staged configuration, with the turn's credential in it. Called on every way
// out of a staged turn — a failed spawn, the reader's end — and safe to call for one that staged
// nothing.
func (d *museDriver) cleanup() {
	d.mu.Lock()
	staging := d.stagingDir
	d.stagingDir = ""
	d.mu.Unlock()
	if staging != "" {
		os.RemoveAll(staging)
	}
}

// museSentence is what a turn that never ran is refused with: the host's own message, or the
// error's. It is shown to the user as it stands, so it names Muse rather than a code.
func museSentence(err error) string {
	var rpcErr *mspError
	if errors.As(err, &rpcErr) && strings.TrimSpace(rpcErr.Message) != "" {
		return rpcErr.Message
	}
	return err.Error()
}

func (d *museDriver) Events() <-chan AgentEvent { return d.events }

// Answer decides one ask: approval/decide for a tool call, userInput/answer for a question. It is
// fire-and-forget by contract — the hub has already taken the ask off its pending set, so an error
// here is a log line rather than a retry, and the choice fallbacks below are written so that it
// essentially never comes to that.
func (d *museDriver) Answer(askID string, decision AskDecision) error {
	d.asksMu.Lock()
	ask, ok := d.asks[askID]
	d.asksMu.Unlock()
	if !ok {
		return errors.New("Muse is waiting for nothing by that name")
	}
	d.mu.Lock()
	conn, sessionID := d.conn, d.sessionID
	d.mu.Unlock()
	if conn == nil || sessionID == "" {
		return errors.New("The Muse turn has ended, so there is nothing to answer")
	}
	if ask.isQuestion() {
		return d.answerQuestion(conn, sessionID, ask, decision)
	}
	return d.answerApproval(conn, sessionID, ask, decision)
}

// answerApproval allows or denies one tool call. The choice is always the call's own: an allow
// answers the once-scoped approval, never the session-scoped one — "don't ask again this session"
// is broader than any card the hub shows, and answering it on the user's behalf would silence asks
// the user has not seen yet.
func (d *museDriver) answerApproval(conn *mspConn, sessionID string, ask *museAsk, decision AskDecision) error {
	choice := museChoiceFor(ask.choices, decision.Allow)
	if choice == nil {
		outcome := "allowed"
		if !decision.Allow {
			outcome = "denied"
		}
		return fmt.Errorf("Muse offered no way for that call to be %s", outcome)
	}
	commandID := mspCommandID()
	params := map[string]any{
		"commandId": commandID, "sessionId": sessionID,
		"approvalId": ask.approvalID, "choiceId": choice.choiceID,
		"requirementId": ask.requirement,
	}
	if !decision.Allow && choice.acceptsFeedback && strings.TrimSpace(decision.Message) != "" {
		params["feedback"] = decision.Message
	}
	// Recorded before the call goes out: the host answers the decision and settles the approval
	// in the same breath, and the relay reads this set the moment the settlement lands —
	// recording it after the answer would race the settlement and withdraw a card the hub
	// decided itself.
	d.asksMu.Lock()
	ask.answered = true
	if ask.decidedBy == nil {
		ask.decidedBy = map[string]bool{}
	}
	ask.decidedBy[commandID] = true
	d.asksMu.Unlock()
	if _, err := conn.call("approval/decide", params); err != nil {
		return fmt.Errorf("Muse would not take the decision: %s", museSentence(err))
	}
	// A decision that satisfied a stage but not the approval leaves it pending, and an updated
	// request follows: the ask stays marked answered so that update re-emits it rather than only
	// refreshing it — the hub took the card down when it answered, and the turn is about to park
	// again with nothing on screen.
	return nil
}

// museChoiceFor is the choice an allow or a deny takes: the once-scoped one of that outcome,
// falling back to any choice of it. A scope the vocabulary has moved past is still a scope the
// host offered, so anything beats nothing — except a policy amendment, which rewrites the rules
// rather than deciding the call and is never taken on the user's behalf.
func museChoiceFor(choices []museChoice, allow bool) *museChoice {
	want := "denied"
	if allow {
		want = "approved"
	}
	var fallback *museChoice
	for i := range choices {
		choice := &choices[i]
		if choice.decision != want {
			continue
		}
		if choice.scope == "once" {
			return choice
		}
		if fallback == nil {
			fallback = choice
		}
	}
	return fallback
}

// answerQuestion answers every question of a user-input prompt. An answer that names one of the
// question's own options goes back as the selection; anything else goes back as free text, which
// is what the tool reads the CLI's own "Other" as. A question left blank is answered with no text
// rather than skipped — the model is told it was not answered — and a card of nothing but blanks
// is declined outright, which is how a dismissal reads to the model.
func (d *museDriver) answerQuestion(conn *mspConn, sessionID string, ask *museAsk, decision AskDecision) error {
	// The hub hands back the input it was given with the answers filed under "answers", keyed by
	// question text — the map the tool reads.
	updated, _ := decision.Input.(map[string]any)
	answers, _ := updated["answers"].(map[string]any)
	entries := make([]map[string]any, 0, len(ask.questions))
	blanks := 0
	for i, question := range ask.questions {
		text := ""
		if key := museQuestionKey(ask, i); key != "" && answers != nil {
			text, _ = answers[key].(string)
		}
		if strings.TrimSpace(text) == "" {
			blanks++
		}
		entry := map[string]any{"questionId": question.id}
		switch selected := museSelectedLabels(question, text); {
		case len(selected) > 1 || (len(selected) == 1 && question.multiple):
			entry["selectedLabels"] = selected
		case len(selected) == 1:
			entry["selectedLabel"] = selected[0]
		default:
			entry["freeText"] = text
		}
		entries = append(entries, entry)
	}
	commandID := mspCommandID()
	// Recorded before the call goes out, for the same race the approval path names: the
	// settlement lands in the same breath as the answer.
	d.asksMu.Lock()
	ask.answered = true
	if ask.decidedBy == nil {
		ask.decidedBy = map[string]bool{}
	}
	ask.decidedBy[commandID] = true
	d.asksMu.Unlock()
	if blanks == len(entries) {
		_, err := conn.call("userInput/cancel", map[string]any{
			"commandId": commandID, "sessionId": sessionID,
			"userInputId": ask.userInputID, "reason": "The user dismissed the question.",
		})
		if err != nil {
			return fmt.Errorf("Muse would not take the dismissal: %s", museSentence(err))
		}
		return nil
	}
	if _, err := conn.call("userInput/answer", map[string]any{
		"commandId": commandID, "sessionId": sessionID,
		"userInputId": ask.userInputID, "answers": entries,
	}); err != nil {
		return fmt.Errorf("Muse would not take the answers: %s", museSentence(err))
	}
	return nil
}

// museQuestionKey is the answers-map key of one question: the question's text exactly as asked,
// which is what the hub files the answer under.
func museQuestionKey(ask *museAsk, index int) string {
	if index < 0 || index >= len(ask.ask.QuestionKeys) {
		return ""
	}
	return ask.ask.QuestionKeys[index]
}

// museSelectedLabels reads an answer against one question's options: the labels it names, in the
// order it names them. A multi-select answer carries its labels comma-separated, which is the form
// the hub writes; a single answer that is not one of its options is not a selection at all.
func museSelectedLabels(question museQuestion, answer string) []string {
	labels := map[string]bool{}
	for _, label := range question.labels {
		labels[label] = true
	}
	var selected []string
	if question.multiple {
		for _, part := range strings.Split(answer, ",") {
			if trimmed := strings.TrimSpace(part); labels[trimmed] {
				selected = append(selected, trimmed)
			}
		}
		return selected
	}
	if trimmed := strings.TrimSpace(answer); labels[trimmed] {
		return []string{trimmed}
	}
	return nil
}

// Say speaks into the running turn: turn/steer, which folds the text into it at its next tool
// boundary. A turn that has ended answers an error, and the message goes back to the box it was
// typed in rather than being queued for a turn that will never read it.
func (d *museDriver) Say(text string) error {
	d.mu.Lock()
	conn, sessionID, turnID := d.conn, d.sessionID, d.turnID
	d.mu.Unlock()
	if conn == nil || sessionID == "" || turnID == "" {
		return errors.New("The Muse turn has ended, so there is nothing to speak to")
	}
	_, err := conn.call("turn/steer", map[string]any{
		"commandId": mspCommandID(), "sessionId": sessionID, "expectedTurnId": turnID,
		"input": []any{map[string]any{"type": "text", "text": text}},
	})
	if err != nil {
		return fmt.Errorf("Muse would not take the message: %s", museSentence(err))
	}
	return nil
}

// Stop ends the turn now: the running turn is cancelled, and the host is killed. The relay then
// finds the pipe closed and ends the stream with a service-ended done, so a stopped turn settles
// the same way every other one does. Idempotent.
func (d *museDriver) Stop() {
	d.mu.Lock()
	if d.stopped {
		d.mu.Unlock()
		return
	}
	d.stopped = true
	conn, sessionID, turnID := d.conn, d.sessionID, d.turnID
	d.mu.Unlock()
	if conn != nil && sessionID != "" {
		params := map[string]any{"commandId": mspCommandID(), "sessionId": sessionID}
		if turnID != "" {
			params["turnId"] = turnID
		}
		// Best effort: the host may already be gone, and killing it below ends the turn either
		// way. Waiting for the answer here would park Stop on a host that is itself parking on
		// an approval nobody will ever decide.
		go func() { _, _ = conn.call("turn/cancel", params) }()
	}
	if conn != nil {
		logClaudeWS.Info("process killed",
			"agent", agentMuse, "conversation", d.run.Conversation, "turn", d.run.Turn)
		conn.close()
	}
}

// ── the stream ────────────────────────────────────────────────────────────────

// museCompactWait bounds a compaction turn: the reader ends on the compaction item landing, but a
// summarizer that never answers must not hold the conversation busy forever. The compaction itself
// continues server-side; the next turn simply carries the context it has.
const museCompactWait = 2 * time.Minute

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

// museBackgroundDrainTimeout bounds the drain: how long a turn that ended with
// background work still running waits for it before ending anyway. A workflow
// of several children is several agent turns of its own, so the bound is
// generous — thirty minutes of genuine work, not eight of silence — and past
// it the turn ends with the abandoned work named, rather than holding the
// conversation busy past any scrutiny.
const museBackgroundDrainTimeout = 30 * time.Minute

// museUsageReadTimeout bounds the harvest: the quota question a turn's end asks its host before it
// settles. A host that will not answer it in this long holds the turn's end up for nothing — the
// quota keeps its last figures instead.
const museUsageReadTimeout = 60 * time.Second

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
const museBlockedResumePrompt = "you were blocked and I had to stop you. Please resume."

// museBlockedTwiceMessage is the failure a turn ends on when it blocks a second time, after its
// resume. The chain runner reads it as the signal to fork the conversation and play the flow
// node again from the fork; anything else reading it reads a turn that never finished.
const museBlockedTwiceMessage = "Muse was blocked twice without ending the turn."

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
const museViewDownMessage = "Muse's live view is unavailable; the turn continues and its session is now polled."

// idleWait is how long the relay waits for a word from the host before ending the turn.
func (d *museDriver) idleWait() time.Duration {
	if d.idleTimeout > 0 {
		return d.idleTimeout
	}
	return museTurnIdleTimeout
}

// harvestWait is how long the harvest waits for the host's quota answer.
func (d *museDriver) harvestWait() time.Duration {
	if d.usageTimeout > 0 {
		return d.usageTimeout
	}
	return museUsageReadTimeout
}

// noticeWait is how long the relay waits for a word from the host before naming the silence.
func (d *museDriver) noticeWait() time.Duration {
	if d.noticeTimeout > 0 {
		return d.noticeTimeout
	}
	return museQuietNoticeAfter
}

// noticeRepeatWait is how long the relay waits between two namings of an ongoing silence: the
// first notice goes out after noticeWait, every following one a minute later.
func (d *museDriver) noticeRepeatWait() time.Duration {
	if d.noticeTimeout > 0 {
		return d.noticeTimeout
	}
	return museQuietNoticeRepeat
}

// resyncWait is how long one poll of a silent turn's session may take.
func (d *museDriver) resyncWait() time.Duration {
	if d.resyncTimeout > 0 {
		return d.resyncTimeout
	}
	return museResyncTimeout
}

// subagentWait is how long one child transcript read may take.
func (d *museDriver) subagentWait() time.Duration {
	if d.subagentTimeout > 0 {
		return d.subagentTimeout
	}
	return museSubagentReadTimeout
}

// parkedOnAsk reports whether the turn is waiting on something only a person can answer: an ask
// the hub has not decided yet. A decided one is the host's to settle, and a settled one is gone —
// neither holds the idle wait.
func (d *museDriver) parkedOnAsk() bool {
	d.asksMu.Lock()
	defer d.asksMu.Unlock()
	for _, ask := range d.asks {
		if !ask.answered {
			return true
		}
	}
	return false
}

// noteNotif files one notification in the turn's census: counted by method, the most recent
// one remembered. Called for every frame the host sends, including the ones the relay steps
// over in silence — the census is the record that stepping over leaves.
func (d *museDriver) noteNotif(method string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.notifCounts == nil {
		d.notifCounts = map[string]int{}
	}
	d.notifCounts[method]++
	d.lastNotif = method
	d.lastNotifAt = time.Now()
}

// eventSummary is the turn's notification census as one line: how many frames the host sent,
// of which methods, and the last one. Empty-handed is a sentence rather than zeros — a turn
// that heard nothing at all is the case this exists for.
//
// Either shape carries the silence behind it: a census that names the last word without saying
// how long ago it was spoken leaves a post-mortem joining two files for what one line could
// have said. A silence under a second reads as nothing — an end that arrives on time is not a
// silence, and its note reads exactly as before.
func (d *museDriver) eventSummary() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	quiet := d.quietSuffixLocked()
	if len(d.notifCounts) == 0 {
		return "the host sent nothing" + quiet
	}
	methods := make([]string, 0, len(d.notifCounts))
	total := 0
	for method, n := range d.notifCounts {
		methods = append(methods, method)
		total += n
	}
	sort.Strings(methods)
	parts := make([]string, 0, len(methods))
	for _, method := range methods {
		parts = append(parts, fmt.Sprintf("%s=%d", method, d.notifCounts[method]))
	}
	// Methods are the host's own vocabulary: bounded here rather than trusted, the way the
	// trace bounds the line itself.
	tail := ""
	if len(parts) > maxSummaryMethods {
		tail = " …"
		parts = parts[:maxSummaryMethods]
	}
	unit := "events"
	if total == 1 {
		unit = "event"
	}
	return fmt.Sprintf("%d %s (%s%s), last %s%s",
		total, unit, strings.Join(parts, " "), tail, d.lastNotif, quiet)
}

// quietSuffixLocked names how long the host has been silent, or nothing when it just spoke.
// The caller holds the lock; the zero time — a driver that never relayed — reads as nothing
// rather than as a silence of fifty years.
func (d *museDriver) quietSuffixLocked() string {
	if d.lastNotifAt.IsZero() {
		return ""
	}
	if quiet := time.Since(d.lastNotifAt); quiet >= time.Second {
		return "; quiet for " + quiet.Truncate(time.Second).String()
	}
	return ""
}

// quietFor is the same silence as a bare duration for the nudge: "2m0s", never empty, so a
// sentence built from it always reads. The relay sets the clock it reads from, so the fallback
// is unreachable outside a driver built by hand.
func (d *museDriver) quietFor() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.lastNotifAt.IsZero() {
		return "a while"
	}
	return time.Since(d.lastNotifAt).Truncate(time.Second).String()
}

// quietNotice is the sentence a silence names itself with: how long the host has been quiet,
// and — once the turn has been resumed after a blockage — how many times. A turn that never
// blocked reads exactly as it always did, which is what keeps the notice a nudge rather than a
// counter from the start.
func (d *museDriver) quietNotice() string {
	d.mu.Lock()
	relaunches := d.relaunches
	d.mu.Unlock()
	notice := "Muse has been quiet for " + d.quietFor() + "; the turn is still running."
	if relaunches > 0 {
		notice += fmt.Sprintf(" (relance %d)", relaunches)
	}
	return notice
}

// endCensus is the census as an end note keeps it: the count, the quiet behind it, and where
// the host's own account of the turn lives — the session journal the CLI keeps on disk whether
// this service asked for the protocol stream or not. Every end goes through it, so a
// post-mortem starts from a file rather than from a session id.
func (d *museDriver) endCensus() string {
	summary := d.eventSummary()
	d.mu.Lock()
	sessionID := d.sessionID
	d.mu.Unlock()
	if path := museHostSessionLog(sessionID); path != "" {
		summary += "; host session log " + path
	}
	return summary
}

// museHostSessionLog is the CLI's own journal for one of its sessions: the per-attempt record
// of what the host did, down to the provider retries it never announces over MSP. "" is
// unresolvable — no session, no data home, or no such file — which reads as no suffix rather
// than as a guess: a wrong path in a trace is worse than none.
//
// The layout is the CLI's own — sessions/<date>/<session>/session.jsonl under the data home —
// so the dated path is tried first and a glob second. The date is local, the way the CLI writes
// it, on the machine they share.
func museHostSessionLog(sessionID string) string {
	if sessionID == "" || strings.ContainsAny(sessionID, `/\`) || strings.Contains(sessionID, "..") {
		return ""
	}
	dataHome := museDataHome()
	if dataHome == "" {
		return ""
	}
	base := filepath.Join(dataHome, "muse", "sessions")
	dated := filepath.Join(base, time.Now().Format("2006/01/02"), sessionID, "session.jsonl")
	if info, err := os.Stat(dated); err == nil && !info.IsDir() {
		return dated
	}
	matches, _ := filepath.Glob(filepath.Join(base, "*", "*", "*", sessionID, "session.jsonl"))
	sort.Strings(matches)
	// Latest first: a session id is unique, but a stale same-named directory costs nothing
	// to step over, and a same-named directory is all it can ever be.
	for i := len(matches) - 1; i >= 0; i-- {
		if info, err := os.Stat(matches[i]); err == nil && !info.IsDir() {
			return matches[i]
		}
	}
	return ""
}

// museDataHome is where the CLI keeps what outlives a host: sessions, and the journal above.
// The config home is staged per turn and deleted with it, but the data home is the user's own
// and shared by every turn — which is what leaves a stopped turn anything to point at.
func museDataHome() string {
	if dir := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".local", "share")
}

// maxSummaryMethods bounds the census line: a turn hears a handful of methods, and anything
// past this is the host speaking a vocabulary nobody taught the driver.
const maxSummaryMethods = 12

// endWord names how the turn ended for the trace: the host's own terminal word, the reclaim
// for a turn that never ran — which carries none, per the schema — or the compaction for a
// turn whose work was one.
func (d *museDriver) endWord(method, terminal string) string {
	if terminal != "" {
		return terminal
	}
	if method == "turn/unqueued" {
		return "unqueued"
	}
	d.mu.Lock()
	compacting := d.compacting
	d.mu.Unlock()
	if compacting {
		return "compacted"
	}
	return method
}

// relay emits the turn as it happens and closes the stream with exactly one agentDone — whichever
// way the turn ended. It is the only emitter: Spawn prepares the prologue and the host, and
// everything from the session announcement to the end goes out here, in arrival order.
func (d *museDriver) relay() {
	defer close(d.events)
	defer d.cleanup()
	d.mu.Lock()
	prologue, prologueEnd, prologueCode := d.prologue, d.prologueEnd, d.prologueCod
	conn, compacting := d.conn, d.compacting
	d.mu.Unlock()

	for _, event := range prologue {
		d.events <- event
	}
	if prologueEnd {
		d.events <- AgentEvent{Kind: agentDone, ExitCode: prologueCode}
		return
	}
	if conn == nil {
		d.events <- AgentEvent{Kind: agentDone, ExitCode: 1}
		return
	}
	defer conn.close()

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
	d.mu.Lock()
	d.lastNotifAt = time.Now()
	d.mu.Unlock()
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
			d.noteNotif(note.Method)
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
				d.run.Trace.note("muse turn " + d.endWord(note.Method, terminal) + "; " + d.endCensus())
				d.harvestUsage(conn)
				d.events <- AgentEvent{Kind: agentDone, ExitCode: code, Terminal: terminal}
				return
			}
			if d.drainSettled() {
				// The last background item landed: the deferred end is due.
				d.finishDrain(conn, false)
				return
			}
		case <-compactTimer:
			d.run.Trace.note("muse turn ended waiting for the compaction; " + d.endCensus())
			d.events <- AgentEvent{Kind: agentBlock,
				Block: turnBlock{kind: blockKindText,
					text: "The compaction is still running; the turn ends here."}}
			d.events <- AgentEvent{Kind: agentDone, ExitCode: 0}
			return
		case <-idleTimer.C:
			// Parked on something only a person can answer, the turn is silent because it is
			// waiting — the wait starts over for as long as that is true.
			if d.parkedOnAsk() {
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
			// Silent the whole wait, but silence is not always a blockage: the live view
			// may be down while the turn works on. The session is polled before anything
			// is concluded — a turn that ended is ended here, a turn that lives waits on,
			// and only a turn neither dead nor alive resumes or forks as before.
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
			if !d.parkedOnAsk() {
				if d.isDraining() {
					notice := d.drainNotice()
					d.run.Trace.note(notice)
					d.events <- AgentEvent{Kind: agentNotice, Message: notice}
				} else {
					notice := d.quietNotice()
					d.run.Trace.note(notice + " still waiting on the host")
					d.events <- AgentEvent{Kind: agentNotice, Message: notice}
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

// resumeBlockedTurn stops the MSP turn blocked for the whole idle wait and starts a new one on
// the same session, asking it to pick itself back up where it stood. True when the turn
// continues: the stream stays open, the timers start over, and whatever the resumed turn says
// goes out as this turn's own. False when the resume never started — refused, or answered
// without a turn — in which case the caller ends the turn as blocked twice rather than as
// merely quiet. Only ever the first blockage: the relay asks once, and a silence after the
// resume ends the turn instead.
func (d *museDriver) resumeBlockedTurn(conn *mspConn) bool {
	d.mu.Lock()
	if d.relaunches > 0 {
		d.mu.Unlock()
		return false
	}
	sessionID, oldTurn := d.sessionID, d.turnID
	d.mu.Unlock()
	if conn == nil || strings.TrimSpace(sessionID) == "" {
		return false
	}
	d.run.Trace.note("muse blocked for the whole idle wait; stopping the turn and asking it to resume")
	cancelParams := map[string]any{"commandId": mspCommandID(), "sessionId": sessionID}
	if strings.TrimSpace(oldTurn) != "" {
		cancelParams["turnId"] = oldTurn
	}
	// Best effort, like Stop: the host may already be gone, and the start below failing ends
	// the turn either way.
	_, _ = conn.call("turn/cancel", cancelParams)
	raw, err := conn.call("turn/start", map[string]any{
		"commandId": mspCommandID(), "sessionId": sessionID,
		"input":  []any{map[string]any{"type": "text", "text": museBlockedResumePrompt}},
		"ifBusy": "replace",
	})
	if err != nil {
		d.run.Trace.note("muse resume after blockage refused: " + museSentence(err))
		return false
	}
	var started struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || strings.TrimSpace(started.TurnID) == "" {
		d.run.Trace.note("muse resume after blockage started no turn")
		return false
	}
	d.mu.Lock()
	d.turnID = started.TurnID
	// The resumed turn is a turn of its own: whatever the blocked one had cost
	// never closed into a bill, and must not leak into this one's.
	d.turnTokens = turnUsage{}
	d.turnBilled = false
	d.relaunches++
	d.lastNotifAt = time.Now()
	d.mu.Unlock()
	d.run.Trace.note("muse turn " + started.TurnID + " resumes after blockage (relance 1)")
	d.events <- AgentEvent{Kind: agentNotice,
		Message: "Muse was blocked and resumes where it stood. (relance 1)"}
	return true
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
func (d *museDriver) endUnfinished() {
	d.mu.Lock()
	stopped := d.stopped
	conn := d.conn
	d.turnID = ""
	d.mu.Unlock()
	// The pipe ended without the turn ending: killed, crashed, or stopped. The note says
	// which, and what the reader itself reported — a poison frame fails the reader where a
	// dead process simply ends the pipe, and only the note tells them apart.
	abandoned := d.abandonedNote()
	if stopped {
		d.run.Trace.note("muse turn stopped by the service; " + d.endCensus() + abandoned)
		d.events <- AgentEvent{Kind: agentDone, ExitCode: -1}
		return
	}
	summary := d.endCensus()
	if conn != nil {
		if err := conn.readError(); err != nil {
			summary += "; reader: " + err.Error()
		}
	}
	d.run.Trace.note("muse host ended in the middle of the turn; " + summary + abandoned)
	d.events <- AgentEvent{Kind: agentFailure,
		Message: "The Muse host ended in the middle of the turn."}
	d.events <- AgentEvent{Kind: agentDone, ExitCode: 1}
}

// endBlockedTwice ends a turn whose host blocked for the whole idle wait twice: once before
// the resume, once after it — and nothing parked. The turn failed, but its account so far
// stands — every block the host did send went out as it arrived — so the transcript keeps the
// work and the sentence says where it stopped. The chain runner reads this sentence as the
// signal to fork the conversation and play the flow node again from the fork.
func (d *museDriver) endBlockedTwice(conn *mspConn) {
	d.mu.Lock()
	d.turnID = ""
	d.mu.Unlock()
	d.run.Trace.note("muse blocked twice without ending the turn; ending it after the idle wait (" + d.endCensus() + ")" + d.abandonedNote())
	d.harvestUsage(conn)
	d.events <- AgentEvent{Kind: agentFailure, Message: museBlockedTwiceMessage}
	d.events <- AgentEvent{Kind: agentDone, ExitCode: 1}
}

// viewHealthChanged files the host's own verdict on its live view: unavailable means the
// projection failed closed, and from here nothing arrives unless polled for. The notice goes
// out once, on the transition — the quiet notices already name the silence that follows.
// Any other health is stepped over: the vocabulary is open, and an unrecognized value is not
// a verdict.
func (d *museDriver) viewHealthChanged(params map[string]any) (AgentEvent, bool) {
	if asString(params["health"]) != "unavailable" {
		return AgentEvent{}, false
	}
	d.mu.Lock()
	if named := asString(params["sessionId"]); named != "" && named != d.sessionID {
		d.mu.Unlock()
		return AgentEvent{}, false
	}
	already := d.viewDown
	d.viewDown = true
	d.mu.Unlock()
	d.run.Trace.note("muse live view unavailable; the turn continues blind and the driver polls the session")
	if already {
		return AgentEvent{}, false
	}
	return AgentEvent{Kind: agentNotice, Message: museViewDownMessage}, true
}

// ── the resync ───────────────────────────────────────────────────────────────

// resyncOutcome is what one poll of a silent turn's session concluded: the turn ended and was
// ended here, the turn lives and waits on, or the poll learned nothing and the blockage is
// concluded as before — resumed once, forked twice.
type resyncOutcome int

const (
	resyncStill resyncOutcome = iota
	resyncAlive
	resyncEnded
)

// resyncBlockedTurn polls a turn silent for the whole idle wait before the relay concludes
// anything about it. Silence is not always a blockage: the live view may be down while the
// turn works on, and killing a productive turn for a dead stream — then forking a finished
// one — is what the resync exists to stop.
//
// Three pulls, cheapest signal last. The missed view events are paged and fed through the
// relay path, so whatever the stream dropped lands as the turn's own; the session read says
// whether the turn still runs and what it parks on; and the host journal's growth says the
// host wrote, which no wedged turn does. A turn that ended is ended here with what was
// recovered, a turn that lives waits another wait, and only a turn neither dead nor alive
// falls through to the resume and the fork. A poll that fails answers nothing and falls
// through the same way — today's behaviour is the safe default, not the punishment.
func (d *museDriver) resyncBlockedTurn(conn *mspConn) resyncOutcome {
	d.mu.Lock()
	sessionID, turnID, cursor := d.sessionID, d.turnID, d.lastCursor
	d.mu.Unlock()
	if conn == nil || sessionID == "" || turnID == "" {
		return resyncStill
	}
	d.run.Trace.note("muse silent for the whole idle wait; polling the session before concluding")
	paged, end := d.pageMissed(conn, sessionID, cursor)
	if end != nil {
		phrase := d.endWord(end.method, end.terminal) + " (recovered from the session view)"
		if d.enterDrain(conn, phrase, end.code, end.terminal) {
			return resyncAlive
		}
		d.run.Trace.note("muse turn " + phrase + "; " + d.endCensus())
		d.harvestUsage(conn)
		d.events <- AgentEvent{Kind: agentDone, ExitCode: end.code, Terminal: end.terminal}
		return resyncEnded
	}
	status, active, parked := d.readSessionTurn(conn, sessionID)
	if status == "" && !parked.known {
		// The read itself failed: the poll learned nothing. The journal below may still
		// speak — a host too wedged to answer never writes — but past it the blockage
		// is concluded as before.
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
		if blind := d.unseenAsks(parked.parked); blind > 0 {
			d.mu.Lock()
			parks := d.blindParks
			d.blindParks++
			d.mu.Unlock()
			if parks >= 1 {
				d.run.Trace.note("muse turn still parked on unseen asks; concluding the blockage")
				return resyncStill
			}
			d.run.Trace.note("muse turn parked on asks that never arrived; waiting on")
			d.events <- AgentEvent{Kind: agentNotice, Message: fmt.Sprintf(
				"Muse is waiting on %s that never arrived; the turn continues and the wait restarts.",
				pluralAsks(blind))}
			d.touchedByResync()
			return resyncAlive
		}
		d.mu.Lock()
		d.blindParks = 0
		d.mu.Unlock()
		if paged == 0 {
			d.run.Trace.note("muse turn parked on asks the hub holds; their settlements never arrived — waiting on")
			d.touchedByResync()
			return resyncAlive
		}
	}
	d.mu.Lock()
	d.blindParks = 0
	d.mu.Unlock()
	if paged > 0 {
		d.run.Trace.note(fmt.Sprintf(
			"muse turn still running; %s replayed from the session view", pluralEvents(paged)))
		d.events <- AgentEvent{Kind: agentNotice, Message: fmt.Sprintf(
			"Muse is still running; %s replayed from the session, the turn continues.",
			pluralEvents(paged))}
		d.touchedByResync()
		return resyncAlive
	}
	return d.resyncByJournal(paged)
}

// resyncByJournal concludes a resync whose pulls found no events and no end: the host journal
// is the last liveness signal. Growth is work — the wait starts over. Stillness is a wedged
// turn — the blockage is concluded as before.
func (d *museDriver) resyncByJournal(paged int) resyncOutcome {
	_ = paged
	if !d.journalGrew() {
		return resyncStill
	}
	d.run.Trace.note("muse turn still running; the live view is down but the host journal grows")
	d.events <- AgentEvent{Kind: agentNotice, Message: "Muse is still running (its live view is down); the turn continues."}
	d.touchedByResync()
	return resyncAlive
}

// touchedByResync files a resync that heard from the host: the silence dates from here, like
// any word from the host would.
func (d *museDriver) touchedByResync() {
	d.mu.Lock()
	d.lastNotifAt = time.Now()
	d.mu.Unlock()
}

// endRecovered ends a turn the poll found finished server-side: the stream never said so, but
// the session is idle and a wedged turn never idles. The transcript keeps what arrived before
// the view died and the notice says the end itself was recovered; the chain runner reads a
// clean end, not a blockage, so a finished turn is done rather than forked and replayed.
// Background work still open instead defers the end: the outcome is alive, and the relay
// keeps waiting on the drain rather than settling here.
func (d *museDriver) endRecovered(conn *mspConn, paged int) resyncOutcome {
	d.mu.Lock()
	d.lastTurnID = d.turnID
	d.turnID = ""
	d.mu.Unlock()
	if d.enterDrain(conn, "ended server-side while silent", 0, "") {
		return resyncAlive
	}
	d.run.Trace.note(fmt.Sprintf(
		"muse turn ended server-side while silent, without its terminal word; ending it here (%s replayed; %s)",
		pluralEvents(paged), d.endCensus()))
	d.harvestUsage(conn)
	d.events <- AgentEvent{Kind: agentNotice, Message: fmt.Sprintf(
		"Muse ended the turn while its live view was down; %s replayed.", pluralEvents(paged))}
	d.events <- AgentEvent{Kind: agentDone, ExitCode: 0}
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
func (d *museDriver) pageMissed(conn *mspConn, sessionID, after string) (int, *pagedEnd) {
	fed := 0
	feed := func(events []mspViewEvent) *pagedEnd {
		for _, event := range events {
			if event.Method == "" {
				continue
			}
			d.noteNotif(event.Method)
			done, code, terminal := d.relayOne(mspNotification{
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
			d.run.Trace.note("muse view page failed: " + museSentence(err))
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
			d.run.Trace.note("muse view page failed: " + museSentence(err))
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
	d.run.Trace.note("muse view page capped; the oldest missed events stay missed")
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

// unseenAsks counts the pending asks nobody was shown: the ones the hub does not hold. An
// entry naming no id cannot match anything held and counts as unseen — the conservative
// side, since an unmatched settlement is a wait and a matched one nobody saw is a stall.
func (d *museDriver) unseenAsks(parked []sessionAsk) int {
	d.asksMu.Lock()
	defer d.asksMu.Unlock()
	unseen := 0
	for _, ask := range parked {
		if ask.id == "" {
			unseen++
			continue
		}
		if _, ok := d.asks[ask.id]; !ok {
			unseen++
		}
	}
	return unseen
}

// readSessionTurn reads the session without attaching to it: no lease, no load, no
// subscription — a point-in-time look at whether the turn still runs. Unknown is a read that
// failed or that answered nothing usable, which the resync treats as no signal either way.
func (d *museDriver) readSessionTurn(conn *mspConn, sessionID string) (string, string, sessionTurn) {
	raw, err := conn.callTimeout("session/read", map[string]any{
		"sessionId": sessionID, "excludeItems": true,
	}, d.resyncWait())
	if err != nil {
		d.run.Trace.note("muse session poll failed: " + museSentence(err))
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
		d.run.Trace.note("muse session poll could not be understood: " + museSentence(err))
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
			ask.id = museAskApprovalPrefix + pending.ApprovalID
		case pending.UserInputID != "":
			ask.id = museAskQuestionPrefix + pending.UserInputID
		}
		turn.parked = append(turn.parked, ask)
	}
	return read.Session.Status, turn.active, turn
}

// noteJournal takes the host journal's baseline: the size and modification time the resyncs
// below compare against. Best effort — an unresolvable journal simply leaves no baseline, and
// the first sighting of one then counts as growth.
func (d *museDriver) noteJournal() {
	path := d.journalPath()
	if path == "" {
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	d.mu.Lock()
	d.journalSize, d.journalAt, d.journalKnown = info.Size(), info.ModTime(), true
	d.mu.Unlock()
}

// journalGrew reports whether the host wrote to its journal since the baseline — and moves the
// baseline here either way, so each resync judges its own window. Only metadata is read, never
// the records: growth says the host did something, which is the whole of the signal. A journal
// that cannot be resolved says nothing, and a first sighting says growth, since a journal that
// appeared was written.
func (d *museDriver) journalGrew() bool {
	path := d.journalPath()
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	size, at, known := info.Size(), info.ModTime(), d.journalKnown
	grew := !known || size != d.journalSize || at.After(d.journalAt)
	d.journalSize, d.journalAt, d.journalKnown = size, at, true
	return grew
}

// journalPath resolves the host journal of this turn's session: the file a post-mortem opens,
// and the resync's liveness signal. Empty is unresolvable — no session yet, or no data home.
func (d *museDriver) journalPath() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return museHostSessionLog(d.sessionID)
}

// museWorkItem is one background item still running: the kind, and the line the
// drain names it with.
type museWorkItem struct {
	kind  string
	label string
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

// ── the drain ─────────────────────────────────────────────────────────────────
//
// A turn can end with work still running past it: a workflow it launched, a
// subagent it never waited on, a tool call sent to the background. That work
// runs in the turn's host, and the host is killed when the turn ends — so
// ending the turn on the end's arrival would orphan it. The drain is the wait
// in between: the relay tracks background items opening and completing, and a
// turn that ends with any still open keeps its host until they land, bounded
// by the drain's own timeout, and only then settles on the end it deferred.

// museBackgroundKind reports whether an item is work that may outlive its turn:
// a workflow run, a subagent delegation, or a tool call sent to the background.
// Every other kind completes within the turn that ran it — or, like a
// reminderChild, is the host's own housekeeping, which no turn waits on.
func museBackgroundKind(item map[string]any) bool {
	switch asString(item["kind"]) {
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
	switch asString(item["kind"]) {
	case "workflow":
		return fmt.Sprintf("workflow %q",
			orDefault(asString(item["entryId"]), asString(item["itemId"])))
	case "subagent":
		return fmt.Sprintf("subagent %q",
			orDefault(orDefault(asString(item["role"]), asString(item["objective"])),
				asString(item["itemId"])))
	default:
		return fmt.Sprintf("background tool call %q",
			orDefault(asString(item["tool"]), asString(item["itemId"])))
	}
}

// museWorkProgress is one background item's update as a trace suffix: the
// revision, and the child count where the item folds children. The statuses
// stay the host journal's to tell: the trace names the movement, not the work.
func museWorkProgress(item map[string]any) string {
	progress := ""
	if revision, ok := asInt64(item["revision"]); ok && revision > 0 {
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
func (d *museDriver) noteItemState(params map[string]any) {
	item, _ := params["item"].(map[string]any)
	if len(item) == 0 || !museBackgroundKind(item) {
		return
	}
	id := asString(item["itemId"])
	if id == "" {
		return
	}
	d.mu.Lock()
	turnID, lastTurnID := d.turnID, d.lastTurnID
	d.mu.Unlock()
	if itemTurn := asString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
		return
	}
	if asString(item["status"]) != "inProgress" {
		d.closeWork(id)
		// Defensive: an opening or updating item is open by schema, so a terminal word here
		// means the completion took another path — the resync's pages hold older turns' items
		// too, and a gap may have eaten the completion. The roster marks it finished rather
		// than dropping a task it already showed, which is what the `item/completed` path
		// below does on the record.
		if event := d.rosterFinished(item); event != nil {
			d.events <- *event
		}
		return
	}
	work := museWorkItem{kind: asString(item["kind"]), label: museWorkLabel(item)}
	progress := museWorkProgress(item)
	d.mu.Lock()
	if d.openWork == nil {
		d.openWork = map[string]museWorkItem{}
	}
	_, known := d.openWork[id]
	d.openWork[id] = work
	d.mu.Unlock()
	if known {
		d.run.Trace.note("muse background " + work.label + " updated" + progress)
	}
	if event := d.rosterUpsert(item); event != nil {
		d.events <- *event
	}
}

// closeWork forgets one background item: it completed, failed, or was never
// tracked at all.
func (d *museDriver) closeWork(id string) {
	if id == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.openWork, id)
}

// rosterUpsert files one background item opening or updating, and answers the
// roster event the caller sends. Nil is an item with no id, which is no task
// at all.
func (d *museDriver) rosterUpsert(item map[string]any) *AgentEvent {
	task, ok := museRosterTask(item)
	if !ok {
		return nil
	}
	d.rosterPut(task)
	event := d.rosterSnapshot()
	return &event
}

// rosterFinished files one background item completing, and answers the roster
// event the caller sends. Unknown ids are filed rather than dropped: a gap may
// have eaten the opening, and a task that landed is still a task.
func (d *museDriver) rosterFinished(item map[string]any) *AgentEvent {
	task, ok := museRosterFinishedTask(item)
	if !ok {
		return nil
	}
	d.rosterPut(task)
	event := d.rosterSnapshot()
	return &event
}

// museRosterTask is one background item opening or updating as the roster
// reports it, with a workflow's folded children beneath it. False is an item
// with no id, which is no task at all.
func museRosterTask(item map[string]any) (BackgroundTask, bool) {
	id := asString(item["itemId"])
	if id == "" {
		return BackgroundTask{}, false
	}
	kind := asString(item["kind"])
	generic := asString(item["status"])
	// The fine word is a subagent's own: the control status says what the
	// generic one cannot while the delegation is out — `running`, `resultReady`,
	// `manualReconciliation` against a bare `inProgress`. A workflow's story is
	// told by its children, and a tool call has no finer word, so both keep the
	// generic one.
	display := generic
	fine := ""
	if kind == "subagent" {
		fine = asString(item["controlStatus"])
		if fine != "" {
			display = fine
		}
	}
	task := BackgroundTask{
		ID: id, Kind: kind,
		Label:  cutRunes(museWorkLabel(item), maxSubagentNameChars),
		Status: cutRunes(orDefault(display, generic), maxSubagentNameChars),
		State:  museRosterState(generic, fine),
	}
	if kind == "workflow" {
		task.Children = museRosterChildren(item)
	}
	return task, true
}

// museRosterFinishedTask is one background item completing as the roster
// reports it: finished, on the generic verdict the host gave — the completion
// is the verdict, so an item carrying no word at all still reads `completed`
// rather than nothing. A workflow's children are folded from the completed
// item, which is what the final roster shows each child coming to.
func museRosterFinishedTask(item map[string]any) (BackgroundTask, bool) {
	id := asString(item["itemId"])
	if id == "" {
		return BackgroundTask{}, false
	}
	kind := asString(item["kind"])
	task := BackgroundTask{
		ID: id, Kind: kind,
		Label:  cutRunes(museWorkLabel(item), maxSubagentNameChars),
		Status: cutRunes(orDefault(asString(item["status"]), "completed"), maxSubagentNameChars),
		State:  BackgroundFinished,
	}
	if kind == "workflow" {
		task.Children = museRosterChildren(item)
	}
	return task, true
}

// rosterPut keeps one task. True is a task the roster did not already hold as
// is — new, or saying something new — which is what the reconcile emits on.
func (d *museDriver) rosterPut(task BackgroundTask) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.roster == nil {
		d.roster = map[string]BackgroundTask{}
	}
	if held, known := d.roster[task.ID]; known {
		if backgroundTaskEqual(held, task) {
			return false
		}
	} else {
		d.rosterOrder = append(d.rosterOrder, task.ID)
	}
	d.roster[task.ID] = task
	return true
}

// rosterSnapshot is the roster whole, in first-sight order: the event the
// caller sends. What is sent is never touched again: a later store overwrites
// the map entry wholesale, and the hub settles into a copy of its own, so
// neither side ever rewrites the other's hold.
func (d *museDriver) rosterSnapshot() AgentEvent {
	d.mu.Lock()
	defer d.mu.Unlock()
	snapshot := make([]BackgroundTask, 0, len(d.rosterOrder))
	for _, id := range d.rosterOrder {
		snapshot = append(snapshot, d.roster[id])
	}
	return AgentEvent{Kind: agentBackground, Background: snapshot}
}

// museRosterState is where one background item stands, in this service's word.
// The generic status is the terminal authority — anything but `inProgress` is
// finished — and the fine word names the one parked state: a delegation the
// host quarantined (`manualReconciliation`) ended without a result this
// service could reconcile, and counting it running would be the wait that
// never ends, while counting it finished would be a verdict nobody gave.
func museRosterState(generic, fine string) BackgroundState {
	if generic != "" && generic != "inProgress" {
		return BackgroundFinished
	}
	if isManualReconciliation(fine) {
		return BackgroundWaiting
	}
	return BackgroundRunning
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
func museRosterChildren(item map[string]any) []BackgroundChild {
	raw, _ := item["children"].([]any)
	out := make([]BackgroundChild, 0, len(raw))
	// at holds each child's row and best attempt so far: a retry replaces its
	// row in place, keeping first-sight order.
	at := map[string]int{}
	attemptOf := map[string]int64{}
	for _, entry := range raw {
		child, _ := entry.(map[string]any)
		if len(child) == 0 {
			continue
		}
		id := asString(child["childId"])
		if id == "" {
			continue
		}
		attempt, _ := asInt64(child["attempt"])
		if seen, known := attemptOf[id]; known && attempt < seen {
			continue
		}
		status := asString(child["status"])
		terminal := asString(child["terminal"])
		state := BackgroundRunning
		switch {
		case terminal != "":
			// The explicit verdict wins: whatever the lifecycle word still
			// says, a child that reached a terminal landed.
			state = BackgroundFinished
		case isManualReconciliation(status):
			state = BackgroundWaiting
		case status == "" || status == "inProgress" || status == "running":
			// The known active words — the lifecycle's own `running`, the
			// generic `inProgress`, and the missing word, which keeps
			// watching rather than hiding a child behind a verdict nobody
			// gave. Anything else is terminal-unknown: finished, with the
			// word itself displayed, which is what the schema asks of an
			// open enum (`completed`, `failed`, `resultReady`, `closed`).
			state = BackgroundRunning
		default:
			state = BackgroundFinished
		}
		// The most telling word wins twice: the lifecycle status while the
		// child is out, the terminal verdict once it has landed.
		display := orDefault(status, terminal)
		row := BackgroundChild{
			ChildID:  id,
			Label:    cutRunes(orDefault(asString(child["label"]), id), maxSubagentNameChars),
			Status:   cutRunes(orDefault(display, "inProgress"), maxSubagentNameChars),
			State:    state,
			Terminal: cutRunes(terminal, maxSubagentNameChars),
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

// openWorkCount is how many background items are still running.
func (d *museDriver) openWorkCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.openWork)
}

// openWorkDesc counts the tracked background work and names it: "2 background
// tasks (workflow "a", subagent "b")". The labels read sorted, whatever order
// the map holds, so the note is stable run to run.
func (d *museDriver) openWorkDesc() (int, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	n := len(d.openWork)
	if n == 0 {
		return 0, "no background tasks"
	}
	labels := make([]string, 0, n)
	for _, work := range d.openWork {
		labels = append(labels, work.label)
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

// abandonedNote names the background work dying with its host: "" when the
// turn held none, so every end note reads exactly as it always did.
func (d *museDriver) abandonedNote() string {
	n, desc := d.openWorkDesc()
	if n == 0 {
		return ""
	}
	return "; " + desc + " abandoned with it"
}

// isDraining reports whether the turn's end is deferred on background work.
func (d *museDriver) isDraining() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.draining
}

// drainChan is the drain's bound as the relay selects on it: nil until the
// drain starts, so the timeout branch sleeps until there is a drain to bound.
func (d *museDriver) drainChan() <-chan time.Time {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.drainCh
}

// drainWait is how long the drain waits for background work still running when
// the turn ended.
func (d *museDriver) drainWait() time.Duration {
	if d.drainTimeout > 0 {
		return d.drainTimeout
	}
	return museBackgroundDrainTimeout
}

// enterDrain defers the turn's end on its background work still running: the
// host stays up until that work lands or the drain times out. True is a turn
// that keeps relaying; false is nothing to wait on, and the caller ends the
// turn as it always did. The live set is reconciled against the session first:
// an update the stream dropped would otherwise hold the drain to its timeout,
// and an opening it dropped would be killed as nothing. Where the reconcile
// cannot be read, the live set stands — a wait on what was seen beats an end
// over what was not.
func (d *museDriver) enterDrain(conn *mspConn, end string, code int, terminal string) bool {
	if d.isDraining() {
		return true
	}
	d.reconcileOpenWork(conn)
	wait := d.drainWait()
	d.mu.Lock()
	if len(d.openWork) == 0 {
		d.mu.Unlock()
		return false
	}
	d.draining = true
	d.drainEnd, d.drainCode, d.drainTerminal = end, code, terminal
	d.drainTotal = len(d.openWork)
	d.drainStarted = time.Now()
	d.drainCh = time.After(wait)
	d.mu.Unlock()
	_, desc := d.openWorkDesc()
	d.run.Trace.note(fmt.Sprintf("muse turn %s with %s still running; draining before ending (timeout %s)",
		end, desc, wait.Truncate(time.Second)))
	n, _ := d.openWorkDesc()
	pronoun := "it"
	if n > 1 {
		pronoun = "them"
	}
	d.events <- AgentEvent{Kind: agentNotice, Message: fmt.Sprintf(
		"The turn ended with %s still running; waiting for %s to finish.",
		pluralTasks(n), pronoun)}
	return true
}

// reconcileOpenWork re-reads the turn's background work against the session's
// folded history: the live stream may have dropped an opening or a completion,
// and the fold is the truth either way. Unreadable — the call refused, no
// inline history served, the payload past understanding — the live set stands.
func (d *museDriver) reconcileOpenWork(conn *mspConn) {
	d.mu.Lock()
	sessionID, turnID, lastTurnID, live := d.sessionID, d.turnID, d.lastTurnID, len(d.openWork)
	d.mu.Unlock()
	if conn == nil || sessionID == "" || live == 0 {
		return
	}
	raw, err := conn.callTimeout("session/read", map[string]any{
		"sessionId": sessionID, "excludeItems": false,
	}, d.resyncWait())
	if err != nil {
		d.run.Trace.note("muse drain could not reconcile against the session (" +
			museSentence(err) + "); tracking " + pluralTasks(live))
		return
	}
	var read struct {
		History struct {
			Items []map[string]any `json:"items"`
		} `json:"history"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		d.run.Trace.note("muse drain reconcile could not be understood (" +
			museSentence(err) + "); tracking " + pluralTasks(live))
		return
	}
	if read.History.Items == nil {
		d.run.Trace.note("muse drain reconcile served no inline history; tracking " + pluralTasks(live))
		return
	}
	fold := map[string]museWorkItem{}
	rosterMoved := false
	for _, item := range read.History.Items {
		id := asString(item["itemId"])
		if id == "" || !museBackgroundKind(item) {
			continue
		}
		if itemTurn := asString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
			continue
		}
		// The roster learns the fold too: an opening the stream dropped is a
		// task the user never saw, and a completion it dropped is one still
		// standing `running`. Both are filed, and one event carries the
		// whole truth — but only when the truth moved, so a reconcile that
		// confirms the live set is silent rather than a duplicate frame.
		if asString(item["status"]) != "inProgress" {
			if task, ok := museRosterFinishedTask(item); ok && d.rosterPut(task) {
				rosterMoved = true
			}
			continue
		}
		fold[id] = museWorkItem{kind: asString(item["kind"]), label: museWorkLabel(item)}
		if task, ok := museRosterTask(item); ok && d.rosterPut(task) {
			rosterMoved = true
		}
	}
	d.mu.Lock()
	before := d.openWork
	d.openWork = fold
	d.mu.Unlock()
	if !sameWorkKeys(before, fold) {
		_, desc := d.openWorkDesc()
		d.run.Trace.note(fmt.Sprintf("muse drain reconciled %s live against the session: %s open",
			pluralTasks(live), desc))
	}
	if rosterMoved {
		d.events <- d.rosterSnapshot()
	}
}

// sameWorkKeys reports whether two tracked sets hold the same items.
func sameWorkKeys(a, b map[string]museWorkItem) bool {
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
func (d *museDriver) drainSettled() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.draining && len(d.openWork) == 0
}

// finishDrain settles the deferred end: the note keeps the end the turn reached
// and the drain it waited through, and the turn settles on the deferred code.
// Timed out, the remaining work is named as abandoned — the close that follows
// stops it with its host — and the notice says so out loud.
func (d *museDriver) finishDrain(conn *mspConn, timedOut bool) {
	d.mu.Lock()
	end, code, terminal := d.drainEnd, d.drainCode, d.drainTerminal
	total := d.drainTotal
	d.draining = false
	d.drainCh = nil
	d.mu.Unlock()
	if timedOut {
		_, desc := d.openWorkDesc()
		d.run.Trace.note(fmt.Sprintf("muse turn %s; drain timed out with %s abandoned; %s",
			end, desc, d.endCensus()))
		n, _ := d.openWorkDesc()
		verb, pronoun := "was", "it"
		if n > 1 {
			verb, pronoun = "were", "them"
		}
		d.events <- AgentEvent{Kind: agentNotice, Message: fmt.Sprintf(
			"%s %s still running; ending the turn without %s.",
			pluralTasks(n), verb, pronoun)}
	} else {
		d.run.Trace.note(fmt.Sprintf("muse turn %s after draining %s; %s",
			end, pluralTasks(total), d.endCensus()))
		d.events <- AgentEvent{Kind: agentNotice,
			Message: "Background work finished; the turn ends here."}
	}
	d.harvestUsage(conn)
	d.events <- AgentEvent{Kind: agentDone, ExitCode: code, Terminal: terminal}
}

// resyncDrain polls a drain silent for the whole idle wait: the missed view
// events are paged and fed through the relay path, so a completion the stream
// dropped still lands. True is a settled drain, and the caller ends the turn;
// false waits another wait. Never a resume and never a fork: the turn already
// ended, and only its background work is still out.
func (d *museDriver) resyncDrain(conn *mspConn) bool {
	d.mu.Lock()
	sessionID, cursor := d.sessionID, d.lastCursor
	d.mu.Unlock()
	if conn == nil || sessionID == "" {
		return false
	}
	paged, end := d.pageMissed(conn, sessionID, cursor)
	if end != nil {
		// The replay carried a second end for a turn that already ended: the
		// first one stands, and the drain waits on regardless.
		d.run.Trace.note("muse drain replayed a second end (" + end.method + "); the first one stands")
	}
	if d.openWorkCount() == 0 {
		return true
	}
	d.touchedByResync()
	_, desc := d.openWorkDesc()
	d.run.Trace.note(fmt.Sprintf("muse drain still waiting on %s (%s replayed)",
		desc, pluralEvents(paged)))
	return false
}

// drainNotice is the sentence a drain names itself with: what it still waits
// on, and for how long. A silence past the turn's end is waiting, not quiet,
// and says so.
func (d *museDriver) drainNotice() string {
	d.mu.Lock()
	started := d.drainStarted
	d.mu.Unlock()
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

// relayOne translates one host notification into what it means to the hub, emitting every event it
// carries. It reports whether the turn ends here, on what code, and — for an end the host named
// in words — on what terminal.
func (d *museDriver) relayOne(note mspNotification) (bool, int, string) {
	var params map[string]any
	if len(note.Params) > 0 {
		_ = json.Unmarshal(note.Params, &params)
	}
	// Every view notification carries its cursor, live or paged: the newest one seen is
	// where a resync pages from, so a replay can never re-emit what the relay already
	// holds. Ephemeral frames carry none and leave the cursor where it stands.
	if cursor := asString(params["viewCursor"]); cursor != "" {
		d.mu.Lock()
		d.lastCursor = cursor
		d.mu.Unlock()
	}
	switch note.Method {
	case "item/started", "item/updated":
		d.noteItemState(params)
	case "item/completed":
		for _, event := range d.completedItem(params) {
			if event.Kind == agentDone {
				return true, event.ExitCode, event.Terminal
			}
			d.events <- event
		}
	case "approval/requested":
		if event, ok := d.approvalAsked(params); ok {
			d.events <- event
		}
	case "approval/resolved":
		if event, ok := d.approvalSettled(params); ok {
			d.events <- event
		}
	case "approval/updated":
		if event, ok := d.approvalUpdated(params); ok {
			d.events <- event
		}
	case "userInput/requested":
		if event, ok := d.questionAsked(params); ok {
			d.events <- event
		}
	case "userInput/settled":
		if event, ok := d.questionSettled(params); ok {
			d.events <- event
		}
	case "turn/completed":
		if done, code, terminal, events := d.turnCompleted(params); done {
			for _, event := range events {
				d.events <- event
			}
			return true, code, terminal
		}
	case "turn/unqueued":
		if done, code, event := d.turnUnqueued(params); done {
			if event != nil {
				d.events <- *event
			}
			return true, code, ""
		}
	case "session/tokenUsage":
		// One model completion's token usage, folded into the running turn's bill —
		// the per-turn figures the transcript files. Not the quota: usage/changed
		// below is the account, this is the turn.
		d.noteTokenUsage(params)
	case "usage/changed":
		// The host's account figures moved mid-turn: recorded as they land, so a long turn's
		// quota is live rather than only current at its end. It emits nothing — a refresh
		// answers what was recorded.
		d.noteUsageChanged(note.Params)
	case "view/gap":
		// The host dropped events it could not deliver: the turn's account has a hole in it, and
		// the log says so where grepping for the turn finds it. The trace keeps it too — the
		// service log is a console, but the trace is the file a post-mortem opens.
		logClaudeWS.Warn("muse view gap; the turn lost events",
			"conversation", d.run.Conversation, "turn", d.run.Turn)
		text := "muse view gap; the turn lost events"
		if len(note.Params) > 0 {
			text += ": " + string(note.Params)
		}
		d.run.Trace.note(text)
	case "session/viewHealthChanged":
		if event, ok := d.viewHealthChanged(params); ok {
			d.events <- event
		}
	default:
		// Everything else — items streaming, turns starting, sessions moving —
		// is a turn in progress rather than a thing said. Stepped over, like the notifications
		// the schema has never heard of. Items opening and updating are tracked above, not
		// stepped over: they are what the drain waits on past the turn's end.
	}
	return false, 0, ""
}

// ── the quota ───────────────────────────────────────────────────────────────────

// harvestUsage asks the turn's host what it observed of the account and records it for the quota. A
// host that observed nothing — a turn that never reached the provider — answers `{}`, which is
// recorded as nothing rather than reported: the quota keeps its last figures, from an older turn. A
// host that cannot be asked at all is the same silence, one log line louder; either way the turn's
// own end is unaffected, which is what makes this a harvest rather than a read. The question is
// bounded: an unanswered harvest must not hold the turn's end, which is what it sits in front of.
func (d *museDriver) harvestUsage(conn *mspConn) {
	if d.usage == nil || conn == nil {
		return
	}
	raw, err := conn.callTimeout("usage/read", map[string]any{}, d.harvestWait())
	if err != nil {
		logClaudeWS.Debug("muse usage/read failed; the quota keeps its last figures",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "error", err)
		d.run.Trace.note("muse quota harvest failed: " + err.Error())
		return
	}
	observed, err := museUsageFromRead(raw)
	if err != nil {
		logClaudeWS.Warn("muse usage/read could not be understood",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "error", err)
		return
	}
	if observed == nil {
		return
	}
	d.noteSubscription(observed)
}

// noteUsageChanged records one `usage/changed` notification: the host's account figures moved
// mid-turn, in the same payload shape `usage/read` answers with. Best effort, like the harvest —
// a notification this driver cannot understand is stepped over rather than failing anything.
func (d *museDriver) noteUsageChanged(raw json.RawMessage) {
	if d.usage == nil || len(raw) == 0 {
		return
	}
	var observed museSubscriptionUsage
	if err := json.Unmarshal(raw, &observed); err != nil {
		logClaudeWS.Warn("muse usage/changed could not be understood",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "error", err)
		return
	}
	d.noteSubscription(&observed)
}

// noteSubscription files one observation with the agent's quota, unless it carries nothing to
// draw — an empty payload would blank the quota's last figures with zeros.
func (d *museDriver) noteSubscription(observed *museSubscriptionUsage) {
	if observed == nil || observed.isEmpty() {
		return
	}
	d.usage.note(observed.dto(), observed.ObservedAtMs)
}

// ── blocks ────────────────────────────────────────────────────────────────────

// completedItem turns one finished transcript item into the blocks it means. A block is taken from
// `item/completed` and from nowhere else: the host announces an item opening, streaming and
// updating before it completes, and the port's contract is that a block is announced once and
// never revised.
//
// Every block carries the running turn's id as its MessageID: turn ids stay stable across
// compaction where item ids do not, so the last one of a turn is where a fork of this conversation
// picks the session up.
func (d *museDriver) completedItem(params map[string]any) []AgentEvent {
	item, _ := params["item"].(map[string]any)
	if len(item) == 0 {
		return nil
	}
	// A finished item is finished whatever turn it names: background work is
	// untracked on the completion, before the turn filter below reads it.
	d.closeWork(asString(item["itemId"]))
	d.mu.Lock()
	turnID, lastTurnID, compacting := d.turnID, d.lastTurnID, d.compacting
	d.mu.Unlock()

	kind := asString(item["kind"])
	if compacting {
		// A compaction turn ends on the compaction landing; anything else completing meanwhile
		// belongs to a history this turn never asked to hear about.
		if kind != "compaction" {
			return nil
		}
		return []AgentEvent{
			{Kind: agentBlock, Block: turnBlock{kind: blockKindText,
				text: "The session was compacted."}, MessageID: turnID},
			{Kind: agentDone, ExitCode: 0},
		}
	}
	// Only this turn's items: a replaced turn's stragglers complete under their own id, and an
	// item outside any turn — the userShell kind — is one no turn asked for. The drop is said out
	// loud: a turn whose end arrives under an id this driver does not know waits forever, and
	// silence is what makes that wait a mystery. The turn that just ended counts as this
	// turn's own: background work completes under its id past its end, and the drain
	// reads those completions back as the turn's own blocks.
	if itemTurn := asString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
		logClaudeWS.Warn("muse dropped an item for another turn",
			"conversation", d.run.Conversation, "turn", d.run.Turn,
			"expected", turnID, "received", itemTurn, "kind", kind)
		d.run.Trace.note(fmt.Sprintf(
			"muse dropped an item for another turn (expected %s, received %s, kind %s)",
			turnID, itemTurn, kind))
		return nil
	}
	// The roster learns of the landing whatever the item means as a block: a
	// delegation's transcript is filed below, but a workflow's end is told
	// nowhere else, and a finished task that stayed `running` on the roster
	// would be the wait that never ends all over again. It goes first, so a
	// block with nothing to say — dropped below — still settles the roster.
	var events []AgentEvent
	if museBackgroundKind(item) {
		if event := d.rosterFinished(item); event != nil {
			events = append(events, *event)
		}
	}
	msgID := orDefault(turnID, lastTurnID)
	if kind == "subagent" {
		block, ok := d.completedSubagent(item)
		if !ok {
			return events
		}
		return append(events, AgentEvent{Kind: agentBlock, Block: block, MessageID: msgID})
	}
	block, ok := museBlock(item)
	if !ok {
		return events
	}
	return append(events, AgentEvent{Kind: agentBlock, Block: block, MessageID: msgID})
}

// completedSubagent files one delegation whole: the parent's summary line, with what the child
// thought and did read back beneath it. The read goes over the turn's own host, on the relay
// goroutine — the delegation is announced once, in the order the parent produced it, like any
// other block.
//
// A delegation that names no child, a turn with no host to read back through, and a read that
// fails all file the summary line alone: what every delegation was before its transcript was
// read beneath it. Nothing about a child is ever worth failing the parent's turn for.
func (d *museDriver) completedSubagent(item map[string]any) (turnBlock, bool) {
	d.mu.Lock()
	reader := d.subagents
	d.mu.Unlock()
	ref := museSubagentRef(item)
	if reader == nil || strings.TrimSpace(ref.ChildSessionID) == "" {
		return museBlock(item)
	}
	sub, err := reader.ReadSubagent(ref)
	if err != nil {
		logClaudeWS.Warn("muse subagent could not be read back; filing the summary line",
			"conversation", d.run.Conversation, "turn", d.run.Turn,
			"subagent", ref.SubagentID, "child", ref.ChildSessionID, "error", err)
		d.run.Trace.note("muse subagent " + orDefault(ref.SubagentID, ref.ChildSessionID) +
			" could not be read back: " + museSentence(err))
		return museBlock(item)
	}
	text := museSubagentSummary(item)
	if text == "" && len(sub.Blocks) == 0 {
		return turnBlock{}, false
	}
	return turnBlock{kind: blockKindSubagent, text: text, subagent: sub}, true
}

// museBlock is one transcript item as a reply block. False is an item with nothing to say to the
// transcript: the echo of the turn's own input, a kind outside a turn's story, or a kind this
// driver has never heard of carrying no summary to render generically.
func museBlock(item map[string]any) (turnBlock, bool) {
	switch asString(item["kind"]) {
	case "userMessage":
		// The echo of the input this turn was started — or steered — with, briefing included.
		// The hub's transcript records what the user wrote; repeating the composed text here
		// would show the briefing back to the reader it was never meant for.
		return turnBlock{}, false
	case "agentMessage":
		return turnBlock{kind: blockKindText, text: asString(item["text"])}, true
	case "reasoning":
		// Raw reasoning where the provider exposes it, the summary parts where it does not, and
		// an empty block where it exposes neither — that the model thought here is still the
		// thing being recorded.
		if text := asString(item["text"]); text != "" {
			return turnBlock{kind: blockKindThinking, text: text}, true
		}
		var parts []string
		if summary, ok := item["summary"].([]any); ok {
			for _, part := range summary {
				if text := asString(part); text != "" {
					parts = append(parts, text)
				}
			}
		}
		return turnBlock{kind: blockKindThinking, text: strings.Join(parts, "\n\n")}, true
	case "toolCall":
		args := museToolArgs(item)
		block := turnBlock{
			kind:      blockKindToolUse,
			name:      orDefault(asString(item["tool"]), "tool"),
			input:     summarizeToolInput(args),
			detail:    permissionInputSummary(args),
			toolUseID: orDefault(asString(item["id"]), asString(item["itemId"])),
		}
		if result, isError, exitCode, durationMs, ok := toolOutcome(item); ok {
			block.result, block.isError = result, isError
			block.exitCode, block.durationMs = exitCode, durationMs
		}
		return block, true
	case "reminderChild":
		// Internal housekeeping, never a reply: the host's generic summary is the placeholder
		// "Reminder child session", with no user-readable content beside it (the item carries
		// only ids — child session, task, generation). Emitting it would persist that
		// placeholder into the transcript and show it in the CMS, so it is dropped outright.
		return turnBlock{}, false
	case "subagent", "userShell", "workflow", "compaction":
		// A turn of a turn, and the turns beside the turn, each folded to the line the host
		// summarised it with. The child's own items are its own story; this is the parent's
		// account of having run one — a turn that delegated its work reads as what it delegated,
		// not as a single line about having delegated it. A delegation normally never reaches
		// here: completedSubagent reads the child's transcript back and files it whole, and this
		// is what it falls back to where that read has nothing to read through.
		if text := orDefault(asString(item["fallbackText"]),
			orDefault(asString(item["text"]), asString(item["summary"]))); text != "" {
			return turnBlock{kind: blockKindText, text: text}, true
		}
		return turnBlock{}, false
	default:
		// An unknown kind renders generically — the line the host summarised it with, or nothing.
		// The protocol's item vocabulary is open by design, and a client that failed a turn on a
		// kind it had never heard of would break on every CLI upgrade.
		if text := asString(item["fallbackText"]); text != "" {
			return turnBlock{kind: blockKindText, text: text}, true
		}
		return turnBlock{}, false
	}
}

// museToolArgs is a toolCall item's arguments as a value: the verbatim JSON parsed where it parses,
// and the raw string where the model emitted almost-JSON — which the protocol keeps verbatim
// precisely so a client can still show it.
func museToolArgs(item map[string]any) any {
	raw, _ := item["args"].(string)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	return parsed
}

// ── approvals ─────────────────────────────────────────────────────────────────

// museAskApprovalPrefix and museAskQuestionPrefix keep the hub's ask ids unambiguous across the two
// things a Muse turn parks on: an approval id and a user-input id are both bare UUIDs, and the
// hub answers both through the one Answer verb.
const (
	museAskApprovalPrefix = "apv-"
	museAskQuestionPrefix = "inq-"
)

// approvalAsked turns one approval request into an ask. The tool input travels twice, as on the
// Claude side: verbatim for the allow to echo, and rendered for the person deciding.
func (d *museDriver) approvalAsked(params map[string]any) (AgentEvent, bool) {
	if !d.ownsTurn(params) {
		return AgentEvent{}, false
	}
	approvalID := asString(params["approvalId"])
	if approvalID == "" {
		logClaudeWS.Warn("muse approval without an id",
			"conversation", d.run.Conversation, "turn", d.run.Turn)
		return AgentEvent{}, false
	}
	input := museRawArgs(params)
	subject, _ := params["subject"].(map[string]any)
	ask := &AgentAsk{
		ID:           museAskApprovalPrefix + approvalID,
		Tool:         orDefault(asString(params["toolName"]), "tool"),
		Description:  cutRunes(museSubjectLine(subject), 200),
		ToolUseID:    asString(params["itemId"]),
		Input:        input,
		InputSummary: permissionInputSummary(input),
	}
	d.asksMu.Lock()
	if d.asks == nil {
		d.asks = map[string]*museAsk{}
	}
	d.asks[ask.ID] = &museAsk{
		ask:         ask,
		approvalID:  approvalID,
		requirement: params["currentRequirementId"],
		choices:     museChoices(params),
	}
	d.asksMu.Unlock()
	return AgentEvent{Kind: agentAsk, Ask: ask}, true
}

// ownsTurn reports whether a notification belongs to the running turn. A notification naming
// another turn is a replaced turn's straggler; one naming none is about the session rather than
// about any turn of it, and neither has anything to park.
func (d *museDriver) ownsTurn(params map[string]any) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	turnID := asString(params["turnId"])
	return turnID == "" || turnID == d.turnID || turnID == d.lastTurnID
}

// museRawArgs is an approval's tool input: the verbatim argument JSON parsed where it parses, and
// the raw string where it does not — the same forgiving reading a toolCall item's args get.
func museRawArgs(params map[string]any) any {
	raw, _ := params["rawArgs"].(string)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	return parsed
}

// museSubjectLine is what the host says the approval is about, in one line: the command for a
// shell call, the path for a file access, the endpoint for a network call. It is the sentence the
// card is read by, so it names the target rather than the kind.
func museSubjectLine(subject map[string]any) string {
	switch asString(subject["kind"]) {
	case "shell", "process":
		return orDefault(asString(subject["command"]), asString(subject["kind"]))
	case "fileAccess":
		path := asString(subject["path"])
		if access := asString(subject["access"]); access != "" && path != "" {
			return access + " " + path
		}
		return orDefault(path, "file access")
	case "network":
		host := asString(subject["host"])
		if protocol := asString(subject["protocol"]); protocol != "" && host != "" {
			return protocol + "://" + host
		}
		return orDefault(host, "network access")
	case "tool":
		return orDefault(asString(subject["toolName"]), "tool call")
	default:
		if target := asString(subject["target"]); target != "" {
			return target
		}
		return asString(subject["kind"])
	}
}

// museChoices reads the ways an approval may be decided. A choice without an id is dropped — there
// would be nothing to send back — and an ask left with none still parks the turn: the card shows
// the call, and answering it says the host offered no way through.
func museChoices(params map[string]any) []museChoice {
	raw, _ := params["availableChoices"].([]any)
	choices := make([]museChoice, 0, len(raw))
	for _, entry := range raw {
		offered, _ := entry.(map[string]any)
		id := asString(offered["choiceId"])
		if id == "" {
			continue
		}
		accepts, _ := offered["acceptsFeedback"].(bool)
		choices = append(choices, museChoice{
			choiceID:        id,
			decision:        asString(offered["decision"]),
			scope:           asString(offered["scope"]),
			acceptsFeedback: accepts,
		})
	}
	return choices
}

// approvalSettled withdraws an ask the host settled without the hub: the judge approved it, a
// timeout denied it, another client decided it. A settlement of the hub's own decision is the
// answer landing, and is stepped over — the card is already gone.
func (d *museDriver) approvalSettled(params map[string]any) (AgentEvent, bool) {
	approvalID := asString(params["approvalId"])
	if approvalID == "" {
		return AgentEvent{}, false
	}
	d.asksMu.Lock()
	defer d.asksMu.Unlock()
	ask, ok := d.asks[museAskApprovalPrefix+approvalID]
	if !ok || ask.isQuestion() {
		return AgentEvent{}, false
	}
	if decided := asString(params["decidedByCommandId"]); decided != "" && ask.decidedBy[decided] {
		return AgentEvent{}, false
	}
	delete(d.asks, ask.ask.ID)
	return AgentEvent{Kind: agentWithdraw, AskID: ask.ask.ID}, true
}

// approvalUpdated refreshes a pending approval: a further stage named a new requirement, and the
// next decision echoes that one rather than the one the ask opened with. An ask the hub has
// already answered is re-emitted rather than only refreshed — the card went down with the answer,
// and the turn is about to park again with nothing on screen.
func (d *museDriver) approvalUpdated(params map[string]any) (AgentEvent, bool) {
	approvalID := asString(params["approvalId"])
	if approvalID == "" {
		return AgentEvent{}, false
	}
	d.asksMu.Lock()
	defer d.asksMu.Unlock()
	ask, ok := d.asks[museAskApprovalPrefix+approvalID]
	if !ok || ask.isQuestion() {
		return AgentEvent{}, false
	}
	ask.requirement = params["currentRequirementId"]
	ask.choices = museChoices(params)
	if subject, ok := params["subject"].(map[string]any); ok {
		ask.ask.Description = cutRunes(museSubjectLine(subject), 200)
	}
	if !ask.answered {
		return AgentEvent{}, false
	}
	ask.answered = false
	return AgentEvent{Kind: agentAsk, Ask: ask.ask}, true
}

// ── questions ─────────────────────────────────────────────────────────────────

// questionAsked turns one user-input prompt into an ask carrying Questions, which is what makes
// the hub give it frames of its own and withhold every shortcut a permission has. A prompt no card
// could render — a question with nothing to ask — is declined on the spot rather than parked on:
// refusing it leaves the turn where a dismissal leaves it, and the failure says why.
func (d *museDriver) questionAsked(params map[string]any) (AgentEvent, bool) {
	if !d.ownsTurn(params) {
		return AgentEvent{}, false
	}
	userInputID := asString(params["userInputId"])
	raw, _ := params["questions"].([]any)
	if userInputID == "" || len(raw) == 0 {
		logClaudeWS.Warn("muse question prompt without an id or a question",
			"conversation", d.run.Conversation, "turn", d.run.Turn)
		return AgentEvent{}, false
	}
	questions, keys, asked := museQuestions(raw)
	if len(questions) == 0 {
		d.mu.Lock()
		conn, sessionID := d.conn, d.sessionID
		d.mu.Unlock()
		if conn != nil && sessionID != "" {
			_, _ = conn.call("userInput/cancel", map[string]any{
				"commandId": mspCommandID(), "sessionId": sessionID,
				"userInputId": userInputID,
				"reason":      "The question had nothing to ask.",
			})
		}
		return AgentEvent{Kind: agentFailure,
			Message: "Muse asked a question with nothing to ask; it was dismissed."}, true
	}
	ask := &AgentAsk{
		ID:           museAskQuestionPrefix + userInputID,
		Tool:         orDefault(asString(params["toolName"]), "question"),
		ToolUseID:    asString(params["itemId"]),
		Input:        map[string]any{"userInputId": userInputID},
		Questions:    questions,
		QuestionKeys: keys,
	}
	d.asksMu.Lock()
	if d.asks == nil {
		d.asks = map[string]*museAsk{}
	}
	d.asks[ask.ID] = &museAsk{ask: ask, userInputID: userInputID, questions: asked}
	d.asksMu.Unlock()
	return AgentEvent{Kind: agentAsk, Ask: ask}, true
}

// museQuestions reads a user-input prompt into the question list an ask carries, or nothing when
// no card could render it. The bounds are the panel's own (driver_claude.go): the card it lands
// in is the same card, and a malformed or enormous ask is cut to something renderable rather than
// refused — except a question with nothing to ask, which cannot be answered and drops the whole
// prompt rather than shifting every answer after it onto the wrong question.
func museQuestions(raw []any) (questions []map[string]any, keys []string, asked []museQuestion) {
	for _, entry := range raw {
		if len(questions) == maxQuestions {
			break
		}
		question, _ := entry.(map[string]any)
		key := asString(question["question"])
		if key == "" {
			return nil, nil, nil
		}
		selection, _ := question["selection"].(map[string]any)
		multiple := asString(selection["mode"]) == "multiple"
		entry := map[string]any{
			"question": cutRunes(key, maxQuestionChars),
			"options":  museQuestionOptions(question["options"]),
		}
		if header := cutRunes(asString(question["header"]), maxQuestionChars); header != "" {
			entry["header"] = header
		}
		if multiple {
			entry["multiSelect"] = true
		}
		questions = append(questions, entry)
		keys = append(keys, key)
		asked = append(asked, museQuestion{
			id: asString(question["id"]), multiple: multiple,
			labels: museOptionLabels(question["options"]),
		})
	}
	return questions, keys, asked
}

// museQuestionOptions reads one question's choices. An option with no label is dropped — there
// would be nothing to click and nothing to send back — and a question left with none is still a
// question: the client offers the free-text answer it always offers.
func museQuestionOptions(raw any) []map[string]any {
	entries, _ := raw.([]any)
	options := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if len(options) == maxQuestionOptions {
			break
		}
		offered, _ := entry.(map[string]any)
		label := cutRunes(asString(offered["label"]), maxQuestionChars)
		if label == "" {
			continue
		}
		option := map[string]any{"label": label}
		if description := cutRunes(asString(offered["description"]), maxQuestionChars); description != "" {
			option["description"] = description
		}
		preview, _ := offered["preview"].(map[string]any)
		if content := cutRunes(asString(preview["content"]), maxPermissionInputChars); content != "" {
			option["preview"] = content
		}
		options = append(options, option)
	}
	return options
}

// museOptionLabels is the labels an answer is matched against: the full text, uncut — a label the
// panel trimmed is still answered under the name the tool knows it by.
func museOptionLabels(raw any) []string {
	entries, _ := raw.([]any)
	var labels []string
	for _, entry := range entries {
		offered, _ := entry.(map[string]any)
		if label := asString(offered["label"]); label != "" {
			labels = append(labels, label)
		}
	}
	return labels
}

// questionSettled withdraws a prompt the host settled without the hub: interrupted, timed out, or
// decided by another client. A settlement of the hub's own answers is the answer landing, and is
// stepped over — the card is already gone.
func (d *museDriver) questionSettled(params map[string]any) (AgentEvent, bool) {
	userInputID := asString(params["userInputId"])
	if userInputID == "" {
		return AgentEvent{}, false
	}
	d.asksMu.Lock()
	defer d.asksMu.Unlock()
	ask, ok := d.asks[museAskQuestionPrefix+userInputID]
	if !ok || !ask.isQuestion() {
		return AgentEvent{}, false
	}
	if decided := asString(params["decidedByCommandId"]); decided != "" && ask.decidedBy[decided] {
		return AgentEvent{}, false
	}
	delete(d.asks, ask.ask.ID)
	return AgentEvent{Kind: agentWithdraw, AskID: ask.ask.ID}, true
}

// ── the end ───────────────────────────────────────────────────────────────────

// noteTokenUsage folds one model completion's token usage into the running turn's
// bill. One notification per completion that reports usage, each naming its turn —
// a straggler from a replaced turn, or anything arriving outside a turn, is dropped
// rather than billed to the wrong one. A compaction folds nothing: it ends on the
// compaction item and files no bill at all.
func (d *museDriver) noteTokenUsage(params map[string]any) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.compacting {
		return
	}
	if turnID := asString(params["turnId"]); turnID == "" || turnID != d.turnID {
		return
	}
	if report, ok := readUsage(params["usage"], nil, usageScopeTurn); ok {
		d.turnTokens.InputTokens += report.InputTokens
		d.turnTokens.OutputTokens += report.OutputTokens
		d.turnTokens.CacheReadTokens += report.CacheReadTokens
		d.turnTokens.CacheWriteTokens += report.CacheWriteTokens
		d.turnTokens.TotalCostUSD += report.TotalCostUSD
		d.turnBilled = true
	}
}

// takeTurnUsage takes the running turn's bill and clears it. Nil is a turn whose
// host reported no usage at all — unknown, never free.
func (d *museDriver) takeTurnUsage() *turnUsage {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.turnBilled {
		return nil
	}
	d.turnBilled = false
	billed := d.turnTokens
	d.turnTokens = turnUsage{}
	billed.Scope = usageScopeTurn
	return &billed
}

// turnCompleted ends the turn the host has just finished. A terminal naming another turn is a
// replaced turn's straggler and ends nothing; a terminal the vocabulary has moved past fails the
// turn rather than reporting an end nobody asked for.
//
// It reports the end in three parts: whether the turn ends here, on what synthesised exit code,
// and on what terminal word — the host's own vocabulary, which the transcript files beside the
// number so no reader mistakes one for a process exit. Anything the end carries besides the word
// itself — why it failed, what the turn cost — goes out as events first, in order.
func (d *museDriver) turnCompleted(params map[string]any) (bool, int, string, []AgentEvent) {
	d.mu.Lock()
	turnID, compacting := d.turnID, d.compacting
	d.mu.Unlock()
	if compacting {
		return false, 0, "", nil
	}
	if completed := asString(params["turnId"]); completed != "" && completed != turnID {
		logClaudeWS.Warn("muse dropped a turn end for another turn",
			"conversation", d.run.Conversation, "turn", d.run.Turn,
			"expected", turnID, "received", completed,
			"terminal", asString(params["terminal"]))
		d.run.Trace.note(fmt.Sprintf(
			"muse dropped a turn end for another turn (expected %s, received %s, terminal %s)",
			turnID, completed, asString(params["terminal"])))
		return false, 0, "", nil
	}
	d.mu.Lock()
	d.lastTurnID = d.turnID
	d.turnID = ""
	d.mu.Unlock()
	var events []AgentEvent
	// What the turn cost, in the same per-turn shape Claude files. The end may
	// carry the aggregate itself, but the host omits it more often than not —
	// and the bill is then the fold of the turn's model completions, each filed
	// as it landed. The aggregate wins where both are there: it is the sum the
	// host composed rather than the one folded here.
	folded := d.takeTurnUsage()
	if usage, ok := readUsage(
		firstOf(params, "usage", "sessionUsage", "tokens"),
		firstOf(params, "cost", "totalCostUSD", "total_cost_usd"),
		usageScopeTurn); ok {
		events = append(events, AgentEvent{Kind: agentUsage, Usage: usage})
	} else if folded != nil {
		events = append(events, AgentEvent{Kind: agentUsage, Usage: folded})
	}
	switch terminal := asString(params["terminal"]); terminal {
	case "completed":
		return true, 0, terminal, events
	case "cancelled":
		return true, -1, terminal, events
	case "failed":
		message := "The Muse turn failed."
		authRequired := false
		if failure, ok := params["error"].(map[string]any); ok {
			if text := asString(failure["message"]); text != "" {
				message = text
			}
			// The schema's own word for a host with no credentials — `TurnErrorKind`, stable
			// across CLI wordings, which is why this branches on it rather than on the sentence.
			authRequired = asString(failure["kind"]) == "authRequired"
		} else if reason := asString(params["reason"]); reason != "" {
			message = reason
		}
		events = append(events, AgentEvent{Kind: agentFailure, Message: message, AuthRequired: authRequired})
		return true, 1, terminal, events
	default:
		events = append(events, AgentEvent{Kind: agentFailure,
			Message: "The Muse turn ended as " + orDefault(asString(params["terminal"]), "unknown") + "."})
		return true, 1, asString(params["terminal"]), events
	}
}

// turnUnqueued ends a turn the host reclaimed before it ran: another submission took the session,
// and per the schema no turn/started and no turn/completed is ever emitted for the reclaimed id.
// SDK turn-waits settle on this event too, and so does this one — waiting for the completion that
// never comes is a turn that never ends. A reclaim naming another turn is a replaced turn's
// straggler and ends nothing, as a terminal for one would.
func (d *museDriver) turnUnqueued(params map[string]any) (bool, int, *AgentEvent) {
	d.mu.Lock()
	turnID, compacting := d.turnID, d.compacting
	d.mu.Unlock()
	if compacting {
		return false, 0, nil
	}
	if reclaimed := asString(params["turnId"]); reclaimed != "" && reclaimed != turnID {
		logClaudeWS.Warn("muse dropped a turn reclaim for another turn",
			"conversation", d.run.Conversation, "turn", d.run.Turn,
			"expected", turnID, "received", reclaimed)
		d.run.Trace.note(fmt.Sprintf(
			"muse dropped a turn reclaim for another turn (expected %s, received %s)",
			turnID, reclaimed))
		return false, 0, nil
	}
	d.mu.Lock()
	d.lastTurnID = d.turnID
	d.turnID = ""
	d.mu.Unlock()
	return true, 1, &AgentEvent{Kind: agentFailure,
		Message: "The Muse turn was reclaimed before it ran."}
}
