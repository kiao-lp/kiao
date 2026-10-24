package skills

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"kiao/skills"
	coreconfig "kiao/worker/internal/core/config"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const ClaudeBinaryName = "claude"

const skillMarkerName = ".kiao-skill"

const skillMarkerHeader = `# Installed by kiao (worker) from its skills catalogue,
# and rewritten whenever that source changes — an edit here is lost at the next start.
# The skill's real text is the source path below, in the assembly sources.
# Delete this file to keep your own edits: the skill is then left alone at every start.
`

// skillTarget identifies an installation directory and its log label.
type skillTarget struct {
	name string
	root string
}

func AgentsSkillTarget(root string) skillTarget {
	return skillTarget{name: ".agents/skills", root: root}
}

func claudeSkillTarget(root string) skillTarget {
	return skillTarget{name: ".claude/skills", root: root}
}

// renderManifest must not mutate source, which may alias the embedded bundle.
func renderManifest(sourcePath string, source []byte) []byte {
	return []byte(string(withShortDescription(source)) + installedManifestFooter(sourcePath))
}

// withShortDescription adds Codex catalogue metadata from the title subtitle.
// Existing metadata or unrecognized front matter is left untouched. Line-based
// editing avoids a YAML round-trip for the bundle's flat front matter.
func withShortDescription(source []byte) []byte {
	text := string(source)
	body, ok := strings.CutPrefix(text, "---\n")
	if !ok {
		return source
	}
	front, rest, ok := strings.Cut(body, "\n---\n")
	if !ok {
		return source
	}
	for _, line := range strings.Split(front, "\n") {
		if strings.HasPrefix(line, "metadata:") {
			return source
		}
	}
	short := titleSubtitle(rest)
	if short == "" {
		return source
	}
	return []byte("---\n" + front + "\nmetadata:\n  short-description: " + yamlString(short) + "\n---\n" + rest)
}

func titleSubtitle(body string) string {
	for _, line := range strings.Split(body, "\n") {
		title, ok := strings.CutPrefix(line, "# ")
		if !ok {
			continue
		}
		_, subtitle, ok := strings.Cut(title, " — ")
		if !ok {
			return ""
		}
		return strings.TrimSpace(subtitle)
	}
	return ""
}

// yamlString quotes subtitles so colons cannot turn them into YAML mappings.
func yamlString(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	return `"` + strings.ReplaceAll(escaped, `"`, `\"`) + `"`
}

// The installed copy may be the only skill source a turn can reach. Record its
// provenance without adding rendered instructions; edits belong in the master.
func installedManifestFooter(sourcePath string) string {
	return "\n<!-- Installed by kiao from the worker's skills catalogue, and\n" +
		"     rewritten at every start: an edit to this file is lost. The source is\n" +
		"     " + sourcePath + " in the assembly sources — change it there,\n" +
		"     then build, deliver and restart KIAO. -->\n"
}

// Startup and request goroutines can both sync skills. Serialize them because
// passes in the same process share staging names.
var skillSync sync.Mutex

// Skill installation failures must not prevent startup: the other DCMS features
// can still serve the store.
func SyncSkills(cfg *runnerconfig.Config) {
	skillSync.Lock()
	defer skillSync.Unlock()

	warnLegacySkillsPaths()
	additional := ""
	if cfg != nil {
		additional = cfg.SkillsPath
	}
	catalogue, err := skills.Load(additional)
	if err != nil {
		logSkills.Warn("cannot load the skills catalogue; keeping installed skills unchanged",
			"path", additional, "error", err)
		return
	}
	cleanLegacySkillHomes()
	// Read configuration once so both directories receive the same skills.
	wanted := storeSkills(cfg, catalogue)
	for _, target := range storeSkillTargets(cfg) {
		syncSkillsInto(target, wanted)
	}
}

// Install both project directories regardless of which CLIs are on PATH;
// each turn discovers skills through its CLI's own directory.
func storeSkillTargets(cfg *runnerconfig.Config) []skillTarget {
	root := StoreRootOf(cfg)
	if root == "" {
		logSkills.Warn("skills not installed (the store root is empty)")
		return nil
	}
	return []skillTarget{
		AgentsSkillTarget(StoreAgentsSkills(root)),
		claudeSkillTarget(StoreClaudeSkills(root)),
	}
}

func StoreAgentsSkills(root string) string {
	return filepath.Join(root, ".agents", "skills")
}

