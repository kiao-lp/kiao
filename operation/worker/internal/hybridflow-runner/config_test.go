package hybridflowrunner

import (
	"os"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// TestConfigValidate covers the checks this half adds to the socle's: everything about how a turn
// is spawned, reported at startup rather than as a turn that quietly lacks its tools.
func TestConfigValidate(t *testing.T) {
	dir := t.TempDir()
	// Pointers, because the struct holds the runner lock: ranging over values would copy it.
	cases := []struct {
		name  string
		cfg   *Config
		wantN int
	}{
		{"valid", &Config{Config: &core.Config{RootPath: dir}, MaxTurns: 4}, 0},
		// A turn cap of zero refuses every prompt, which reaches the UI as an ordinary "too many
		// turns" and is indistinguishable from a busy service; it has to be caught at startup.
		{"turn cap of zero", &Config{Config: &core.Config{RootPath: dir}}, 1},
		// --setting-sources goes to the CLI verbatim, so an unknown source fails every spawn rather
		// than anything the service would recognise as a configuration problem. Empty is legal: it
		// is how the flag is omitted.
		{"unknown setting source", &Config{Config: &core.Config{RootPath: dir}, MaxTurns: 4, ClaudeSettingSources: "user,enterprise"}, 1},
		{"no setting sources", &Config{Config: &core.Config{RootPath: dir}, MaxTurns: 4, ClaudeSettingSources: ""}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.Validate(); len(got) != c.wantN {
				t.Errorf("Validate() = %v (%d problems), want %d", got, len(got), c.wantN)
			}
		})
	}
}

// "Empty omits --setting-sources" has to be a thing an operator can actually say, and core.Getenv reads an
// empty environment value as unset and hands back the default — which is why this one setting is read
// with LookupEnv instead.
func TestSettingSourcesCanBeSpelledEmpty(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())

	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES", "")
	if got := LoadConfig(core.LoadConfig()).ClaudeSettingSources; got != "" {
		t.Errorf("ClaudeSettingSources = %q, want the empty value that omits the flag", got)
	}

	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES", "user,project")
	if got := LoadConfig(core.LoadConfig()).ClaudeSettingSources; got != "user,project" {
		t.Errorf("ClaudeSettingSources = %q, want the configured sources", got)
	}

	// Unset is the case that matters most: a deployment that says nothing must still get the "user"
	// that keeps a .claude/settings.json arriving through `git pull` from being loaded.
	os.Unsetenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES") // t.Setenv above restores it afterwards
	if got := LoadConfig(core.LoadConfig()).ClaudeSettingSources; got != "user" {
		t.Errorf("ClaudeSettingSources = %q, want the default %q", got, "user")
	}
}

// ── The per-agent namespace ───────────────────────────────────────────────────
//
// Every setting was `KIAO_WORKER_CLAUDE_*` when there was one agent, then
// `KIAO_WORKER_AGENT_*` when the second one arrived. The names are namespaced now —
// `…_HYBRIDFLOW_RUNNER_*` for what the deployment says about every agent,
// `…_HYBRIDFLOW_RUNNER_<NAME>_*` for one agent's own — and both older spellings are still read,
// which is the half a deployment upgrading to this build depends on.

// A deployment that still speaks the middle spelling gets exactly what it always did.
func TestTheAgentEnvironmentNamesAreStillRead(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_AGENT_MAX_TURNS", "9")
	t.Setenv("KIAO_WORKER_AGENT_BYPASS_ENABLED", "false")
	t.Setenv("KIAO_WORKER_AGENT_CLAUDE_LOGIN_ENABLED", "true")
	t.Setenv("KIAO_WORKER_AGENT_CLAUDE_CREDENTIALS_PATH", "/tmp/agent-creds.json")
	t.Setenv("KIAO_WORKER_AGENT_CODEX_ENABLED", "true")
	t.Setenv("KIAO_WORKER_AGENT_MUSE_ENABLED", "false")

	cfg := LoadConfig(core.LoadConfig())
	if cfg.MaxTurns != 9 || cfg.BypassEnabled || !cfg.ClaudeLoginEnabled {
		t.Errorf("MaxTurns/BypassEnabled/LoginEnabled = %d/%v/%v, want the agent names honoured",
			cfg.MaxTurns, cfg.BypassEnabled, cfg.ClaudeLoginEnabled)
	}
	if cfg.ClaudeCredentialsPath != "/tmp/agent-creds.json" || cfg.CodexDisabled || !cfg.MuseDisabled {
		t.Errorf("credentials/codex/muse = %q/%v/%v, want the agent names honoured",
			cfg.ClaudeCredentialsPath, !cfg.CodexDisabled, cfg.MuseDisabled)
	}
}

