package harnesses

import (
	"kiao/worker/internal/core/equipment"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
)

// HarnessDriver is spawned once per turn and never reused. A conversation's harness is fixed at creation.
// Answer, Say and Stop may race with event draining and each other; drivers synchronize access.
type HarnessDriver interface {
	// Spawn starts the event stream; errors are shown verbatim to the user.
	Spawn(run HarnessRun) error

	// Events preserves harness order and closes after exactly one final harnessDone, including on crash or Stop.
	// Closing releases the conversation's execution reservation, so cleanup must finish first.
	// The unbuffered channel applies backpressure: stopping reads stalls the turn.
	Events() <-chan HarnessEvent

	// Answer is fire-and-forget; an exited harness returns an error without retry.
	Answer(askID string, decision AskDecision) error

	// Say delivers to the running turn or returns an error; unsupported messages are not queued.
	Say(text string) error

	// Stop is idempotent and always leads to harnessDone.
	Stop()
}

// HarnessRun is validated before Spawn: paths resolved, permissions checked, prompt composed.
type HarnessRun struct {
	Conversation string
	Turn         string

	// Prompt includes the user message and hub context (promptWithContext).
	Prompt string
	// WorkDir is absolute and symlink-resolved to prevent escaping the store.
	WorkDir string
	// StoreRoot is absolute; empty means resolution failed. Work may span the whole store.
	StoreRoot string

	Model     string
	ProfileID string
	// Pi is an immutable resolution of the profile for this turn, including private credentials.
	Pi             *PiResolvedProfile
	Images         []HarnessImage
	Effort         string
	PermissionMode string
	// Instructions are appended to the system prompt, separately from Prompt; empty means none.
	Instructions string
	Thinking     bool
	Compact      bool
	// AllowBypass=false forbids unsupervised execution regardless of PermissionMode.
	AllowBypass bool

	// SessionID is empty for a fresh session.
	SessionID string
	// ForkSession branches SessionID instead of continuing it.
	ForkSession bool
	// ResumeAt is the branch point's harness message ID; empty means the session's end.
	ResumeAt string

	// MCPConfig is opaque RenderMCP output; empty means no servers.
	MCPConfig string
	// MCPToken is a per-turn callback credential, revoked when the turn settles; empty if unused.
	MCPToken string

	// Trace is append-only for drivers; the hub closes it when Events ends.
	// Methods are nil-safe and trace failures must not fail a turn.
	Trace *turntrace.TurnTrace
}

type HarnessEventKind string

// harnessBlock is a finished, immutable reply block, emitted once in production order.
const EventBlock HarnessEventKind = "block"

// harnessAsk parks the turn until Answer or Stop.
const EventAsk HarnessEventKind = "ask"

// harnessWithdraw removes an unanswered ask.
const EventWithdraw HarnessEventKind = "withdraw"

// harnessSession is persisted immediately so interrupted turns remain resumable.
const EventSession HarnessEventKind = "session"

// harnessFailure reports an error without ending the turn.
const EventFailure HarnessEventKind = "failure"

// harnessNotice is ephemeral: neither persisted nor a turn outcome.
const EventNotice HarnessEventKind = "notice"

// harnessToolResult attaches a separately reported outcome to its tool-call block.
// Drivers whose completed blocks include outcomes do not emit it.
const EventToolResult HarnessEventKind = "tool_result"

// harnessUsage is persisted with the turn, not shown live as account quota.
const EventUsage HarnessEventKind = "usage"

// harnessBackground replaces the whole roster, including finished tasks; it is not a diff.
const EventBackground HarnessEventKind = "background"

const EventQueue HarnessEventKind = "queue"

// harnessDone is always the last event.
const EventDone HarnessEventKind = "done"

// TerminalPermissionChannelClosed marks a harnessDone whose turn died on a closed
// approval channel. The engine drops the conversation's session for it.
const TerminalPermissionChannelClosed = "permission_channel_closed"

// HarnessEvent fields are selected by Kind. Only harnessDone is required.
type HarnessEvent struct {
	Kind HarnessEventKind

	Block TurnBlock
	// MessageID identifies the block's harness message; the last ID is the conversation fork point.
	MessageID string

	Ask *HarnessAsk
	// AskID identifies the withdrawn ask on harnessWithdraw.
	AskID string

	SessionID string
	// Message is user-visible text for harnessFailure or harnessNotice.
	Message string
	// AuthRequired marks a pre-run credential failure, allowing the hub to offer sign-in.
	AuthRequired bool
	// Tool fields carry harnessToolResult; ToolDurationMs is in milliseconds.
	ToolUseID      string
	ToolResult     string
	ToolIsError    bool
	ToolExitCode   *int
	ToolDurationMs int64
	Usage          *TurnUsage
	// Background is the complete roster in first-sight order; each event replaces the previous one.
	Background []BackgroundTask
	Queue      []HarnessQueuedMessage
	// ExitCode carries harnessDone: nonzero is failure; -1 means the service ended the turn.
	ExitCode int
	// Terminal carries harnessDone when the driver synthesizes an exit code from a terminal word;
	// empty when the process exit code is authoritative.
	Terminal string
}

