package hybridflowrunner

import "kiao/worker/internal/core"

// AgentDriver is spawned once per turn and never reused. A conversation's agent is fixed at creation.
// Answer, Say and Stop may race with event draining and each other; drivers synchronize access.
type AgentDriver interface {
	// Spawn starts the event stream; errors are shown verbatim to the user.
	Spawn(run AgentRun) error

	// Events preserves agent order and closes after exactly one final agentDone, including on crash or Stop.
	// Closing releases the conversation's execution reservation, so cleanup must finish first.
	// The unbuffered channel applies backpressure: stopping reads stalls the turn.
	Events() <-chan AgentEvent

	// Answer is fire-and-forget; an exited agent returns an error without retry.
	Answer(askID string, decision AskDecision) error

	// Say delivers to the running turn or returns an error; unsupported messages are not queued.
	Say(text string) error

	// Stop is idempotent and always leads to agentDone.
	Stop()
}

// AgentRun is validated before Spawn: paths resolved, permissions checked, prompt composed.
type AgentRun struct {
	Conversation string
	Turn         string

	// Prompt includes the user message and hub context (promptWithContext).
	Prompt string
	// WorkDir is absolute and symlink-resolved to prevent escaping the store.
	WorkDir string
	// StoreRoot is absolute; empty means resolution failed. Work may span the whole store.
	StoreRoot string

	Model          string
	Effort         string
	PermissionMode string
	// Instructions are appended to the system prompt, separately from Prompt; empty means none.
	Instructions string
	Thinking     bool
	// AllowBypass=false forbids unsupervised execution regardless of PermissionMode.
	AllowBypass bool

	// SessionID is empty for a fresh session.
	SessionID string
	// ForkSession branches SessionID instead of continuing it.
	ForkSession bool
	// ResumeAt is the branch point's agent message ID; empty means the session's end.
	ResumeAt string

	// MCPConfig is opaque RenderMCP output; empty means no servers.
	MCPConfig string
	// MCPToken is a per-turn callback credential, revoked when the turn settles; empty if unused.
	MCPToken string

	// Trace is append-only for drivers; the hub closes it when Events ends.
	// Methods are nil-safe and trace failures must not fail a turn.
	Trace *turnTrace
}

type AgentEventKind string

const (
	// agentBlock is a finished, immutable reply block, emitted once in production order.
	agentBlock AgentEventKind = "block"
	// agentAsk parks the turn until Answer or Stop.
	agentAsk AgentEventKind = "ask"
	// agentWithdraw removes an unanswered ask.
	agentWithdraw AgentEventKind = "withdraw"
	// agentSession is persisted immediately so interrupted turns remain resumable.
	agentSession AgentEventKind = "session"
	// agentFailure reports an error without ending the turn.
	agentFailure AgentEventKind = "failure"
	// agentNotice is ephemeral: neither persisted nor a turn outcome.
	agentNotice AgentEventKind = "notice"
	// agentToolResult attaches a separately reported outcome to its tool-call block.
	// Drivers whose completed blocks include outcomes do not emit it.
	agentToolResult AgentEventKind = "tool_result"
	// agentUsage is persisted with the turn, not shown live as account quota.
	agentUsage AgentEventKind = "usage"
	// agentBackground replaces the whole roster, including finished tasks; it is not a diff.
	agentBackground AgentEventKind = "background"
	// agentDone is always the last event.
	agentDone AgentEventKind = "done"
)

