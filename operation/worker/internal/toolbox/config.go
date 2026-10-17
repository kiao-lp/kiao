package toolbox

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"kiao/worker/internal/core"
)

// Config adds toolbox installation and catalogue settings to the shared config.
type Config struct {
	*core.Config

	// Prefix bounds installs outside the state directory. Empty disables the panel
	// and refuses installs; deployments must explicitly choose an install location.
	Prefix string // KIAO_WORKER_TOOLBOX_PATH ("" disables)

	// CatalogDir supplies *.json files merged in name order after embedded pub.json.
	// Empty uses only the embedded catalogue.
	CatalogDir string // KIAO_WORKER_TOOLBOX_CATALOG_PATH ("" is the embedded catalogue)

	// Target overrides the release-channel libc platform for `worker toolbox preinstall`
	// (e.g. staging Alpine binaries on a glibc host). Empty uses this machine; it is
	// not read from the environment. Cross-architecture staging is unsupported because
	// archives must be unpacked and non-release recipes run on the host.
	Target string
}

func (c *Config) platform() string {
	if t := strings.TrimSpace(c.Target); t != "" {
		return t
	}
	return detectPlatform()
}

// Validate reports invalid configuration without resolving relative paths against
// a potentially unintended working directory.
func (c *Config) Validate() []string {
	var problems []string

	if p := strings.TrimSpace(c.Prefix); p != "" {
		if !filepath.IsAbs(p) {
			problems = append(problems, fmt.Sprintf(
				"KIAO_WORKER_TOOLBOX_PATH %q is not absolute", c.Prefix))
		} else if inside(c.StatePath, p) || inside(p, c.StatePath) {
			// State is replaced and swept at startup; overlap could delete toolbox installs.
			problems = append(problems, fmt.Sprintf(
				"KIAO_WORKER_TOOLBOX_PATH %q overlaps the state directory %q", c.Prefix, c.StatePath))
		}
	}

	if d := strings.TrimSpace(c.CatalogDir); d != "" && !filepath.IsAbs(d) {
		problems = append(problems, fmt.Sprintf(
			"KIAO_WORKER_TOOLBOX_CATALOG_PATH %q is not absolute", c.CatalogDir))
	}

	// Report catalogue errors at startup rather than on the first panel request.
	if _, err := LoadCatalog(c.CatalogDir); err != nil {
		problems = append(problems, err.Error())
	}

	return problems
}

// inside reports whether child is at or under parent; inputs must be absolute.
func inside(parent, child string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	if err != nil {
		return false
	}
	return rel == "." || !strings.HasPrefix(rel, "..")
}

func LoadConfig(shared *core.Config) *Config {
	return &Config{
		Config:     shared,
		Prefix:     core.GetenvPath("KIAO_WORKER_TOOLBOX_PATH", ""),
		CatalogDir: core.GetenvPath("KIAO_WORKER_TOOLBOX_CATALOG_PATH", ""),
	}
}

// Separate directories keep partial installs and uninstalls isolated.
func (c *Config) binDir() string        { return filepath.Join(c.Prefix, "bin") }
func (c *Config) uvDir() string         { return filepath.Join(c.Prefix, "uv") }
func (c *Config) npmDir() string        { return filepath.Join(c.Prefix, "npm") }
func (c *Config) npmBinDir() string     { return filepath.Join(c.Prefix, "npm", "bin") }
func (c *Config) npmModulesDir() string { return filepath.Join(c.Prefix, "npm", "lib", "node_modules") }
func (c *Config) nodeDir() string       { return filepath.Join(c.Prefix, "node") }
func (c *Config) javaDir() string       { return filepath.Join(c.Prefix, "java") }
func (c *Config) codexDir() string      { return filepath.Join(c.Prefix, "codex") }
func (c *Config) museDir() string       { return filepath.Join(c.Prefix, "muse") }
func (c *Config) opencodeDir() string   { return filepath.Join(c.Prefix, "opencode") }
func (c *Config) browsersDir() string   { return filepath.Join(c.Prefix, "browsers") }
func (c *Config) downloadDir() string   { return filepath.Join(c.Prefix, "download") }

// ${toolbox:…} resolves deployment paths in catalogue entries. Plain ${…} belongs
// to the Claude CLI environment expansion (e.g. tokens in headers, kept off disk).
// Unknown toolbox tokens survive unchanged in the generated configuration.
var toolboxToken = regexp.MustCompile(`\$\{toolbox:([a-z]+)\}`)

func (c *Config) toolboxPaths() map[string]string {
	return map[string]string{
		"prefix":   c.Prefix,
		"bin":      c.binDir(),
		"node":     c.nodeDir(),
		"browsers": c.browsersDir(),
	}
}

func (c *Config) expandTokens(value string) string {
	return toolboxToken.ReplaceAllStringFunc(value, func(match string) string {
		if path, ok := c.toolboxPaths()[toolboxToken.FindStringSubmatch(match)[1]]; ok {
			return path
		}
		return match
	})
}

// Keep ownership records outside the prefix so deleting it remains detectable as damage.
func (c *Config) ledgerPath() string { return filepath.Join(c.StatePath, "toolbox.json") }

// Create layout before a job, avoiding unused directories on deployments with no installs.
func (c *Config) ensureLayout() error {
	for _, dir := range []string{c.Prefix, c.binDir(), c.uvDir(), c.npmDir(), c.downloadDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("cannot create %s: %w", dir, err)
		}
	}
	return nil
}

// installEnv confines tool installs and caches to the prefix and puts its binaries
// first on PATH. core.RunProc merges this onto the inherited environment, retaining
// HOME, proxies and CA settings needed for downloads.
func (c *Config) installEnv() map[string]string {
	return map[string]string{
		"PATH": strings.Join([]string{
			c.binDir(), c.npmBinDir(), filepath.Join(c.nodeDir(), "bin"), filepath.Join(c.javaDir(), "bin"),
			os.Getenv("PATH"),
		}, string(os.PathListSeparator)),

		"UV_TOOL_DIR":           filepath.Join(c.uvDir(), "tools"),
		"UV_TOOL_BIN_DIR":       c.binDir(),
		"UV_PYTHON_INSTALL_DIR": filepath.Join(c.uvDir(), "python"),
		"UV_PYTHON_BIN_DIR":     c.binDir(),
		"UV_CACHE_DIR":          filepath.Join(c.uvDir(), "cache"),

		"npm_config_prefix":          c.npmDir(),
		"npm_config_cache":           filepath.Join(c.npmDir(), "cache"),
		"npm_config_update_notifier": "false",
		"npm_config_fund":            "false",
		"npm_config_audit":           "false",

		"PLAYWRIGHT_BROWSERS_PATH": c.browsersDir(),
	}
}
