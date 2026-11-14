package toolboxhttp

// ToolboxRequestDto accepts catalogue IDs only, never commands, packages or versions.
// Caller requests are bounded by the catalogue compiled into the binary.
type ToolboxRequestDto struct {
	IDs []string `json:"ids"`
	// Used only by the registration toggle.
	Enabled bool `json:"enabled"`
}
