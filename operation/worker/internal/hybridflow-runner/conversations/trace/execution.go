package trace

// Recorded on the common prompt/reply and trace; it contains no local paths or credentials.
type AgentTurnExecution struct {
	ProfileID       string `json:"profileId"`
	ProfileRevision int64  `json:"profileRevision"`
	Version         string `json:"version"`
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	Effort          string `json:"effort"`
}