// A deployment that says nothing new gets exactly what it always did.
func TestTheOldEnvironmentNamesAreStillRead(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_CLAUDE_MAX_TURNS", "9")
	t.Setenv("KIAO_WORKER_CLAUDE_BYPASS_ENABLED", "false")
	t.Setenv("KIAO_WORKER_CLAUDE_LOGIN_ENABLED", "true")
	t.Setenv("KIAO_WORKER_CLAUDE_CREDENTIALS_PATH", "/tmp/old-creds.json")
	t.Setenv("KIAO_WORKER_CODEX_ENABLED", "true")

	cfg := LoadConfig(core.LoadConfig())
	if cfg.MaxTurns != 9 || cfg.BypassEnabled || !cfg.ClaudeLoginEnabled {
		t.Errorf("MaxTurns/BypassEnabled/LoginEnabled = %d/%v/%v, want the old names honoured",
			cfg.MaxTurns, cfg.BypassEnabled, cfg.ClaudeLoginEnabled)
	}
	if cfg.ClaudeCredentialsPath != "/tmp/old-creds.json" || cfg.CodexDisabled {
		t.Errorf("credentials/codex = %q/%v, want the old names honoured",
			cfg.ClaudeCredentialsPath, !cfg.CodexDisabled)
	}
}

// The namespaced name wins where several are set — an operator who has moved to it is not overruled
// by a line they left behind — and the middle spelling wins over the oldest for the same reason.
func TestTheNamespacedEnvironmentNamesWin(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_CLAUDE_MAX_TURNS", "9")
	t.Setenv("KIAO_WORKER_AGENT_MAX_TURNS", "7")
	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS", "2")
	t.Setenv("KIAO_WORKER_CLAUDE_BYPASS_ENABLED", "true")
	t.Setenv("KIAO_WORKER_AGENT_BYPASS_ENABLED", "true")
	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED", "false")
	t.Setenv("KIAO_WORKER_CODEX_IGNORE_USER_CONFIG", "false")
	t.Setenv("KIAO_WORKER_AGENT_CODEX_IGNORE_USER_CONFIG", "false")
	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_IGNORE_USER_CONFIG", "true")

	cfg := LoadConfig(core.LoadConfig())
	if cfg.MaxTurns != 2 || cfg.BypassEnabled || !cfg.CodexIgnoreUserConfig {
		t.Errorf("MaxTurns/BypassEnabled/CodexIgnoreUserConfig = %d/%v/%v, want the namespaced names to win",
			cfg.MaxTurns, cfg.BypassEnabled, cfg.CodexIgnoreUserConfig)
	}

	os.Unsetenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS")
	if got := LoadConfig(core.LoadConfig()).MaxTurns; got != 7 {
		t.Errorf("MaxTurns = %d, want the middle spelling to win over the oldest", got)
	}
}

// A namespaced name set to nothing wins too, on the settings whose empty value is what says "off".
// Falling back to the old name there would leave an operator no way to say it at all.
func TestAnEmptyNamespacedNameStillWins(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_CLAUDE_SETTING_SOURCES", "user,project")
	t.Setenv("KIAO_WORKER_AGENT_CLAUDE_SETTING_SOURCES", "user,project")
	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES", "")
	if got := LoadConfig(core.LoadConfig()).ClaudeSettingSources; got != "" {
		t.Errorf("ClaudeSettingSources = %q, want the empty namespaced value that omits the flag", got)
	}
}

// Muse is offered by default and vetoed by name, like every other agent — under the namespaced
// name or the `…_AGENT_MUSE_ENABLED` it had before the rename. It never had a flat `…_MUSE_*`
// spelling: there was no third agent before there was a namespace.
func TestMuseIsOfferedByDefault(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	if cfg := LoadConfig(core.LoadConfig()); cfg.MuseDisabled {
		t.Error("MuseDisabled must default to false: Muse is offered unless vetoed")
	}

	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED", "false")
	if cfg := LoadConfig(core.LoadConfig()); !cfg.MuseDisabled {
		t.Error("MuseDisabled must be true once vetoed")
	}

	os.Unsetenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED")
	t.Setenv("KIAO_WORKER_AGENT_MUSE_ENABLED", "false")
	if cfg := LoadConfig(core.LoadConfig()); !cfg.MuseDisabled {
		t.Error("MuseDisabled must be true once vetoed under the old name")
	}
}

// Validate names the variable the value actually came from. A message pointing at a name nobody set
// sends its reader to the wrong line of the env file.
func TestValidateNamesTheVariableTheValueCameFrom(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	cfg := Config{Config: &core.Config{RootPath: t.TempDir()}, MaxTurns: 0}

	t.Setenv("KIAO_WORKER_CLAUDE_MAX_TURNS", "0")
	if problems := cfg.Validate(); len(problems) != 1 ||
		!strings.Contains(problems[0], "KIAO_WORKER_CLAUDE_MAX_TURNS") {
		t.Errorf("problems = %v, want the oldest name where that is what is set", problems)
	}

	t.Setenv("KIAO_WORKER_AGENT_MAX_TURNS", "0")
	if problems := cfg.Validate(); len(problems) != 1 ||
		!strings.Contains(problems[0], "KIAO_WORKER_AGENT_MAX_TURNS") {
		t.Errorf("problems = %v, want the middle name where that is what is set", problems)
	}

	t.Setenv("KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS", "0")
	if problems := cfg.Validate(); len(problems) != 1 ||
		!strings.Contains(problems[0], "KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS") {
		t.Errorf("problems = %v, want the namespaced name where that is what is set", problems)
	}
}