// AgentEvent fields are selected by Kind. Only agentDone is required.
type AgentEvent struct {
	Kind AgentEventKind

	Block turnBlock
	// MessageID identifies the block's agent message; the last ID is the conversation fork point.
	MessageID string

	Ask *AgentAsk
	// AskID identifies the withdrawn ask on agentWithdraw.
	AskID string

	SessionID string
	// Message is user-visible text for agentFailure or agentNotice.
	Message string
	// AuthRequired marks a pre-run credential failure, allowing the hub to offer sign-in.
	AuthRequired bool
	// Tool fields carry agentToolResult; ToolDurationMs is in milliseconds.
	ToolUseID      string
	ToolResult     string
	ToolIsError    bool
	ToolExitCode   *int
	ToolDurationMs int64
	Usage          *turnUsage
	// Background is the complete roster in first-sight order; each event replaces the previous one.
	Background []BackgroundTask
	// ExitCode carries agentDone: nonzero is failure; -1 means the service ended the turn.
	ExitCode int
	// Terminal carries agentDone when the driver synthesizes an exit code from a terminal word;
	// empty when the process exit code is authoritative.
	Terminal string
}

// usageScopeTurn includes all completions folded into one turn.
const usageScopeTurn = "turn"

// turnUsage contains only agent-reported figures; no report is nil, not a row of zeros.
type turnUsage struct {
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64 // Included in OutputTokens; never add it to that total.
	TotalCostUSD     float64
	Scope            string
}

// AgentAsk parks a turn for permission or questions; non-nil Questions selects the answer protocol.
type AgentAsk struct {
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

func (ask *AgentAsk) isQuestion() bool { return ask != nil && ask.Questions != nil }

type AskDecision struct {
	// Allow runs the call with Input, unchanged or augmented with user answers.
	Allow bool
	Input any
	// Message explains a refusal to the model.
	Message string
}

// Agent is process-scoped. Optional side ports use client wire DTOs; absent ports are not mounted.
type Agent interface {
	// Driver is called once per turn on the spawn path.
	Driver() AgentDriver
}

// AgentOptions supplies prompt choices; absent, the client uses its built-in list.
type AgentOptions interface {
	Options() agentOptionsDto
}

// AgentUsage must be a cheap quota read without spawning turns; the chain runner polls it.
// Absent, account usage is unavailable.
type AgentUsage interface {
	Usage() (AgentUsageDto, error)
}

// AgentUsageRefresh overrides AgentUsage for user-requested fresh figures.
// The chain runner uses AgentUsage to avoid spending quota to query quota.
type AgentUsageRefresh interface {
	RefreshUsage() (AgentUsageDto, error)
}

// AgentLogin exposes sign-in. LoginEnabled=false returns 404 from login endpoints
// while keeping status readable; absent, neither sign-in nor status is offered.
type AgentLogin interface {
	LoginEnabled() bool
	AuthStatus() (AgentAuthStatusDto, error)
	LoginStart() (string, error)
	LoginCode(code string) (ok bool, message string, err error)
	LoginCancel() bool
	LoginShutdown()
}

// AgentAPIKeyLogin submits keys to the host CLI through stdin, avoiding shell history.
// APIKeyLoginEnabled=false returns 404 and offers the host command instead.
type AgentAPIKeyLogin interface {
	APIKeyLoginEnabled() bool
	SubmitAPIKey(key string) (ok bool, message string, err error)
	APIKeyHostCommand() string
}

// AgentDeviceLogin keeps at most one device sign-in process in flight.
// Reading finished status consumes it so a later Start cannot inherit the result.
// Absent, device sign-in is unavailable.
type AgentDeviceLogin interface {
	DeviceLoginEnabled() bool
	DeviceLoginStart() (url, userCode string, err error)
	DeviceLoginStatus() (pending, ok bool, message string, err error)
	DeviceLoginCancel() bool
	DeviceLoginHostCommand() string
	DeviceLoginShutdown()
}

// AgentBranching permits session forks. Otherwise forks carry only the transcript:
// two conversations must not resume one session as concurrent writers.
// Forks onto a different agent never inherit the source session.
type AgentBranching interface {
	BranchesSessions() bool
}

// AgentMCP renders toolbox servers into opaque AgentRun.MCPConfig.
// Absent, no servers are passed and no callback credential is minted.
type AgentMCP interface {
	RenderMCP(servers []core.MCPServer) (string, error)
}
