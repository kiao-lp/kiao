package harnesses

// Window lengths vary by harness and plan; clients derive localized labels from minutes.
type HarnessWindow struct {
	// WindowMinutes is zero when the harness did not report a length; do not invent a label.
	WindowMinutes       int   `json:"windowMinutes"`
	PercentUsed         int   `json:"percentUsed"`
	ResetAtEpochSeconds int64 `json:"resetAtEpochSeconds"`
}

const FiveHourWindowMinutes = 5 * 60

const WeeklyWindowMinutes = 7 * 24 * 60

// HarnessUsageDto lists windows tightest first. An empty list means unavailable, not failure.
type HarnessUsageDto struct {
	Windows []HarnessWindow `json:"windows"`
}

// HarnessAuthStatusDto reports the selected host CLI's sign-in state. LoginEnabled reports
// whether that harness's browser sign-in endpoints are available.
type HarnessAuthStatusDto struct {
	LoggedIn         bool   `json:"loggedIn"`
	AuthMethod       string `json:"authMethod,omitempty"`
	Email            string `json:"email,omitempty"`
	OrgName          string `json:"orgName,omitempty"`
	SubscriptionType string `json:"subscriptionType,omitempty"`
	LoginEnabled     bool   `json:"loginEnabled"`
}

// HarnessLoginDto reports CLI refusal as HTTP 200 with ok:false and a displayable message.
// URL is set only at start; device start also sets UserCode for confirmation.
type HarnessLoginDto struct {
	Ok       bool   `json:"ok"`
	URL      string `json:"url,omitempty"`
	UserCode string `json:"userCode,omitempty"`
	Message  string `json:"message,omitempty"`
}

// HarnessDeviceLoginDto is pending until the CLI exits, then reports the approval outcome.
type HarnessDeviceLoginDto struct {
	Pending bool   `json:"pending"`
	Ok      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}
