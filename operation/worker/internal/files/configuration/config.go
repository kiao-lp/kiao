package configuration

import (
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/files/actions"
	"strings"
	"time"
)

// Config combines shared deployment settings with document-store settings: git identity,
// link fixing, migrations and file actions.
type Config struct {
	// Config is the socle's share of the deployment: the store root, the state directory, the
	// port and who may call in. Embedded rather than copied, so cfg.RootPath reads the one value
	// the program loaded once and handed to both halves.
	*coreconfig.Config

	GitUserName  string // KIAO_GIT_USER_NAME
	GitUserEmail string // KIAO_GIT_USER_EMAIL

	LinkFixExtensions []string // KIAO_WORKER_LINK_FIX_EXTENSIONS
	LinkFixWorkers    int      // KIAO_WORKER_LINK_FIX_WORKERS, default DefaultLinkFixWorkers

	MigrationsPath      string // KIAO_WORKER_MIGRATIONS_PATH, one named base source
	MigrationsSources   string // KIAO_WORKER_MIGRATIONS_SOURCES, assembly manifest
	MigrationsEnabled   bool   // KIAO_WORKER_MIGRATIONS_ENABLED, default true
	MigrationsFailOnErr bool   // default true

	MigrationsTimeout time.Duration // per-script timeout, default 600s

	ActionsPath string // KIAO_WORKER_ACTIONS_PATH, the file-action manifest ("" disables)
}

// Validate checks the resolved configuration for problems that would otherwise surface as
// confusing runtime failures, and returns a human-readable list (empty when the config is
// sound). main logs each problem and exits, so a misconfigured deployment fails fast at startup.
func (c *Config) Validate() []string {
	// The socle checks what it owns — the data root, the state path, the auth mode — and this adds
	// what only this half can judge. One list, so a misconfigured deployment reads every problem at
	// once rather than one per restart.
	problems := c.Config.Validate()
	if c.MigrationsEnabled {
		if c.MigrationsTimeout <= 0 {
			problems = append(problems, "migration timeout must be positive")
		}
		if _, err := MigrationSources(c); err != nil {
			problems = append(problems, err.Error())
		}
	}

	// A configured but unreadable/malformed action manifest is reported here rather than
	// discovered at menu-build time, when the only symptom would be a silently missing menu entry.
	if strings.TrimSpace(c.ActionsPath) != "" {
		if _, err := actions.LoadActionCatalog(c.ActionsPath); err != nil {
			problems = append(problems, err.Error())
		}
	}
	return problems
}

// LoadConfig reads document-store settings from the environment using the shared deployment config.
func LoadConfig(shared *coreconfig.Config) *Config {
	extCSV := coreconfig.Getenv("KIAO_WORKER_LINK_FIX_EXTENSIONS",
		".md,.txt,.html,.htm,.csv,.json,.yaml,.yml,.adoc,.rst")
	var exts []string
	for _, e := range strings.Split(extCSV, ",") {
		if e = strings.TrimSpace(e); e != "" {
			exts = append(exts, e)
		}
	}

	return &Config{
		Config:              shared,
		GitUserName:         coreconfig.Getenv("KIAO_GIT_USER_NAME", "Kiao Dashboard"),
		GitUserEmail:        coreconfig.Getenv("KIAO_GIT_USER_EMAIL", "dashboard@localhost"),
		LinkFixExtensions:   exts,
		LinkFixWorkers:      coreconfig.GetenvInt("KIAO_WORKER_LINK_FIX_WORKERS", DefaultLinkFixWorkers),
		MigrationsPath:      coreconfig.Getenv("KIAO_WORKER_MIGRATIONS_PATH", ""),
		MigrationsSources:   coreconfig.Getenv("KIAO_WORKER_MIGRATIONS_SOURCES", ""),
		MigrationsEnabled:   coreconfig.GetenvBool("KIAO_WORKER_MIGRATIONS_ENABLED", true),
		MigrationsFailOnErr: coreconfig.GetenvBool("KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR", true),
		MigrationsTimeout:   time.Duration(coreconfig.GetenvInt("KIAO_WORKER_MIGRATIONS_TIMEOUT_SECONDS", 600)) * time.Second,
		ActionsPath:         coreconfig.Getenv("KIAO_WORKER_ACTIONS_PATH", ""),
	}
}
