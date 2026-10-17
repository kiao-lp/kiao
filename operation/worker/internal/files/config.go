package files

import (
	"strings"
	"time"

	"kiao/worker/internal/core"
)

// Config is what the file half reads: the socle's share of the deployment, embedded, plus the
// settings that belong to the store — git identity, link fixing, migrations, actions. The variable
// names mirror the ones used by the original Spring Boot service (kiao-worker.env) so the
// same systemd env file drives both implementations.
type Config struct {
	// Config is the socle's share of the deployment: the store root, the state directory, the
	// port and who may call in. Embedded rather than copied, so cfg.RootPath reads the one value
	// the program loaded once and handed to both halves.
	*core.Config

	GitUserName  string // KIAO_GIT_USER_NAME
	GitUserEmail string // KIAO_GIT_USER_EMAIL

	LinkFixExtensions []string // kiao.worker.link-fix.scanned-extensions
	LinkFixWorkers    int      // KIAO_WORKER_LINK_FIX_WORKERS, default defaultLinkFixWorkers

	MigrationsPath      string // KIAO_WORKER_MIGRATIONS_PATH ("" disables)
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

	// A configured but unreadable/malformed action manifest is reported here rather than
	// discovered at menu-build time, when the only symptom would be a silently missing menu entry.
	if strings.TrimSpace(c.ActionsPath) != "" {
		if _, err := loadActionCatalog(c.ActionsPath); err != nil {
			problems = append(problems, err.Error())
		}
	}
	return problems
}

// LoadConfig reads this package's share of the configuration from the environment, on top of the
// socle's, applying the same defaults as application.properties in the Java service.
func LoadConfig(shared *core.Config) *Config {
	extCSV := core.Getenv("KIAO_WORKER_LINK_FIX_EXTENSIONS",
		".md,.txt,.html,.htm,.csv,.json,.yaml,.yml,.adoc,.rst")
	var exts []string
	for _, e := range strings.Split(extCSV, ",") {
		if e = strings.TrimSpace(e); e != "" {
			exts = append(exts, e)
		}
	}

	return &Config{
		Config:              shared,
		GitUserName:         core.Getenv("KIAO_GIT_USER_NAME", "Kiao Dashboard"),
		GitUserEmail:        core.Getenv("KIAO_GIT_USER_EMAIL", "dashboard@localhost"),
		LinkFixExtensions:   exts,
		LinkFixWorkers:      core.GetenvInt("KIAO_WORKER_LINK_FIX_WORKERS", defaultLinkFixWorkers),
		MigrationsPath:      core.Getenv("KIAO_WORKER_MIGRATIONS_PATH", ""),
		MigrationsEnabled:   core.GetenvBool("KIAO_WORKER_MIGRATIONS_ENABLED", true),
		MigrationsFailOnErr: core.GetenvBool("KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR", true),
		MigrationsTimeout:   600 * time.Second,
		ActionsPath:         core.Getenv("KIAO_WORKER_ACTIONS_PATH", ""),
	}
}
