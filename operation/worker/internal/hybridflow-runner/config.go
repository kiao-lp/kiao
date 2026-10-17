package hybridflowrunner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"kiao/worker/internal/core"
)

// Config combines shared worker configuration with CLI and runner settings.
// KIAO_WORKER_HYBRIDFLOW_RUNNER_* names take precedence over legacy AGENT_* and
// CLAUDE_*/CODEX_* names, including explicitly empty values (see envName).
type Config struct {
	*core.Config

	// Empty disables boards: Play and /boards return 503; conversations still work.
	HybridflowURL string // KIAO_WORKER_HYBRIDFLOW_URL

	// Service bearer shared with hybridflow-store: runs outlive the initiating user token.
	// The run owner is sent separately in a header for attribution.
	HybridflowToken string // KIAO_WORKER_HYBRIDFLOW_TOKEN

	// RunnerID accepts unpinned tasks and tasks pinned to this id; empty refuses all pinned tasks.
	// Heartbeats require both RunnerID and HybridflowURL.
	// The environment overrides state/runner.json; saving that file otherwise adopts the id live.
	// Use currentRunnerID/adoptRunnerID: runnerMu protects heartbeat and request access.
	RunnerID string // KIAO_WORKER_RUNNER_ID
	runnerMu sync.RWMutex
	// Set once by LoadConfig; when true, runner.json is never read.
	runnerFromEnv bool

	// KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_CREDENTIALS_PATH; ~/.claude/.credentials.json by default.
	ClaudeCredentialsPath string

	// Enables /hybridflow-runner/auth/login/*; binds the host CLI to the authorising account.
	// KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED, default false.
	ClaudeLoginEnabled bool

	// Enables Muse device/API-key sign-in, binding the host CLI to that account.
	// KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED, default false.
	MuseLoginEnabled bool

	// Deployment-wide gate for bypassPermissions (--dangerously-skip-permissions).
	// When false, the mode is hidden and refused; manual approval modes remain available.
	BypassEnabled bool // KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED, default true

	// Caps concurrent turns across all conversations and agents; each turn is a CLI process.
	MaxTurns int // KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS, default 4

	// Passed as --setting-sources; empty omits the flag. Default "user" prevents
	// pulled project settings from installing hooks that --print runs without prompting.
	ClaudeSettingSources string // KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES, default "user"

	// Staged kiao-mcp bundle passed via --mcp-config; empty leaves the CLI's own servers in use.
	MCPPath string // KIAO_WORKER_MCP_PATH ("" disables)

	// Seeds the toolbox ledger on first use; thereafter the configuration panel
	// determines which bundled servers a turn receives (see mcpEntrypoints).
	MCPServers string // KIAO_WORKER_MCP_SERVERS, default "files,hybridflow"

	// Deployment vetoes (KIAO_WORKER_HYBRIDFLOW_RUNNER_{CLAUDE,CODEX}_ENABLED, default true).
	// Negated so a zero-value Config vetoes nothing. Availability also requires the CLI
	// on PATH and the configuration panel to enable it (agents.go, offers).
	ClaudeDisabled bool
	CodexDisabled  bool
	// KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED, default true; legacy AGENT_MUSE_ENABLED accepted.
	MuseDisabled bool
	// KIAO_WORKER_HYBRIDFLOW_RUNNER_OPENCODE_ENABLED, default true; no legacy name.
	OpenCodeDisabled bool

	// Passes --ignore-user-config when supplying MCP servers, discarding all user
	// configuration, including provider and catalogue, not just MCP settings.
	// KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_IGNORE_USER_CONFIG, default false.
	CodexIgnoreUserConfig bool

	// Shutdown command for board requests; empty disables shutdown.
	// Split on whitespace and run without a shell (see shutdown.go).
	ShutdownCommand string // KIAO_WORKER_SHUTDOWN_COMMAND, default "" (nothing)
}

// Validate reports runner configuration problems; the program combines these with core validation.
func (c *Config) Validate() []string {
	var problems []string

	// Fail at startup rather than silently leaving turns without tools.
	if p := strings.TrimSpace(c.MCPPath); p != "" {
		if !filepath.IsAbs(p) {
			problems = append(problems, fmt.Sprintf(
				"KIAO_WORKER_MCP_PATH %q is not absolute", c.MCPPath))
		} else if _, err := BundledMCPServers(c); err != nil {
			problems = append(problems, err.Error())
		}
	}

	// Otherwise every turn is refused as "too many turns", masking a configuration error.
	if c.MaxTurns < 1 {
		problems = append(problems, fmt.Sprintf(
			"%s is %d; it must be at least 1", envMaxTurns(), c.MaxTurns))
	}

	// Reject unknown sources before spawning; empty is allowed to omit the flag.
	for _, source := range strings.Split(c.ClaudeSettingSources, ",") {
		switch strings.TrimSpace(source) {
		case "", "user", "project", "local":
		default:
			problems = append(problems, fmt.Sprintf(
				"%s %q is not one of: user, project, local", envSettingSources(), source))
		}
	}

	return problems
}

