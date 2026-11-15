package conversations

import (
	"kiao/worker/internal/hybridflow-runner/boards"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

// HarnessConversationDto.Running comes from the live turn registry, not persisted metadata.
type HarnessConversationDto struct {
	AgentVersion *boards.ManagedAgentVersion `json:"agentVersion,omitempty"`
	ProfileID    string                      `json:"profileId,omitempty"`
	ID           string                      `json:"id"`
	Title        string                      `json:"title"`
	Folder       string                      `json:"folder"`
	// Harness resolves an omitted stored value to the default. Changing harnesses requires a fork.
	Harness        string `json:"harness"`
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

// HarnessToolUseDto matches the socket tool_use name/summary pair.
type HarnessToolUseDto struct {
	Name  string `json:"name"`
	Input string `json:"input,omitempty"`
}

// HarnessBlockDto preserves reply order: "text", "thinking" (empty if redacted), "tool_use"
// (Name, short Input, full Detail), or "subagent" (parent summary in Text, child in Subagent).
type HarnessBlockDto struct {
	Kind   string `json:"kind"`
	Text   string `json:"text,omitempty"`
	Name   string `json:"name,omitempty"`
	Input  string `json:"input,omitempty"`
	Detail string `json:"detail,omitempty"`
	// ToolUseID is the harness call ID. ExitCode is absent if unreported.
	// At is RFC3339; DurationMs is elapsed milliseconds when measured.
	ToolUseID  string `json:"toolUseId,omitempty"`
	Result     string `json:"result,omitempty"`
	IsError    bool   `json:"isError,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	At         string `json:"at,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	// Subagent blocks may contain nested delegations.
	Subagent *HarnessSubagentDto `json:"subagent,omitempty"`
}

type HarnessSubagentDto struct {
	SubagentID     string            `json:"subagentId,omitempty"`
	ChildSessionID string            `json:"childSessionId,omitempty"`
	Role           string            `json:"role,omitempty"`
	Objective      string            `json:"objective,omitempty"`
	Status         string            `json:"status,omitempty"`
	Result         string            `json:"result,omitempty"`
	DurationMs     int64             `json:"durationMs,omitempty"`
	Truncated      bool              `json:"truncated,omitempty"`
	Blocks         []HarnessBlockDto `json:"blocks,omitempty"`
}

// HarnessTurnUsageDto.Scope is "turn"; legacy records may use "session".
type HarnessTurnUsageDto struct {
	InputTokens      int64   `json:"inputTokens,omitempty"`
	OutputTokens     int64   `json:"outputTokens,omitempty"`
	CacheReadTokens  int64   `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64   `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64   `json:"reasoningTokens,omitempty"`
	TotalCostUSD     float64 `json:"totalCostUSD,omitempty"`
	Scope            string  `json:"scope,omitempty"`
}

// HarnessAskDto.Outcome is "allow", "deny" or "cancelled"; DecidedBy is the user, "countdown",
// "bypass", "harness", "stop" or "end". Questions is set for questions rather than permissions;
// Answers is keyed by each question's full text.
type HarnessAskDto struct {
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

// HarnessAttachmentDto exposes no host path; fetch bytes at GET /hybridflow-runner/attachments/{id}.
// Name is the stored, path-safe upload name shown to both model and user.
type HarnessAttachmentDto struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType,omitempty"`
}

// HarnessMessageDto role "notice" denotes service text the model never saw.
// Render Blocks when present; Text and Tools are derived compatibility fields.
// Legacy messages omit Blocks because their order was not recorded.
type HarnessMessageDto struct {
	Execution *turntrace.HarnessTurnExecution   `json:"execution,omitempty"`
	Queue     []harnessapi.HarnessQueuedMessage `json:"queue,omitempty"`
	ProfileID string                            `json:"profileId,omitempty"`
	ID        string                            `json:"id"`
	Role      string                            `json:"role"`
	Text      string                            `json:"text"`
	At        string                            `json:"at"`
	// TurnID groups the prompt, intervening messages and reply; empty for unowned or legacy messages.
	TurnID string `json:"turnId,omitempty"`
	// Between marks a user message sent during a running turn; Role remains "user".
	Between bool `json:"between,omitempty"`
	// AfterBlocks counts reply blocks received before this between: zero before the first,
	// absent on legacy records without captured placement.
	AfterBlocks    *int                `json:"afterBlocks,omitempty"`
	Blocks         []HarnessBlockDto   `json:"blocks,omitempty"`
	Tools          []HarnessToolUseDto `json:"tools,omitempty"`
	Model          string              `json:"model,omitempty"`
	Effort         string              `json:"effort,omitempty"`
	PermissionMode string              `json:"permissionMode,omitempty"`
	ExitCode       *int                `json:"exitCode,omitempty"`
	Interrupted    bool                `json:"interrupted,omitempty"`
	Truncated      bool                `json:"truncated,omitempty"`
	// Assistant-only timings: StartedAt/FinishedAt are RFC3339; DurationMs is elapsed time,
	// FirstBlockMs is time to the first block, both in milliseconds.
	StartedAt    string `json:"startedAt,omitempty"`
	FinishedAt   string `json:"finishedAt,omitempty"`
	DurationMs   int64  `json:"durationMs,omitempty"`
	FirstBlockMs int64  `json:"firstBlockMs,omitempty"`
	// EndReason is the ending message; Terminal is the driver's final status, when supplied.
	EndReason string `json:"endReason,omitempty"`
	Terminal  string `json:"terminal,omitempty"`
	// Assistant-only usage and resolved permission requests/questions.
	Usage *HarnessTurnUsageDto `json:"usage,omitempty"`
	Asks  []HarnessAskDto      `json:"asks,omitempty"`
	// User-prompt-only: actual composed message, system briefing and managed agent standing orders.
	ComposedPrompt string `json:"composedPrompt,omitempty"`
	SystemPrompt   string `json:"systemPrompt,omitempty"`
	Instructions   string `json:"instructions,omitempty"`
	// PlayedBy names the managed agent; AgentRef preserves the card's reference to it.
	// Play metadata appears on both prompt and reply.
	PlayedBy     string `json:"playedBy,omitempty"`
	AgentRef     string `json:"agentRef,omitempty"`
	AgentVersion int64  `json:"agentVersion,omitempty"`
	RunID        string `json:"runId,omitempty"`
	FlowNodeID   string `json:"flowNodeId,omitempty"`
	Board        string `json:"board,omitempty"`
	// Fork notice source; ForkFromMessage is empty for a whole-conversation fork.
	ForkFrom        string `json:"forkFrom,omitempty"`
	ForkFromMessage string `json:"forkFromMessage,omitempty"`
	// User-only attachment metadata survives deletion of the underlying files.
	Attachments []HarnessAttachmentDto `json:"attachments,omitempty"`
}

// HarnessForkRequestDto branches before FromMessageID, excluding that prompt so it can be asked
// again. Omitted FromMessageID or an empty body (legacy clients) forks the whole conversation.
type HarnessForkRequestDto struct {
	ProfileID     string `json:"profileId,omitempty"`
	FromMessageID string `json:"fromMessageId,omitempty"`
	// Harness defaults to the source's. Changing it starts a new session with the copied transcript
	// as preamble; session IDs cannot cross engines. The fork notice warns that the new harness
	// has not read the preceding transcript.
	Harness string `json:"harness,omitempty"`
}

type HarnessConversationDetailDto struct {
	HarnessConversationDto
	Messages []HarnessMessageDto `json:"messages"`
}
