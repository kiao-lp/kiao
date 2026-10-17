package hybridflowrunner

const (
	// Beyond this depth, retain delegation metadata without fetching transcripts.
	maxSubagentDepth = 3
	// Keep newest blocks and mark the delegation Truncated when capped.
	maxSubagentBlocks = 200
	// Bound transcript fetches per turn; excess delegations remain metadata-only.
	maxSubagentFetches = 50

	maxSubagentObjectiveChars = 2000
	maxSubagentResultChars    = 8 * 1024
	maxSubagentNameChars = 200
)

// SubagentRef is the parent-reported delegation metadata passed to an agent-specific reader.
type SubagentRef struct {
	// SubagentID identifies the delegation in the parent session; ChildSessionID locates
	// the child transcript. Missing handles leave the delegation metadata-only.
	SubagentID     string
	ChildSessionID string
	Role      string
	Objective string
	// Status uses the agent's own vocabulary (e.g. completed, failed, running).
	Status  string
	Summary string
	// Zero means duration was not measured.
	DurationMs int64
}

// SubagentReader returns child blocks in production order. Drivers own the live connection;
// the hub does not read transcripts. Read errors fall back to the parent summary, while
// budget exhaustion returns metadata with Truncated set, not an empty transcript.
type SubagentReader interface {
	ReadSubagent(ref SubagentRef) (*turnSubagent, error)
}

// turnSubagent travels on blockKindSubagent; the block text retains the parent summary
// for readers that cannot display child transcripts.
type turnSubagent struct {
	SubagentID     string
	ChildSessionID string
	Role      string
	Objective string
	Status    string
	Result    string
	// Zero means duration was not measured.
	DurationMs int64
	// Truncated covers capture limits and record caps applied before persistence.
	Truncated bool
	// Child blocks in production order, including nested delegations.
	Blocks []turnBlock
}

type conversationSubagent struct {
	SubagentID     string              `json:"subagentId,omitempty"`
	ChildSessionID string              `json:"childSessionId,omitempty"`
	Role           string              `json:"role,omitempty"`
	Objective      string              `json:"objective,omitempty"`
	Status         string              `json:"status,omitempty"`
	Result         string              `json:"result,omitempty"`
	DurationMs     int64               `json:"durationMs,omitempty"`
	Truncated      bool                `json:"truncated,omitempty"`
	Blocks         []conversationBlock `json:"blocks,omitempty"`
}

func subagentToRecord(sub *turnSubagent) *conversationSubagent {
	if sub == nil {
		return nil
	}
	out := &conversationSubagent{
		SubagentID: sub.SubagentID, ChildSessionID: sub.ChildSessionID,
		Role: sub.Role, Objective: sub.Objective,
		Status: sub.Status, Result: sub.Result,
		DurationMs: sub.DurationMs, Truncated: sub.Truncated,
	}
	for _, block := range sub.Blocks {
		out.Blocks = append(out.Blocks, blockToRecord(block))
	}
	return out
}

func blockToRecord(block turnBlock) conversationBlock {
	at := ""
	if !block.at.IsZero() {
		at = block.at.UTC().Format(conversationTimeFormat)
	}
	return conversationBlock{
		Kind: block.kind, Text: block.text,
		Name: block.name, Input: block.input, Detail: block.detail,
		ToolUseID: block.toolUseID, Result: block.result,
		IsError: block.isError, ExitCode: block.exitCode,
		At: at, DurationMs: block.durationMs,
		Subagent: subagentToRecord(block.subagent),
	}
}

// The caller must mark the delegation Truncated when blocks are dropped.
func capSubagentBlocks(blocks []turnBlock) ([]turnBlock, bool) {
	if len(blocks) <= maxSubagentBlocks {
		return blocks, false
	}
	return blocks[len(blocks)-maxSubagentBlocks:], true
}

// Mark unread transcripts Truncated so metadata-only records cannot imply an idle child.
func metadataSubagent(ref SubagentRef) *turnSubagent {
	return &turnSubagent{
		SubagentID: ref.SubagentID, ChildSessionID: ref.ChildSessionID,
		Role: ref.Role, Objective: ref.Objective,
		Status: ref.Status, Result: ref.Summary,
		DurationMs: ref.DurationMs,
		Truncated:  true,
	}
}
