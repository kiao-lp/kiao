package entities

import (
	"encoding/json"
	"time"
)

// TaskExecution fixes the resolved settings before the harness starts.
type TaskExecution struct {
	ID             string        `json:"id"`
	FlowNodeID     string        `json:"flowNodeId"`
	ConversationID string        `json:"conversationId"`
	TurnID         string        `json:"turnId"`
	RunnerID       string        `json:"runnerId,omitempty"`
	RunID          string        `json:"runId,omitempty"`
	Harness        string        `json:"harness"`
	Model          string        `json:"model"`
	Effort         string        `json:"effort"`
	Agent          ExecutedAgent `json:"agent"`
	At             time.Time     `json:"at"`
}

type ExecutedAgent struct {
	AgentVersion
	Harnesses  []Harness `json:"harnesses,omitempty"`
	Supersedes []string  `json:"supersedes,omitempty"`
	// Keep the stored JSON type so retries can match older execution records.
	Version json.RawMessage `json:"version,omitempty"`
}
