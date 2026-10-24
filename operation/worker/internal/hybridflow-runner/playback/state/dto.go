package state

type AgentChainRunDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Handle is the board slug; its wire name remains "path".
	Handle string `json:"path"`
	// RootFlowNodeID never moves and is replayed on restart.
	RootFlowNodeID string `json:"rootFlowNodeId"`
	// FlowNodeID is the current node, or the target while the preceding chat is shortened.
	FlowNodeID string `json:"flowNodeId"`
	Chat       string `json:"chat"`
	State      string `json:"state"`
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

const NoticeInfo = "info"

const NoticeWarning = "warning"

const NoticeError = "error"

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
