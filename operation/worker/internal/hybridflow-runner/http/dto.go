package runnerhttp

// The folder and agent snapshot are fixed for the conversation's lifetime.
type CreateConversationRequestDto struct {
	Folder         string `json:"folder"`
	AgentID        string `json:"agentId"`
	Harness        string `json:"harness,omitempty"`
	ProfileID      string `json:"profileId,omitempty"`
	Model          string `json:"model,omitempty"`
	UseDraft       bool   `json:"useDraft,omitempty"`
	Title          string `json:"title,omitempty"`
	Effort         string `json:"effort,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	Thinking       *bool  `json:"thinking,omitempty"`
}

// PatchConversationRequestDto distinguishes omission from explicit false or empty string.
// To change the execution configuration, fork with an agent publication.
type PatchConversationRequestDto struct {
	ProfileID      *string `json:"profileId,omitempty"`
	Title          *string `json:"title,omitempty"`
	Archived       *bool   `json:"archived,omitempty"`
	Pinned         *bool   `json:"pinned,omitempty"`
	Model          *string `json:"model,omitempty"`
	Effort         *string `json:"effort,omitempty"`
	PermissionMode *string `json:"permissionMode,omitempty"`
	Thinking       *bool   `json:"thinking,omitempty"`
	TraceStream    *bool   `json:"traceStream,omitempty"`
}
