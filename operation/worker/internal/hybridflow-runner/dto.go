package hybridflowrunner

// JSON wire contracts for REST and sockets; keep reference/npm/kiao-worker/src/agent-types.ts
// and PROTOCOL.md in sync.

// Window lengths vary by agent and plan; clients derive localized labels from minutes.
type agentWindow struct {
	// WindowMinutes is zero when the agent did not report a length; do not invent a label.
	WindowMinutes       int   `json:"windowMinutes"`
	PercentUsed         int   `json:"percentUsed"`
	ResetAtEpochSeconds int64 `json:"resetAtEpochSeconds"`
}

// Claude window lengths; Codex reports its own.
const (
	fiveHourWindowMinutes = 5 * 60
	weeklyWindowMinutes   = 7 * 24 * 60
)

// AgentUsageDto lists windows tightest first. An empty list means unavailable, not failure.
type AgentUsageDto struct {
	Windows []agentWindow `json:"windows"`
}

// AgentAuthStatusDto passes through `claude auth status --json`. LoginEnabled reports whether
// the /hybridflow-runner/auth/login/* endpoints are available.
type AgentAuthStatusDto struct {
	LoggedIn         bool   `json:"loggedIn"`
	AuthMethod       string `json:"authMethod,omitempty"`
	Email            string `json:"email,omitempty"`
	OrgName          string `json:"orgName,omitempty"`
	SubscriptionType string `json:"subscriptionType,omitempty"`
	LoginEnabled     bool   `json:"loginEnabled"`
}

// AgentLoginDto reports CLI refusal as HTTP 200 with ok:false and a displayable message.
// URL is set only at start; device start also sets UserCode for confirmation.
type AgentLoginDto struct {
	Ok       bool   `json:"ok"`
	URL      string `json:"url,omitempty"`
	UserCode string `json:"userCode,omitempty"`
	Message  string `json:"message,omitempty"`
}

// AgentDeviceLoginDto is pending until the CLI exits, then reports the approval outcome.
type AgentDeviceLoginDto struct {
	Pending bool   `json:"pending"`
	Ok      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// AgentConversationDto.Running comes from the live turn registry, not persisted metadata.
type AgentConversationDto struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Folder string `json:"folder"`
	// Agent resolves an omitted stored value to the default. Changing agents requires a fork.
	Agent          string `json:"agent"`
	Model          string `json:"model"`
	Effort         string `json:"effort"`
	PermissionMode string `json:"permissionMode"`
	Thinking       bool   `json:"thinking"`
	SessionID      string `json:"sessionId,omitempty"`
	Running        bool   `json:"running"`
	Archived       bool   `json:"archived"`
	Pinned         bool   `json:"pinned"`
	MessageCount   int    `json:"messageCount"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
	LastExitCode   *int   `json:"lastExitCode,omitempty"`
	SessionLost    bool   `json:"sessionLost,omitempty"`
	// ForkedFromMessage is empty for a whole-conversation fork; both fields are absent on non-forks.
	ForkedFrom        string `json:"forkedFrom,omitempty"`
	ForkedFromMessage string `json:"forkedFromMessage,omitempty"`
	// TraceStream enables raw protocol capture; other trace data is always recorded.
	TraceStream bool `json:"traceStream,omitempty"`
}

// AgentToolUseDto matches the socket tool_use name/summary pair.
type AgentToolUseDto struct {
	Name  string `json:"name"`
	Input string `json:"input,omitempty"`
}

// AgentBlockDto preserves reply order: "text", "thinking" (empty if redacted), "tool_use"
// (Name, short Input, full Detail), or "subagent" (parent summary in Text, child in Subagent).
type AgentBlockDto struct {
	Kind   string `json:"kind"`
	Text   string `json:"text,omitempty"`
	Name   string `json:"name,omitempty"`
	Input  string `json:"input,omitempty"`
	Detail string `json:"detail,omitempty"`
	// ToolUseID is the agent call ID. ExitCode is absent if unreported.
	// At is RFC3339; DurationMs is elapsed milliseconds when measured.
	ToolUseID  string `json:"toolUseId,omitempty"`
	Result     string `json:"result,omitempty"`
	IsError    bool   `json:"isError,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	At         string `json:"at,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	// Subagent blocks may contain nested delegations.
	Subagent *AgentSubagentDto `json:"subagent,omitempty"`
}

type AgentSubagentDto struct {
	SubagentID     string          `json:"subagentId,omitempty"`
	ChildSessionID string          `json:"childSessionId,omitempty"`
	Role           string          `json:"role,omitempty"`
	Objective      string          `json:"objective,omitempty"`
	Status         string          `json:"status,omitempty"`
	Result         string          `json:"result,omitempty"`
	DurationMs     int64           `json:"durationMs,omitempty"`
	Truncated      bool            `json:"truncated,omitempty"`
	Blocks         []AgentBlockDto `json:"blocks,omitempty"`
}