func StoreClaudeSkills(root string) string {
	return filepath.Join(root, ".claude", "skills")
}

func StoreRootOf(cfg *runnerconfig.Config) string {
	if cfg == nil || cfg.Config == nil {
		return ""
	}
	return strings.TrimSpace(cfg.RootPath)
}

// dashboardConfigDoc is shared with Dashboard's plugin configuration. Keep the
// name and plugin-array contract aligned without importing the files service.
const dashboardConfigDoc = "dashboard.json"

// storeSkills filters the complete catalogue by plugin; syncSkillsInto prunes excluded copies.
func storeSkills(cfg *runnerconfig.Config, catalogue []skills.Skill) []skills.Skill {
	enabled, chosen := enabledPlugins(cfg)
	if !chosen {
		return catalogue
	}
	var wanted []skills.Skill
	var left []string
	for _, skill := range catalogue {
		// Skills without a plugin apply to every store.
		if skill.Plugin == "" || enabled[skill.Plugin] {
			wanted = append(wanted, skill)
			continue
		}
		left = append(left, skill.Name+" ("+skill.Plugin+")")
	}
	if len(left) > 0 {
		logSkills.Info("skills left out of this store: the plugin each is the agent half of is "+
			"switched off here", "skills", left)
	}
	return wanted
}

// enabledPlugins matches Dashboard's normalizeConfig: missing, unreadable or
// invalid configuration, and absent/null plugins, enable everything. An empty
// array explicitly selects none. Failing open preserves turn instructions when
// the configuration cannot be read.
func enabledPlugins(cfg *runnerconfig.Config) (map[string]bool, bool) {
	path := dashboardConfigPath(cfg)
	if path == "" {
		return nil, false
	}
	content, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			logSkills.Warn("cannot read the Dashboard configuration; installing every available skill",
				"path", path, "error", err)
		}
		return nil, false
	}
	// A pointer distinguishes absent/null plugins from an explicitly empty list.
	var document struct {
		Plugins *[]string `json:"plugins"`
	}
	if err := json.Unmarshal(content, &document); err != nil || document.Plugins == nil {
		if err != nil {
			logSkills.Warn("cannot read the plugin list out of the Dashboard configuration; "+
				"installing every available skill", "path", path, "error", err)
		}
		return nil, false
	}
	enabled := make(map[string]bool, len(*document.Plugins))
	for _, id := range *document.Plugins {
		enabled[strings.TrimSpace(id)] = true
	}
	return enabled, true
}

// Configs with only a store root use the default state layout, matching where
// the skills are installed.
func dashboardConfigPath(cfg *runnerconfig.Config) string {
	if cfg == nil || cfg.Config == nil {
		return ""
	}
	if state := strings.TrimSpace(cfg.StatePath); state != "" {
		return filepath.Join(state, dashboardConfigDoc)
	}
	root := StoreRootOf(cfg)
	if root == "" {
		return ""
	}
	return filepath.Join(root, coreconfig.StateDirName, dashboardConfigDoc)
}

func warnLegacySkillsPaths() {
	for _, name := range []string{
		"KIAO_WORKER_AGENT_CLAUDE_SKILLS_PATH",
		"KIAO_WORKER_CLAUDE_SKILLS_PATH",
		"KIAO_WORKER_AGENT_CODEX_SKILLS_PATH",
		"KIAO_WORKER_AGENT_MUSE_SKILLS_PATH",
	} {
		if _, ok := os.LookupEnv(name); ok {
			logSkills.Warn("a skills path is set and no longer read; the bundled skills now live "+
				"in the store's .agents/skills and .claude/skills", "variable", name)
		}
	}
}

func cleanLegacySkillHomes() {
	home, _ := os.UserHomeDir()
	for _, legacy := range []struct{ agent, root string }{
		{"claude", defaultClaudeSkillsPath(home)},
		{"codex", defaultCodexSkillsPath(home)},
		{"muse", DefaultMuseSkillsPath(home)},
	} {
		cleanLegacySkillHome(legacy.agent, legacy.root)
	}
}

