package toolbox

// JSON wire types mirror reference/npm/kiao-worker/src/toolbox-types.ts and PROTOCOL.md.

const (
	StateInstalled    = "installed"    // installed by this service
	StatePresent      = "present"      // installed externally; cannot be removed here
	StateAvailable    = "available"    // installable here
	StateBlocked      = "blocked"      // unmet prerequisite
	StateUnavailable  = "unavailable"  // unsupported platform or architecture
	StateMissing      = "missing"      // installed per ledger, absent on machine
	StateUnresponsive = "unresponsive" // installed, but startup probe failed
)

type ToolboxComponentDto struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Agent-tab name for CLI runtimes; empty for other components.
	Agent string `json:"agent,omitempty"`
	Title string `json:"title"`
	Role  string `json:"role"`

	// Resolved platform-specific recipe channel; empty when unavailable.
	Channel string `json:"channel,omitempty"`

	State string `json:"state"`
	// User-facing explanation, shown verbatim.
	Reason string `json:"reason,omitempty"`

	// Full dependency list for install confirmations.
	Requires []string `json:"requires,omitempty"`
	// Dependencies not yet present on the machine.
	MissingRequires []string `json:"missingRequires,omitempty"`

	Version     string `json:"version,omitempty"`
	InstalledAt string `json:"installedAt,omitempty"`

	// Whether turns receive this MCP server or the agent selector offers this CLI.
	// Independent of installation; meaningless for other runtimes.
	Registered bool `json:"registered"`
	// Tool count and definition bytes added to each turn request.
	Tools     int `json:"tools,omitempty"`
	ToolBytes int `json:"toolBytes,omitempty"`
	// Last probe attempt, successful or failed; absent if never probed.
	ProbedAt string `json:"probedAt,omitempty"`
}

type ToolboxDto struct {
	// False without an install prefix; the catalogue remains readable.
	Enabled  bool   `json:"enabled"`
	Platform string `json:"platform"`
	Prefix   string `json:"prefix,omitempty"`

	// When true, turns receive only registered servers, excluding ~/.claude.json.
	Strict bool `json:"strict"`

	Components []ToolboxComponentDto `json:"components"`

	// Current or last completed install; at most one.
	Job *ToolboxJobDto `json:"job,omitempty"`
}

const (
	JobRunning = "running"
	JobDone    = "done"
	JobFailed  = "failed"
)

// ToolboxJobDto is polled; Log grows during install or uninstall.
type ToolboxJobDto struct {
	ID    string   `json:"id"`
	Op    string   `json:"op"` // "install" | "uninstall"
	IDs   []string `json:"ids"`
	State string   `json:"state"`
	Log   string   `json:"log"`
	Error string   `json:"error,omitempty"`

	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt,omitempty"`
}

// ToolboxRequestDto accepts catalogue IDs only, never commands, packages or versions.
// Caller requests are bounded by the catalogue compiled into the binary.
type ToolboxRequestDto struct {
	IDs []string `json:"ids"`
	// Used only by the registration toggle.
	Enabled bool `json:"enabled"`
}
