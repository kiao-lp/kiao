package agents

// Window lengths vary by agent and plan; clients derive localized labels from minutes.
type AgentWindow struct {
	// WindowMinutes is zero when the agent did not report a length; do not invent a label.
	WindowMinutes       int   `json:"windowMinutes"`
	PercentUsed         int   `json:"percentUsed"`
	ResetAtEpochSeconds int64 `json:"resetAtEpochSeconds"`
}

const FiveHourWindowMinutes = 5 * 60

const WeeklyWindowMinutes = 7 * 24 * 60

// AgentUsageDto lists windows tightest first. An empty list means unavailable, not failure.
type AgentUsageDto struct {
	Windows []AgentWindow `json:"windows"`
}

// AgentAuthStatusDto reports the selected host CLI's sign-in state. LoginEnabled reports
// whether that agent's browser sign-in endpoints are available.
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