// envName chooses the first set name, newest first, falling back to the oldest.
// An explicitly empty value wins: some settings use it to omit a CLI flag.
// Validation uses the same name to identify the variable actually read.
func envName(names ...string) string {
	for _, name := range names {
		if _, ok := os.LookupEnv(name); ok {
			return name
		}
	}
	return names[len(names)-1]
}

func envCredentialsPath() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_CREDENTIALS_PATH", "KIAO_WORKER_AGENT_CLAUDE_CREDENTIALS_PATH", "KIAO_WORKER_CLAUDE_CREDENTIALS_PATH")
}

func envLoginEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED", "KIAO_WORKER_AGENT_CLAUDE_LOGIN_ENABLED", "KIAO_WORKER_CLAUDE_LOGIN_ENABLED")
}

func envMuseLoginEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED", "KIAO_WORKER_AGENT_MUSE_LOGIN_ENABLED")
}

func envSettingSources() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES", "KIAO_WORKER_AGENT_CLAUDE_SETTING_SOURCES", "KIAO_WORKER_CLAUDE_SETTING_SOURCES")
}

func envBypassEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED", "KIAO_WORKER_AGENT_BYPASS_ENABLED", "KIAO_WORKER_CLAUDE_BYPASS_ENABLED")
}

func envMaxTurns() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS", "KIAO_WORKER_AGENT_MAX_TURNS", "KIAO_WORKER_CLAUDE_MAX_TURNS")
}

func envClaudeEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_ENABLED", "KIAO_WORKER_AGENT_CLAUDE_ENABLED", "KIAO_WORKER_CLAUDE_ENABLED")
}

func envCodexEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED", "KIAO_WORKER_AGENT_CODEX_ENABLED", "KIAO_WORKER_CODEX_ENABLED")
}

func envMuseEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED", "KIAO_WORKER_AGENT_MUSE_ENABLED")
}

func envOpenCodeEnabled() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_OPENCODE_ENABLED")
}

func envCodexIgnoreUserConfig() string {
	return envName("KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_IGNORE_USER_CONFIG", "KIAO_WORKER_AGENT_CODEX_IGNORE_USER_CONFIG", "KIAO_WORKER_CODEX_IGNORE_USER_CONFIG")
}

// LoadConfig reads runner settings on top of shared worker configuration.
func LoadConfig(shared *core.Config) *Config {
	home, _ := os.UserHomeDir()
	defaultCreds := filepath.Join(home, ".claude", ".credentials.json")

	// LookupEnv preserves explicit empty: omit --setting-sources instead of using the default.
	settingSources := "user"
	if v, ok := os.LookupEnv(envSettingSources()); ok {
		settingSources = strings.TrimSpace(v)
	}
	runnerID := strings.TrimSpace(core.Getenv("KIAO_WORKER_RUNNER_ID", ""))

	return &Config{
		Config:                shared,
		HybridflowURL:         strings.TrimRight(core.Getenv("KIAO_WORKER_HYBRIDFLOW_URL", ""), "/"),
		HybridflowToken:       core.Getenv("KIAO_WORKER_HYBRIDFLOW_TOKEN", ""),
		RunnerID:              runnerID,
		runnerFromEnv:         runnerID != "",
		ClaudeCredentialsPath: core.Getenv(envCredentialsPath(), defaultCreds),
		ClaudeLoginEnabled:    core.GetenvBool(envLoginEnabled(), false),
		MuseLoginEnabled:      core.GetenvBool(envMuseLoginEnabled(), false),
		BypassEnabled:         core.GetenvBool(envBypassEnabled(), true),
		MaxTurns:              core.GetenvInt(envMaxTurns(), 4),
		ClaudeSettingSources:  settingSources,
		MCPPath:               core.GetenvPath("KIAO_WORKER_MCP_PATH", ""),
		MCPServers:            core.Getenv("KIAO_WORKER_MCP_SERVERS", "files,hybridflow"),
		ClaudeDisabled:        !core.GetenvBool(envClaudeEnabled(), true),
		CodexDisabled:         !core.GetenvBool(envCodexEnabled(), true),
		MuseDisabled:          !core.GetenvBool(envMuseEnabled(), true),
		OpenCodeDisabled:      !core.GetenvBool(envOpenCodeEnabled(), true),
		CodexIgnoreUserConfig: core.GetenvBool(envCodexIgnoreUserConfig(), false),
		ShutdownCommand:       core.Getenv("KIAO_WORKER_SHUTDOWN_COMMAND", ""),
	}
}
