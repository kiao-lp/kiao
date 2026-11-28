package config

// Reject unknown modes when set to avoid silently changing tool permissions
// for the conversation.
func KnownPermissionMode(mode string) bool {
	return AsksBeforeTools(mode) || mode == PermissionModeBypass
}
