package files

import (
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// .kiao-files declares content exclusions per folder, inherited by descendants.
// Sections bound startup migrations, link updates, and search/deletion-preview walks.
// Declarations may live in any directory, replacing the state-only migration-ignore file.

const kiaoFilesName = ".kiao-files"

// Patterns before a section apply to all passes; unknown sections are parsed but not consulted.
// Explicitly requested folders are still walked (see kiaoScopeAt).
const (
	concernMigration = "migration"
	concernRefactor  = "refactor"
	concernSearch    = "search"
)

// Seed active exclusions for dependencies, build output and tool state.
// rootKiaoDecl also uses them in memory when the store cannot be written.
const kiaoFilesDefaultBody = `# .kiao-files — what, in this folder and below, is not KIAO content.
#
# DCMS (Dashboard + worker) serves any folder, not only a document store: a source
# repository, an ordinary work folder, or a mix. This file is how a folder says which of its
# contents are machinery, so that the passes which walk the store on their own stay out of them:
#
#   - file-store migrations, run at startup
#   - link updates ("refactoring"), run after a rename or a delete
#   - search, and the scope a delete reports before it asks you to confirm
#
# The first two rewrite files nobody asked them to touch. The third only reads, and what it costs is
# time: a build tree, or a folder that is a network mount, is one nobody meant to search.
#
# It can be dropped in ANY directory and covers that directory and everything below it, so a
# repository living inside a store carries its own next to its .gitignore. A nested file adds to
# what its ancestors said; nothing can re-include what an ancestor excluded.
#
# Syntax (a small subset of .gitignore):
#   - one pattern per line; blank lines and lines starting with # are ignored
#   - a pattern containing a / is anchored at THIS file's folder:   build/generated
#   - a pattern without one matches at any depth:                   node_modules
#   - a trailing / is decoration:  vendor/  is the same rule as  vendor
#   - * matches within a single path segment; there is no ** and no negation (!)
#   - matching a directory covers everything under it
#   - a line of just / covers this whole folder
#
# Patterns written here apply to every pass. A section narrows the ones after it to one:
#
#   [migration]   only file-store migrations stay out
#   [refactor]    only link updates after a rename or a delete stay out
#   [search]      only search and the scope of a delete stay out
#
# A folder excluded here is still searched when it IS the folder searched, and deleting it still
# reports what it holds: an exclusion keeps a pass out of the folders nobody pointed it at.
#
# .git and the service's own state directory are always excluded and need no rule.

# Dependencies and build output — the directories that make a rename, a delete or a search take
# minutes.
node_modules
bower_components
vendor
build
dist
out
target
coverage
__pycache__

# Tool, editor and VCS state: .git, .idea, .venv, .gradle, .dart_tool, .next, …
.*
`

// Keep the pattern text alongside its matcher for startup logging.
type kiaoPattern struct {
	text string
	re   *regexp.Regexp // matched against a path relative to the declaring folder
}

// byConcern[""] applies to every pass; other keys are section names, including unknown ones.
type kiaoDecl struct {
	dir       string // absolute directory this declaration covers
	source    string // absolute path it was read from; empty for the built-in defaults
	byConcern map[string][]kiaoPattern
}

// Patterns containing a slash are folder-relative; others match at any depth.
// Strip trailing slashes first; directory matches include all descendants.
func compileKiaoPattern(pattern string) (kiaoPattern, bool) {
	text := strings.TrimSpace(pattern)
	p := text
	for strings.HasSuffix(p, "/") {
		p = p[:len(p)-1]
	}
	anchored := strings.Contains(p, "/")
	for strings.HasPrefix(p, "/") {
		p = p[1:]
	}
	if text == "" {
		return kiaoPattern{}, false
	}
	// A line of nothing but slashes names the folder itself: none of it is content.
	if p == "" {
		return kiaoPattern{text: text, re: regexp.MustCompile(`^`)}, true
	}
	var body strings.Builder
	for _, seg := range strings.Split(p, "/") {
		if body.Len() > 0 {
			body.WriteString("/")
		}
		for _, r := range seg {
			if r == '*' {
				body.WriteString(`[^/]*`) // * stops at a separator; there is no **
				continue
			}
			body.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	expr := "^"
	if !anchored {
		expr += `(?:.*/)?`
	}
	expr += body.String() + `(?:/.*)?$`
	re, err := regexp.Compile(expr)
	if err != nil {
		return kiaoPattern{}, false // unreachable: every metacharacter is quoted above
	}
	return kiaoPattern{text: text, re: re}, true
}

// parseKiaoFiles binds text to dir; source is empty for built-in defaults.
func parseKiaoFiles(text, dir, source string) *kiaoDecl {
	d := &kiaoDecl{dir: filepath.Clean(dir), source: source, byConcern: map[string][]kiaoPattern{}}
	section := ""
	for _, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			continue
		}
		if p, ok := compileKiaoPattern(line); ok {
			d.byConcern[section] = append(d.byConcern[section], p)
		}
	}
	return d
}

// excludes tests descendants only; the declaring folder itself and outside paths are exempt.
func (d *kiaoDecl) excludes(abs, concern string) bool {
	if d == nil || len(d.byConcern) == 0 {
		return false
	}
	rel, err := filepath.Rel(d.dir, filepath.Clean(abs))
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") {
		return false
	}
	for _, p := range d.byConcern[""] {
		if p.re.MatchString(rel) {
			return true
		}
	}
	for _, p := range d.byConcern[concern] {
		if p.re.MatchString(rel) {
			return true
		}
	}
	return false
}

