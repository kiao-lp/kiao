package core

// MCPServer is shared by toolbox selection and runner delivery.
// For stdio, Command must be an installation-resolved absolute path, never a PATH lookup.
type MCPServer struct {
	// Name appears in mcp__<name>__<tool>.
	Name string

	// Type selects stdio (Command/Args) or http (URL/Headers).
	Type string

	Command string
	Args    []string

	URL     string
	Headers map[string]string

	// Env merges with the CLI environment; CLI-expanded ${VAR} keeps credentials out of
	// files and process arguments. Never override PATH: it affects every server.
	Env map[string]string
}

const (
	MCPStdio = "stdio"
	MCPHTTP  = "http"
)