// AgentTurnUsageDto.Scope is "turn"; legacy records may use "session".
type AgentTurnUsageDto struct {
	InputTokens      int64   `json:"inputTokens,omitempty"`
	OutputTokens     int64   `json:"outputTokens,omitempty"`
	CacheReadTokens  int64   `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64   `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64   `json:"reasoningTokens,omitempty"`
	TotalCostUSD     float64 `json:"totalCostUSD,omitempty"`
	Scope            string  `json:"scope,omitempty"`
}

// AgentAskDto.Outcome is "allow", "deny" or "cancelled"; DecidedBy is the user, "countdown",
// "bypass", "agent", "stop" or "end". Questions is set for questions rather than permissions;
// Answers is keyed by each question's full text.
type AgentAskDto struct {
	ID          string            `json:"id"`
	Tool        string            `json:"tool"`
	DisplayName string            `json:"displayName,omitempty"`
	Description string            `json:"description,omitempty"`
	Input       string            `json:"input,omitempty"`
	Questions   []map[string]any  `json:"questions,omitempty"`
	Answers     map[string]string `json:"answers,omitempty"`
	Outcome     string            `json:"outcome"`
	DecidedBy   string            `json:"decidedBy,omitempty"`
	At          string            `json:"at,omitempty"`
}

// AgentAttachmentDto exposes no host path; fetch bytes at GET /hybridflow-runner/attachments/{id}.
// Name is the stored, path-safe upload name shown to both model and user.
type AgentAttachmentDto struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType,omitempty"`
}

// AgentMessageDto role "notice" denotes service text the model never saw.
// Render Blocks when present; Text and Tools are derived compatibility fields.
// Legacy messages omit Blocks because their order was not recorded.
type AgentMessageDto struct {
	ID   string `json:"id"`
	Role string `json:"role"`
	Text string `json:"text"`
	At   string `json:"at"`
	// TurnID groups the prompt, intervening messages and reply; empty for unowned or legacy messages.
	TurnID string `json:"turnId,omitempty"`
	// Between marks a user message sent during a running turn; Role remains "user".
	Between bool `json:"between,omitempty"`
	// AfterBlocks counts reply blocks received before this between: zero before the first,
	// absent on legacy records without captured placement.
	AfterBlocks    *int              `json:"afterBlocks,omitempty"`
	Blocks         []AgentBlockDto   `json:"blocks,omitempty"`
	Tools          []AgentToolUseDto `json:"tools,omitempty"`
	Model          string            `json:"model,omitempty"`
	Effort         string            `json:"effort,omitempty"`
	PermissionMode string            `json:"permissionMode,omitempty"`
	ExitCode       *int              `json:"exitCode,omitempty"`
	Interrupted    bool              `json:"interrupted,omitempty"`
	Truncated      bool              `json:"truncated,omitempty"`
	// Assistant-only timings: StartedAt/FinishedAt are RFC3339; DurationMs is elapsed time,
	// FirstBlockMs is time to the first block, both in milliseconds.
	StartedAt    string `json:"startedAt,omitempty"`
	FinishedAt   string `json:"finishedAt,omitempty"`
	DurationMs   int64  `json:"durationMs,omitempty"`
	FirstBlockMs int64  `json:"firstBlockMs,omitempty"`
	// EndReason is the ending message. Muse Terminal is "completed", "cancelled" or "failed",
	// alongside a synthesized exit code.
	EndReason string `json:"endReason,omitempty"`
	Terminal  string `json:"terminal,omitempty"`
	// Assistant-only usage and resolved permission requests/questions.
	Usage *AgentTurnUsageDto `json:"usage,omitempty"`
	Asks  []AgentAskDto      `json:"asks,omitempty"`
	// User-prompt-only: actual composed message, system briefing and managed agent standing orders.
	ComposedPrompt string `json:"composedPrompt,omitempty"`
	SystemPrompt   string `json:"systemPrompt,omitempty"`
	Instructions   string `json:"instructions,omitempty"`
	// PlayedBy names the managed agent; AgentRef preserves the card's reference to it.
	// Play metadata appears on both prompt and reply.
	PlayedBy   string `json:"playedBy,omitempty"`
	AgentRef   string `json:"agentRef,omitempty"`
	RunID      string `json:"runId,omitempty"`
	FlowNodeID string `json:"flowNodeId,omitempty"`
	Board      string `json:"board,omitempty"`
	// Fork notice source; ForkFromMessage is empty for a whole-conversation fork.
	ForkFrom        string `json:"forkFrom,omitempty"`
	ForkFromMessage string `json:"forkFromMessage,omitempty"`
	// User-only attachment metadata survives deletion of the underlying files.
	Attachments []AgentAttachmentDto `json:"attachments,omitempty"`
}

