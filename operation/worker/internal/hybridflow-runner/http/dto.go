package runnerhttp

// CreateConversationRequestDto fixes Folder for the conversation's lifetime; other settings
// are defaults overridable by subsequent prompts.
type CreateConversationRequestDto struct {
	ProfileID string `json:"profileId,omitempty"`
	Folder    string `json:"folder"`
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