// usageScopeTurn includes all completions folded into one turn.
const UsageScopeTurn = "turn"

// TurnUsage contains harness-reported totals, with cache and reasoning included in input/output.
// Unclassified tokens are retained in input; missing usage is nil.
type TurnUsage struct {
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64 // Included in OutputTokens; never add it to that total.
	TotalCostUSD     float64
	Scope            string
}

func (u *TurnUsage) Add(other TurnUsage) {
	u.InputTokens += other.InputTokens
	u.OutputTokens += other.OutputTokens
	u.CacheReadTokens += other.CacheReadTokens
	u.CacheWriteTokens += other.CacheWriteTokens
	u.ReasoningTokens += other.ReasoningTokens
	u.TotalCostUSD += other.TotalCostUSD
}

// HarnessAsk parks a turn for permission or questions; non-nil Questions selects the answer protocol.
type HarnessAsk struct {
	// ID is unique for the lifetime of the turn.
	ID string
	// Tool must be nonempty.
	Tool string
	// DisplayName and Description may be empty and never replace the tool name.
	DisplayName string
	Description string
	ToolUseID   string

	// Input is verbatim tool input, echoed on allow; a display summary cannot satisfy the tool schema.
	Input        any
	InputSummary string

	// Questions preserves order but is trimmed for display. Non-nil selects question answer frames.
	Questions []map[string]any
	// QuestionKeys preserves exact original texts: answer maps must not use trimmed display keys.
	QuestionKeys []string
}

func (ask *HarnessAsk) IsQuestion() bool { return ask != nil && ask.Questions != nil }

type AskDecision struct {
	// Allow runs the call with Input, unchanged or augmented with user answers.
	Allow bool
	Input any
	// Message explains a refusal to the model.
	Message string
}

// Harness is process-scoped. Optional side ports use client wire DTOs; absent ports are not mounted.
type Harness interface {
	// Driver is called once per turn on the spawn path.
	Driver() HarnessDriver
}

// HarnessOptions supplies prompt choices; absent, the client uses its built-in list.
type HarnessOptions interface {
	Options() HarnessOptionsDto
}

// HarnessDeferred is optional. Its state events replace the entire queue roster,
// including delivered and cancelled messages, so reconnects can reconstruct it.
type HarnessDeferred interface {
	FollowUp(id, text string) error
	ClearQueue() error
}

type HarnessImage struct {
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
	Type     string `json:"type"`
}

type HarnessQueuedMessage struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	State string `json:"state"` // pending, delivered, cancelled
}

// HarnessUsage must be a cheap quota read without spawning turns; the chain runner polls it.
// Absent, account usage is unavailable.
type HarnessUsage interface {
	Usage() (HarnessUsageDto, error)
}

// HarnessUsageRefresh overrides HarnessUsage for user-requested fresh figures.
// The chain runner uses HarnessUsage to avoid spending quota to query quota.
type HarnessUsageRefresh interface {
	RefreshUsage() (HarnessUsageDto, error)
}

// HarnessAuth reads the host CLI's credentials without starting a model turn.
// Absent, status checks are unavailable for this harness.
type HarnessAuth interface {
	AuthStatus() (HarnessAuthStatusDto, error)
}

// HarnessLogin exposes sign-in. LoginEnabled=false returns 404 from login endpoints
// while keeping status readable; absent, neither sign-in nor status is offered.
type HarnessLogin interface {
	HarnessAuth
	LoginEnabled() bool
	LoginStart() (string, error)
	LoginCode(code string) (ok bool, message string, err error)
	LoginCancel() bool
	LoginShutdown()
}

// HarnessAPIKeyLogin submits keys to the host CLI through stdin, avoiding shell history.
// APIKeyLoginEnabled=false returns 404 and offers the host command instead.
type HarnessAPIKeyLogin interface {
	APIKeyLoginEnabled() bool
	SubmitAPIKey(key string) (ok bool, message string, err error)
	APIKeyHostCommand() string
}

// HarnessDeviceLogin keeps at most one device sign-in process in flight.
// Reading finished status consumes it so a later Start cannot inherit the result.
// Absent, device sign-in is unavailable.
type HarnessDeviceLogin interface {
	DeviceLoginEnabled() bool
	DeviceLoginStart() (url, userCode string, err error)
	DeviceLoginStatus() (pending, ok bool, message string, err error)
	DeviceLoginCancel() bool
	DeviceLoginHostCommand() string
	DeviceLoginShutdown()
}

// HarnessBranching permits session forks. Otherwise forks carry only the transcript:
// two conversations must not resume one session as concurrent writers.
// Forks onto a different harness never inherit the source session.
type HarnessBranching interface {
	BranchesSessions() bool
}

// HarnessMCP renders toolbox servers into opaque HarnessRun.MCPConfig.
// Absent, no servers are passed and no callback credential is minted.
type HarnessMCP interface {
	RenderMCP(servers []equipment.MCPServer) (string, error)
}