// cleanLegacySkillHome removes only marked, installer-owned legacy directories.
func cleanLegacySkillHome(agent, root string) {
	if strings.TrimSpace(root) == "" {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if !os.IsNotExist(err) {
			logSkills.Warn("cannot read the previous skills directory to clean it",
				"agent", agent, "path", root, "error", err)
		}
		return
	}
	var removed []string
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if _, err := ReadSkillMarker(filepath.Join(root, entry.Name())); err != nil {
			continue // not ours
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			logSkills.Warn("cannot remove a skill from the previous install",
				"agent", agent, "skill", entry.Name(), "error", err)
			continue
		}
		removed = append(removed, entry.Name())
	}
	sort.Strings(removed)
	if len(removed) > 0 {
		logSkills.Info("removed skills from the previous install; they now live in the store",
			"agent", agent, "path", root, "removed", removed)
	}
}

// Even an empty bundle must run the pass to prune previously installed skills.
func syncSkillsInto(target skillTarget, bundled []skills.Skill) {
	if err := os.MkdirAll(target.root, 0o755); err != nil {
		logSkills.Warn("cannot create the skills directory; skills not installed",
			"target", target.name, "path", target.root, "error", err)
		return
	}

	var installed, updated, repaired, unchanged, foreign, failed int
	names := make(map[string]bool, len(bundled))
	for _, skill := range bundled {
		names[skill.Name] = true
		switch outcome, err := InstallSkill(target, skill); {
		case err != nil:
			failed++
			logSkills.Warn("cannot install a skill", "target", target.name,
				"skill", skill.Name, "error", err)
		case outcome == skillInstalled:
			installed++
		case outcome == skillUpdated:
			updated++
		case outcome == skillRepaired:
			repaired++
			logSkills.Warn("an installed skill had been edited in place and was restored from this "+
				"source; edit it there instead", "target", target.name, "skill", skill.Name,
				"source", skill.Source,
				"path", filepath.Join(target.root, skill.Name))
		case outcome == skillUnchanged:
			unchanged++
		case outcome == skillForeign:
			foreign++
			logSkills.Warn("a skill of that name is already installed and was not written by KIAO; "+
				"leaving it alone", "target", target.name, "skill", skill.Name,
				"path", filepath.Join(target.root, skill.Name))
		}
	}

	removed := pruneSkills(target.root, names)

	logSkills.Info("skills installed", "target", target.name, "path", target.root,
		"installed", installed, "updated", updated, "repaired", repaired,
		"unchanged", unchanged, "kept", foreign, "removed", removed, "failed", failed)
}

type SkillOutcome int

const (
	skillInstalled SkillOutcome = iota
	skillUpdated
	skillRepaired
	skillUnchanged
	skillForeign
)

// Compare both digests: the source digest detects version changes; the installed
// tree digest detects local edits, which must be restored even on the same version.
func InstallSkill(into skillTarget, skill skills.Skill) (SkillOutcome, error) {
	target := filepath.Join(into.root, skill.Name)
	digest, err := skillDigest(skill)
	if err != nil {
		return 0, err
	}

	outcome := skillInstalled
	switch existing, err := os.Stat(target); {
	case err != nil && !os.IsNotExist(err):
		return 0, err
	case err == nil && !existing.IsDir():
		// An existing file is not installer-owned either.
		return skillForeign, nil
	case err == nil:
		marker, markerErr := ReadSkillMarker(target)
		if markerErr != nil {
			return skillForeign, nil
		}
		switch onDisk, diskErr := installedDigest(target); {
		case marker.bundled != digest || (marker.source != "" && marker.source != skill.Source):
			outcome = skillUpdated
		case diskErr == nil && onDisk == marker.installed && marker.source == skill.Source:
			return skillUnchanged, nil
		default:
			outcome = skillRepaired
		}
	}

	if err := writeSkill(into, target, skill, digest); err != nil {
		return 0, err
	}
	return outcome, nil
}

// Stage the complete tree before replacing the target so turns cannot read a
// partially written version. PID suffixes separate different processes' staging.
func writeSkill(into skillTarget, target string, skill skills.Skill, digest string) error {
	staging := filepath.Join(into.root, fmt.Sprintf(".%s.tmp-%d", skill.Name, os.Getpid()))
	if err := os.RemoveAll(staging); err != nil {
		return err
	}
	defer os.RemoveAll(staging)

	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	err := fs.WalkDir(skill.Files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || name == "." {
			return err
		}
		path := filepath.Join(staging, filepath.FromSlash(name))
		if entry.IsDir() {
			return os.MkdirAll(path, 0o755)
		}
		content, err := fs.ReadFile(skill.Files, name)
		if err != nil {
			return err
		}
		if name == skills.Manifest {
			// Rendering must not mutate the embedded bytes. Version digests use the source;
			// installed digests use the rendering.
			content = renderManifest(skill.Source, content)
		}
		return os.WriteFile(path, content, 0o644)
	})
	if err != nil {
		return err
	}
	// Exclude the marker: it records this digest and cannot be part of its input.
	written, err := installedDigest(staging)
	if err != nil {
		return err
	}
	marker := skillMarkerHeader +
		"skill=" + skill.Name + "\n" +
		"source=" + skill.Source + "\n" +
		"digest=" + digest + "\n" +
		"installed=" + written + "\n"
	if err := os.WriteFile(filepath.Join(staging, skillMarkerName), []byte(marker), 0o644); err != nil {
		return err
	}

	// Rename cannot replace a non-empty directory. Finish staging before removing
	// the target to minimize the gap before the rename.
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	return os.Rename(staging, target)
}