// rules returns shared patterns followed by concern-specific patterns for logging.
func (d *kiaoDecl) rules(concern string) []string {
	if d == nil {
		return nil
	}
	out := make([]string, 0, len(d.byConcern[""])+len(d.byConcern[concern]))
	for _, p := range d.byConcern[""] {
		out = append(out, p.text)
	}
	if concern == "" {
		return out // the patterns that apply to every pass, listed once
	}
	for _, p := range d.byConcern[concern] {
		out = append(out, p.text)
	}
	return out
}

// kiaoScope combines ancestor declarations: exclusion by any one is sufficient.
// Nested declarations cannot re-include paths.
type kiaoScope struct {
	decls []*kiaoDecl
	aimed string // the folder this walk was aimed at, if any; see aimedAt
}

// with copies the slice so sibling scopes cannot share mutations through its backing array.
// The aimed folder's declaration is already filtered; adding it again would undo its exemption.
func (s kiaoScope) with(d *kiaoDecl) kiaoScope {
	if d == nil || (s.aimed != "" && d.dir == s.aimed) {
		return s
	}
	next := make([]*kiaoDecl, len(s.decls), len(s.decls)+1)
	copy(next, s.decls)
	return kiaoScope{decls: append(next, d), aimed: s.aimed}
}

func (s kiaoScope) excludes(abs, concern string) bool {
	for _, d := range s.decls {
		if d.excludes(abs, concern) {
			return true
		}
	}
	return false
}

// aimedAt drops patterns covering dir so an explicit request can traverse its contents.
// Exempting dir alone would still exclude its descendants. Other exclusion patterns remain active.
func (s kiaoScope) aimedAt(dir string) kiaoScope {
	out := kiaoScope{aimed: filepath.Clean(dir)}
	for _, d := range s.decls {
		if kept := d.without(dir); kept != nil {
			out.decls = append(out.decls, kept)
		}
	}
	return out
}

// without drops patterns covering abs, returning nil if none remain.
// Include the declaring folder itself so its `/` rule can also be removed.
func (d *kiaoDecl) without(abs string) *kiaoDecl {
	if d == nil {
		return nil
	}
	rel, err := filepath.Rel(d.dir, filepath.Clean(abs))
	if err != nil {
		return d
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return d // abs is outside this declaration, which therefore says nothing about it
	}
	if rel == "." {
		rel = "" // the declaring folder itself, which only a `/` rule matches
	}
	kept := &kiaoDecl{dir: d.dir, source: d.source, byConcern: map[string][]kiaoPattern{}}
	total := 0
	for concern, patterns := range d.byConcern {
		for _, p := range patterns {
			if p.re.MatchString(rel) {
				continue
			}
			kept.byConcern[concern] = append(kept.byConcern[concern], p)
			total++
		}
	}
	if total == 0 {
		return nil
	}
	return kept
}

// kiaoScopeAt loads declarations from root through dir, then exempts the requested dir.
// Reading ancestors ensures walks starting inside the store inherit their exclusions.
func kiaoScopeAt(root, dir string) kiaoScope {
	root, dir = filepath.Clean(root), filepath.Clean(dir)
	scope := rootKiaoScope(root)
	rel, err := filepath.Rel(root, dir)
	if err != nil {
		return scope.aimedAt(dir)
	}
	if rel = filepath.ToSlash(rel); rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
		at := root
		for _, seg := range strings.Split(rel, "/") {
			at = filepath.Join(at, seg)
			if d, ok := readKiaoDecl(at); ok {
				scope = scope.with(d)
			}
		}
	}
	return scope.aimedAt(dir)
}

// kiaoWalk tracks declarations during filepath.WalkDir's depth-first callbacks.
// Frames unwind by each path's parent, since files can follow a sibling directory's whole subtree.
// Dropping exited frames keeps memory bounded by nesting depth.
type kiaoWalk struct {
	concern string
	frames  []kiaoFrame
}

type kiaoFrame struct {
	dir   string
	scope kiaoScope
}

func newKiaoWalk(root, dir, concern string) *kiaoWalk {
	return &kiaoWalk{concern: concern, frames: []kiaoFrame{{dir: dir, scope: kiaoScopeAt(root, dir)}}}
}

