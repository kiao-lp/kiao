package config

// knownPermissionMode reports whether a mode is one this service can drive over the socket. An
// unknown value is never guessed at: reading it as either mode would silently give every turn of
// the conversation more or less freedom than was asked for, so it is refused where it is set rather
// than at the first prompt.
func KnownPermissionMode(mode string) bool {
	return AsksBeforeTools(mode) || mode == PermissionModeBypass
}