type skillMarker struct {
	source    string // master provenance, also compared when content is unchanged
	bundled   string // bundled source digest
	installed string // rendered tree digest
}

// An unreadable or invalid marker means the directory is not ours. Older markers
// without an installed digest trigger one rewrite.
func ReadSkillMarker(target string) (skillMarker, error) {
	content, err := os.ReadFile(filepath.Join(target, skillMarkerName))
	if err != nil {
		return skillMarker{}, err
	}
	var marker skillMarker
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if source, ok := strings.CutPrefix(line, "source="); ok {
			marker.source = source
		}
		if digest, ok := strings.CutPrefix(line, "digest="); ok {
			marker.bundled = digest
		}
		if digest, ok := strings.CutPrefix(line, "installed="); ok {
			marker.installed = digest
		}
	}
	if marker.bundled == "" {
		return skillMarker{}, fmt.Errorf("%s has no digest line", skillMarkerName)
	}
	return marker, nil
}

func skillDigest(skill skills.Skill) (string, error) {
	return digestTree(skill.Files, "")
}

// The marker stores the digest, so exclude it from the hashed tree.
func installedDigest(target string) (string, error) {
	return digestTree(os.DirFS(target), skillMarkerName)
}

// digestTree hashes names and content, excluding one top-level name.
func digestTree(tree fs.FS, skip string) (string, error) {
	sum := sha256.New()
	err := fs.WalkDir(tree, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || name == skip {
			return err
		}
		content, err := fs.ReadFile(tree, name)
		if err != nil {
			return err
		}
		// Length prefixes prevent ambiguous name/content concatenations.
		fmt.Fprintf(sum, "%d:%s:%d:", len(name), name, len(content))
		sum.Write(content)
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

// pruneSkills removes only marked directories absent from the selected bundle,
// including skills whose plugin was disabled.
func pruneSkills(root string, bundled map[string]bool) int {
	entries, err := os.ReadDir(root)
	if err != nil {
		logSkills.Warn("cannot read the skills directory to prune it", "path", root, "error", err)
		return 0
	}
	var stale []string
	for _, entry := range entries {
		if !entry.IsDir() || bundled[entry.Name()] {
			continue
		}
		// Staging directories may be marked but belong to an active writer.
		// Skill names cannot begin with a dot.
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if _, err := ReadSkillMarker(filepath.Join(root, entry.Name())); err != nil {
			continue // not ours
		}
		stale = append(stale, entry.Name())
	}
	sort.Strings(stale)

	removed := 0
	for _, name := range stale {
		if err := os.RemoveAll(filepath.Join(root, name)); err != nil {
			logSkills.Warn("cannot remove a skill this store is no longer to have",
				"skill", name, "error", err)
			continue
		}
		logSkills.Info("removed a skill this store is no longer to have", "skill", name)
		removed++
	}
	return removed
}

// An empty home must disable legacy cleanup rather than select a relative path.
func defaultClaudeSkillsPath(home string) string {
	if strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".claude", "skills")
}

// Legacy Codex skills follow CODEX_HOME when it is set.
func defaultCodexSkillsPath(home string) string {
	if codexHome := strings.TrimSpace(os.Getenv("CODEX_HOME")); codexHome != "" {
		return filepath.Join(codexHome, "skills")
	}
	if strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".codex", "skills")
}

// Legacy Muse skills follow XDG_CONFIG_HOME, falling back to ~/.config.
func DefaultMuseSkillsPath(home string) string {
	if configHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configHome != "" {
		return filepath.Join(configHome, "muse", "skills")
	}
	if strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".config", "muse", "skills")
}