// excludesDir adds each included directory's declaration to its children's scope.
func (w *kiaoWalk) excludesDir(dir string) bool {
	if dir == w.frames[0].dir {
		return false // the folder the walk was aimed at; its own declaration is already in scope
	}
	scope := w.at(filepath.Dir(dir))
	if scope.excludes(dir, w.concern) {
		return true
	}
	if d, ok := readKiaoDecl(dir); ok {
		w.frames = append(w.frames, kiaoFrame{dir: dir, scope: scope.with(d)})
	}
	return false
}

func (w *kiaoWalk) excludesFile(p string) bool {
	return w.at(filepath.Dir(p)).excludes(p, w.concern)
}

// at drops exited frames before returning dir's scope.
func (w *kiaoWalk) at(dir string) kiaoScope {
	for len(w.frames) > 1 && !withinDir(w.frames[len(w.frames)-1].dir, dir) {
		w.frames = w.frames[:len(w.frames)-1]
	}
	return w.frames[len(w.frames)-1].scope
}

func withinDir(dir, p string) bool {
	return p == dir || strings.HasPrefix(p, dir+string(filepath.Separator))
}

func readKiaoDecl(dir string) (*kiaoDecl, bool) {
	file := filepath.Join(dir, kiaoFilesName)
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, false
	}
	return parseKiaoFiles(string(data), dir, file), true
}

// A missing or unreadable declaration uses built-in defaults; an empty file excludes nothing.
func rootKiaoDecl(root string) *kiaoDecl {
	if d, ok := readKiaoDecl(root); ok {
		return d
	}
	return parseKiaoFiles(kiaoFilesDefaultBody, root, "")
}

func rootKiaoScope(root string) kiaoScope {
	return kiaoScope{}.with(rootKiaoDecl(root))
}

// Absorbed into [migration] when the root declaration is created.
const legacyMigrationIgnoreFile = "migration-ignore"

// EnsureStoreDeclaration preserves an existing .kiao-files; otherwise it seeds defaults
// and absorbs legacy migration-ignore patterns into [migration] before deleting that file.
// Write failures are nonfatal: rootKiaoDecl supplies defaults in memory.
func EnsureStoreDeclaration(cfg *Config) {
	file := filepath.Join(cfg.RootPath, kiaoFilesName)
	legacy := filepath.Join(cfg.StatePath, legacyMigrationIgnoreFile)
	legacyExists := fileExists(legacy)

	if fileExists(file) {
		if legacyExists {
			core.LogMain.Warn("a legacy migration-ignore sits beside a .kiao-files and is no longer read; "+
				"move any rule it still carries into the [migration] section and delete it",
				"legacy", legacy, "declaration", file)
		}
		return
	}

	body := kiaoFilesDefaultBody
	patterns := legacyIgnorePatterns(legacy)
	if len(patterns) > 0 {
		body += absorbedMigrationSection(legacy, patterns)
	}
	if err := core.WriteFileAtomic(file, []byte(body), 0o644); err != nil {
		core.LogMain.Warn("cannot write the store declaration; the built-in defaults are in force but "+
			"nothing can be edited until one exists", "path", file, "error", err)
		return
	}
	core.LogMain.Info("store declaration written", "path", file, "absorbed_rules", len(patterns))
	if !legacyExists {
		return
	}
	if err := os.Remove(legacy); err != nil {
		core.LogMain.Warn("the legacy migration-ignore was absorbed but could not be removed; it is no "+
			"longer read", "path", legacy, "error", err)
		return
	}
	core.LogMain.Info("legacy migration-ignore absorbed and removed", "path", legacy, "into", file)
}

// legacyIgnorePatterns returns active legacy rules, or nil for a missing or unreadable file.
func legacyIgnorePatterns(file string) []string {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") {
			out = append(out, line)
		}
	}
	return out
}

// Preserve legacy patterns and their origin in the generated [migration] section.
func absorbedMigrationSection(legacy string, patterns []string) string {
	var b strings.Builder
	b.WriteString("\n[migration]\n")
	b.WriteString("# Absorbed verbatim from " + legacy + " when this file was created.\n")
	b.WriteString("# They bounded file-store migrations only, so they are kept to that section.\n")
	for _, p := range patterns {
		b.WriteString(p + "\n")
	}
	return b.String()
}

// LogStoreDeclaration reports effective root exclusions per pass for startup diagnostics.
func LogStoreDeclaration(cfg *Config) {
	d := rootKiaoDecl(cfg.RootPath)
	source := d.source
	if source == "" {
		source = "(built-in defaults)"
	}
	core.LogMain.Info("store declaration in force",
		"source", source,
		"migration", strings.Join(d.rules(concernMigration), " "),
		"refactor", strings.Join(d.rules(concernRefactor), " "),
		"search", strings.Join(d.rules(concernSearch), " "))
}