// AgentForkRequestDto branches before FromMessageID, excluding that prompt so it can be asked
// again. Omitted FromMessageID or an empty body (legacy clients) forks the whole conversation.
type AgentForkRequestDto struct {
	FromMessageID string `json:"fromMessageId,omitempty"`
	// Agent defaults to the source's. Changing it starts a new session with the copied transcript
	// as preamble; session IDs cannot cross engines. The fork notice warns that the new agent
	// has not read the preceding transcript.
	Agent string `json:"agent,omitempty"`
}

type AgentConversationDetailDto struct {
	AgentConversationDto
	Messages []AgentMessageDto `json:"messages"`
}

// CreateConversationRequestDto fixes Folder for the conversation's lifetime; other settings
// are defaults overridable by subsequent prompts.
type CreateConversationRequestDto struct {
	Folder string `json:"folder"`
	// Agent defaults when omitted and is immutable; change it by forking.
	Agent          string `json:"agent,omitempty"`
	Title          string `json:"title,omitempty"`
	Model          string `json:"model,omitempty"`
	Effort         string `json:"effort,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	Thinking       *bool  `json:"thinking,omitempty"`
}

// PatchConversationRequestDto distinguishes omission from explicit false or empty string.
// Folder and Agent are immutable; change Agent through the fork endpoint.
type PatchConversationRequestDto struct {
	Title          *string `json:"title,omitempty"`
	Archived       *bool   `json:"archived,omitempty"`
	Pinned         *bool   `json:"pinned,omitempty"`
	Model          *string `json:"model,omitempty"`
	Effort         *string `json:"effort,omitempty"`
	PermissionMode *string `json:"permissionMode,omitempty"`
	Thinking       *bool   `json:"thinking,omitempty"`
	TraceStream    *bool   `json:"traceStream,omitempty"`
}

// Chain runs are service-wide; REST and socket updates include runs from every tab.

type AgentChainRunDto struct {
	ID string `json:"id"`
	Name string `json:"name"`
	// Handle is the board slug; its wire name remains "path".
	Handle string `json:"path"`
	// RootFlowNodeID never moves and is replayed on restart.
	RootFlowNodeID string `json:"rootFlowNodeId"`
	// FlowNodeID is the current node, or the target while the preceding chat is shortened.
	FlowNodeID string `json:"flowNodeId"`
	Chat  string `json:"chat"`
	State string `json:"state"`
	// RetryAt is epoch milliseconds, absent unless waiting. "waiting" retries after twenty minutes;
	// "refreshing" retries when the usage limit resets. StartedAt is also epoch milliseconds.
	RetryAt   int64 `json:"retryAt,omitempty"`
	StartedAt int64 `json:"startedAt"`
	// EndedAt is epoch milliseconds, absent while live. Ended runs remain available for restart.
	EndedAt int64 `json:"endedAt,omitempty"`
	// DocumentAt is the last board write in epoch milliseconds; zero until the first write.
	// Clients must reload to avoid overwriting unseen changes.
	DocumentAt int64 `json:"documentAt,omitempty"`
	// FlowNodes is ordered: played nodes, current node, then upcoming nodes.
	FlowNodes []AgentChainRunFlowNodeDto `json:"flowNodes,omitempty"`
	// Ending preserves the final notice; absent while live.
	Ending string `json:"ending,omitempty"`
}

type AgentChainRunFlowNodeDto struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Status is the board status; empty if the node was removed from the board.
	Status string `json:"status"`
	// Played records this run's progress independently of the board status.
	Played bool `json:"played,omitempty"`
	// Exactly one Current node while live; none after ending.
	Current bool `json:"current,omitempty"`
}

// AgentChainRunNoticeDto accompanies the state frame it describes.
type AgentChainRunNoticeDto struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	At    int64  `json:"at"`
	// ChainRun is the run's name, or empty for a notice without an owning run.
	ChainRun string `json:"chainRun,omitempty"`
}

const (
	noticeInfo    = "info"
	noticeWarning = "warning"
	noticeError   = "error"
)

type PlayChainRunRequestDto struct {
	// Handle is the board slug, serialized as "path".
	Handle     string `json:"path"`
	FlowNodeID string `json:"flowNodeId"`
	// Empty Name defaults to the start time.
	Name string `json:"name"`
}

// ChainRunRequestDto identifies a run for stop, resume, restart or forget.
type ChainRunRequestDto struct {
	RunID string `json:"runId"`
}

// ChainRunsStateDto includes live and retained ended runs, oldest first.
type ChainRunsStateDto struct {
	Runs []*AgentChainRunDto `json:"runs"`
}

type ChainRunDto struct {
	Run *AgentChainRunDto `json:"run"`
}
