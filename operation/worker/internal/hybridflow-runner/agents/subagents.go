package agents

// Beyond this depth, retain delegation metadata without fetching transcripts.
const MaxSubagentDepth = 3

// Keep newest blocks and mark the delegation Truncated when capped.
const MaxSubagentBlocks = 200

// Bound transcript fetches per turn; excess delegations remain metadata-only.
const MaxSubagentFetches = 50

const MaxSubagentObjectiveChars = 2000

const MaxSubagentResultChars = 8 * 1024

const MaxSubagentNameChars = 200

// SubagentRef is the parent-reported delegation metadata passed to an agent-specific reader.
type SubagentRef struct {
	// SubagentID identifies the delegation in the parent session; ChildSessionID locates
	// the child transcript. Missing handles leave the delegation metadata-only.
	SubagentID     string
	ChildSessionID string
	Role           string
	Objective      string
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
	ReadSubagent(ref SubagentRef) (*TurnSubagent, error)
}

// turnSubagent travels on blockKindSubagent; the block text retains the parent summary
// for readers that cannot display child transcripts.
type TurnSubagent struct {
	SubagentID     string
	ChildSessionID string
	Role           string
	Objective      string
	Status         string
	Result         string
	// Zero means duration was not measured.
	DurationMs int64
	// Truncated covers capture limits and record caps applied before persistence.
	Truncated bool
	// Child blocks in production order, including nested delegations.
	Blocks []TurnBlock
}

// The caller must mark the delegation Truncated when blocks are dropped.
func CapSubagentBlocks(blocks []TurnBlock) ([]TurnBlock, bool) {
	if len(blocks) <= MaxSubagentBlocks {
		return blocks, false
	}
	return blocks[len(blocks)-MaxSubagentBlocks:], true
}

// Mark unread transcripts Truncated so metadata-only records cannot imply an idle child.
func MetadataSubagent(ref SubagentRef) *TurnSubagent {
	return &TurnSubagent{
		SubagentID: ref.SubagentID, ChildSessionID: ref.ChildSessionID,
		Role: ref.Role, Objective: ref.Objective,
		Status: ref.Status, Result: ref.Summary,
		DurationMs: ref.DurationMs,
		Truncated:  true,
	}
}
