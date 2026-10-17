package files

import (
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

// deletedSentinel replaces deleted paths (LinkFixService.DELETED_SENTINEL).
const deletedSentinel = "///deleted///"

// LinkFixer updates store-root references after rename or delete. Only paths with a leading
// slash qualify; bare paths and document-relative markdown links are left alone.
// RE2 lacks lookaround, so token boundaries are checked outside the regex.
type LinkFixer struct {
	storage    *core.Storage
	extensions []string
	workers    int
}

func newLinkFixer(storage *core.Storage, extensions []string) *LinkFixer {
	return newLinkFixerWithWorkers(storage, extensions, defaultLinkFixWorkers)
}

func newLinkFixerWithWorkers(storage *core.Storage, extensions []string, workers int) *LinkFixer {
	if workers < 1 {
		workers = 1
	}
	return &LinkFixer{storage: storage, extensions: extensions, workers: workers}
}

// Colon delimits scheme-carried paths such as unit::/units/abc. URLs remain untouched
// because their path has a non-boundary host byte before it.
const boundaryClass = `\s"'()\[\]{}<>,;|@:` + "`"

// Non-ASCII bytes are never boundaries, so paths adjacent to multibyte letters are rejected.
func isBoundaryByte(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r', '\f', '\v':
		return true
	case '"', '\'', '(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '|', '@', ':', '`':
		return true
	}
	return false
}

func stripLeadingSlash(p string) string {
	if strings.HasPrefix(p, "/") {
		return p[1:]
	}
	return p
}

// Matching accepts raw and percent-encoded spellings from any writer (mayBeEscapedInLink).
// Writing follows Dashboard's storedLinkOf encoding (escapedInStoredLink), preserving the
// matched spelling unless a new markdown destination requires escaping.

// escapedInStoredLink follows storedLinkOf: encodeURIComponent per segment, plus parentheses
// that would delimit markdown destinations. Slashes stay raw; non-ASCII bytes are escaped.
func escapedInStoredLink(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
		return false
	}
	switch b {
	case '-', '.', '_', '~', '!', '\'', '*', '/':
		return false
	}
	return true
}

// mayBeEscapedInLink accepts escapes for all bytes outside RFC 3986's unreserved set,
// except slash. This is deliberately broader than escapedInStoredLink.
func mayBeEscapedInLink(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
		return false
	}
	switch b {
	case '-', '.', '_', '~', '/':
		return false
	}
	return true
}

const hexDigits = "0123456789ABCDEF"

func percentEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		b.WriteByte('%')
		b.WriteByte(hexDigits[s[i]>>4])
		b.WriteByte(hexDigits[s[i]&0x0f])
	}
	return b.String()
}

func encodeLinkPath(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		if !escapedInStoredLink(p[i]) {
			b.WriteByte(p[i])
			continue
		}
		b.WriteString(percentEscape(p[i : i+1]))
	}
	return b.String()
}

// pathExpr matches raw or escaped runes, escaped form first so '%' cannot consume an escape
// as raw text. A rune is escaped whole, never partially.
func pathExpr(normalised string) string {
	var b strings.Builder
	for i := 0; i < len(normalised); {
		if !mayBeEscapedInLink(normalised[i]) {
			b.WriteString(regexp.QuoteMeta(normalised[i : i+1]))
			i++
			continue
		}
		_, size := utf8.DecodeRuneInString(normalised[i:])
		raw := normalised[i : i+size]
		// Only escape hex digits are case-insensitive.
		b.WriteString("(?:(?i:" + percentEscape(raw) + ")|" + regexp.QuoteMeta(raw) + ")")
		i += size
	}
	return b.String()
}

// buildPathPattern requires a leading slash and allows child suffixes.
// applyMatches checks token boundaries separately.
func buildPathPattern(virtualPath string) *regexp.Regexp {
	expr := "/" + pathExpr(stripLeadingSlash(virtualPath)) + "(?:/[^" + boundaryClass + "]*)?"
	return regexp.MustCompile(expr)
}

// The anchored head identifies the child suffix even when escaping changes the path length.
func buildPathHeadPattern(virtualPath string) *regexp.Regexp {
	return regexp.MustCompile("^" + pathExpr(stripLeadingSlash(virtualPath)))
}

// literalPrefix must use the same escape rule as pathExpr: every match must contain this
// needle, or the fast skip could discard files with matching encoded links.
func literalPrefix(normalised string) string {
	for i := 0; i < len(normalised); i++ {
		if mayBeEscapedInLink(normalised[i]) {
			return "/" + normalised[:i]
		}
	}
	return "/" + normalised
}

// Batch operations share one store scan rather than walking the tree once per path.
type linkFixOp struct {
	operation string // "RENAME" | "DELETE"
	oldPath   string
	newPath   string // empty on DELETE
	pattern   *regexp.Regexp
	needle    string
	replace   func(matched string, asDestination bool) string
}

func breaksADestination(p string) bool {
	return strings.ContainsAny(p, " \t\n\r\f\v()")
}

func renameOp(oldVirtualPath, newVirtualPath string) linkFixOp {
	normalised := stripLeadingSlash(oldVirtualPath)
	head := buildPathHeadPattern(oldVirtualPath)
	// Escaping depends on the new path; a previously raw destination may now need it.
	escapeDestination := breaksADestination(newVirtualPath)
	return linkFixOp{
		operation: "RENAME",
		oldPath:   oldVirtualPath,
		newPath:   newVirtualPath,
		pattern:   buildPathPattern(oldVirtualPath),
		needle:    literalPrefix(normalised),
		replace: func(matched string, asDestination bool) string {
			return renameReplacement(matched, normalised, head, newVirtualPath, asDestination && escapeDestination)
		},
	}
}

func deleteOp(deletedVirtualPath string) linkFixOp {
	return linkFixOp{
		operation: "DELETE",
		oldPath:   deletedVirtualPath,
		pattern:   buildPathPattern(deletedVirtualPath),
		needle:    literalPrefix(stripLeadingSlash(deletedVirtualPath)),
		replace:   func(string, bool) string { return deletedSentinel },
	}
}

func (op linkFixOp) report(changes []LinkFixFileChange) LinkFixReport {
	rep := LinkFixReport{
		Operation:    op.operation,
		OriginalPath: op.oldPath,
		FileChanges:  changes,
	}
	if op.operation == "RENAME" {
		newPath := op.newPath
		rep.NewPath = &newPath
	}
	return rep
}

func (lf *LinkFixer) fixAfterRename(oldVirtualPath, newVirtualPath string) (LinkFixReport, error) {
	return lf.fixOne(renameOp(oldVirtualPath, newVirtualPath))
}

func (lf *LinkFixer) fixAfterDelete(deletedVirtualPath string) (LinkFixReport, error) {
	return lf.fixOne(deleteOp(deletedVirtualPath))
}

func (lf *LinkFixer) fixOne(op linkFixOp) (LinkFixReport, error) {
	reports, err := lf.fixBatch([]linkFixOp{op})
	if err != nil {
		return LinkFixReport{}, err
	}
	return reports[0], nil
}

// Reads are latency-bound, especially on host bind mounts; workers deliberately exceed
// CPU count. Override with KIAO_WORKER_LINK_FIX_WORKERS.
const defaultLinkFixWorkers = 16

type linkFixFileResult struct {
	rel      string
	subsByOp [][]LinkFixSubstitution
}

// Counters are shared by file workers and must be atomic.
type linkFixStats struct {
	dirs        atomic.Int64 // directories visited
	dirsSkipped atomic.Int64 // directories skipped whole (dot-dirs, node_modules)
	files       atomic.Int64 // regular files seen
	candidates  atomic.Int64 // files with a scannable extension, i.e. files actually opened and read
	bytes       atomic.Int64 // bytes read from them
	matched     atomic.Int64 // files holding at least one of the batch's paths
	rewritten   atomic.Int64 // files written back
	unreadable  atomic.Int64 // files skipped as binary or unreadable
	decls       atomic.Int64 // nested .kiao-files declarations picked up along the way
}

const linkFixSlowPass = 3 * time.Second

func (s *linkFixStats) log(ops []linkFixOp, walk, total time.Duration) {
	first := ""
	if len(ops) > 0 {
		first = ops[0].oldPath
	}
	args := []any{
		"ops", len(ops),
		"first_path", first,
		"dirs", s.dirs.Load(),
		"dirs_skipped", s.dirsSkipped.Load(),
		"declarations", s.decls.Load(),
		"files", s.files.Load(),
		"read_files", s.candidates.Load(),
		"read_bytes", s.bytes.Load(),
		"unreadable", s.unreadable.Load(),
		"matched_files", s.matched.Load(),
		"rewritten", s.rewritten.Load(),
		"walk_ms", walk.Milliseconds(),
		"total_ms", total.Milliseconds(),
	}
	if total >= linkFixSlowPass {
		logLinkFix.Warn("slow link-fix pass", args...)
		return
	}
	logLinkFix.Info("link-fix pass", args...)
}

// fixBatch returns reports in op order. Each line sees ops sequentially, including prior output.
// Traversal is serial; file reads/rewrites run concurrently and results are sorted by path.
// Errors are logged/skipped, never returned: the rename/delete has already happened.
func (lf *LinkFixer) fixBatch(ops []linkFixOp) ([]LinkFixReport, error) {
	if len(ops) == 0 {
		return []LinkFixReport{}, nil
	}

	root := filepath.Clean(lf.storage.Root)
	prefix := commonNeedlePrefix(ops)
	started := time.Now()
	var stats linkFixStats

	candidates := make(chan string, lf.workers)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var results []linkFixFileResult

	for w := 0; w < lf.workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range candidates {
				res, ok := lf.fixFile(path, ops, prefix, root, &stats)
				if !ok {
					continue
				}
				mu.Lock()
				results = append(results, res)
				mu.Unlock()
			}
		}()
	}

	// Root scope supplies defaults; collect applies nested .kiao-files declarations.
	stats.dirs.Add(1)
	lf.collect(root, root, rootKiaoScope(root), &stats, candidates)
	// Traversal duration excludes waiting for outstanding file work.
	walked := time.Since(started)
	close(candidates)
	wg.Wait()
	stats.log(ops, walked, time.Since(started))

	sort.Slice(results, func(i, j int) bool { return results[i].rel < results[j].rel })

	changes := make([][]LinkFixFileChange, len(ops))
	for i := range changes {
		changes[i] = []LinkFixFileChange{}
	}
	for _, r := range results {
		for i, subs := range r.subsByOp {
			if len(subs) == 0 {
				continue
			}
			changes[i] = append(changes[i], LinkFixFileChange{FilePath: r.rel, Substitutions: subs})
		}
	}

	reports := make([]LinkFixReport, len(ops))
	for i, op := range ops {
		reports[i] = op.report(changes[i])
	}
	return reports, nil
}

// collect uses each directory listing to discover .kiao-files without extra stats.
// Declarations scope link updates; unreadable directories are skipped.
func (lf *LinkFixer) collect(dir, root string, scope kiaoScope, stats *linkFixStats, candidates chan<- string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	// Root defaults are already in scope; only nested declarations need loading.
	if dir != root {
		if d, ok := declAmong(entries, dir); ok {
			scope = scope.with(d)
			stats.decls.Add(1)
		}
	}
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		if e.IsDir() {
			// Never rewrite git or service state (including the migration ledger).
			// These exclusions cannot be overridden by .kiao-files.
			if e.Name() == core.GitDirName || lf.storage.IsStatePath(path) {
				stats.dirsSkipped.Add(1)
				continue
			}
			if scope.excludes(path, concernRefactor) {
				stats.dirsSkipped.Add(1)
				continue
			}
			stats.dirs.Add(1)
			lf.collect(path, root, scope, stats, candidates)
			continue
		}
		if !e.Type().IsRegular() {
			continue
		}
		stats.files.Add(1)
		if !lf.isScannable(path) {
			continue
		}
		if scope.excludes(path, concernRefactor) {
			continue
		}
		stats.candidates.Add(1)
		candidates <- path
	}
}

func declAmong(entries []os.DirEntry, dir string) (*kiaoDecl, bool) {
	for _, e := range entries {
		if e.Name() == kiaoFilesName && !e.IsDir() {
			return readKiaoDecl(dir)
		}
	}
	return nil, false
}

// fixFile returns false for unchanged or unwritable files.
// Concurrent calls are safe: compiled regexes are shared safely and replace functions are pure.
func (lf *LinkFixer) fixFile(path string, ops []linkFixOp, prefix, root string, stats *linkFixStats) (linkFixFileResult, bool) {
	data, ok := readFileText(path)
	if !ok {
		stats.unreadable.Add(1)
		return linkFixFileResult{}, false
	}
	stats.bytes.Add(int64(len(data)))
	// With no initial needle, no op can run or introduce a later match.
	// Skip before splitting lines and running regexes.
	if !anyNeedleIn(ops, prefix, data) {
		return linkFixFileResult{}, false
	}
	stats.matched.Add(1)

	lines := splitTextLines(data)
	subsByOp := make([][]LinkFixSubstitution, len(ops))
	touched := false
	for i, line := range lines {
		for o := range ops {
			// Recheck against prior ops' output, which may introduce a match.
			if !strings.Contains(line, ops[o].needle) {
				continue
			}
			newLine, lineSubs := applyMatches(line, ops[o].pattern, ops[o].replace)
			if len(lineSubs) == 0 {
				continue
			}
			line = newLine
			touched = true
			for _, s := range lineSubs {
				s.LineNumber = i + 1
				subsByOp[o] = append(subsByOp[o], s)
			}
		}
		lines[i] = line
	}
	if !touched {
		return linkFixFileResult{}, false
	}
	if err := writeLines(path, lines); err != nil {
		logLinkFix.Warn("failed to rewrite a file the link fix changed", "path", path, "error", err)
		return linkFixFileResult{}, false
	}
	stats.rewritten.Add(1)
	rel, relErr := filepath.Rel(root, path)
	if relErr != nil {
		rel = path
	}
	return linkFixFileResult{rel: filepath.ToSlash(rel), subsByOp: subsByOp}, true
}

// The common prefix lets sibling-path batches skip files with one substring search.
func anyNeedleIn(ops []linkFixOp, prefix, data string) bool {
	if prefix != "" && !strings.Contains(data, prefix) {
		return false
	}
	if len(ops) == 1 {
		return true // the prefix IS the only needle, and it is present
	}
	for _, op := range ops {
		if strings.Contains(data, op.needle) {
			return true
		}
	}
	return false
}

func commonNeedlePrefix(ops []linkFixOp) string {
	if len(ops) == 0 {
		return ""
	}
	prefix := ops[0].needle
	for _, op := range ops[1:] {
		n := op.needle
		if len(n) < len(prefix) {
			prefix = prefix[:len(n)]
		}
		for i := 0; i < len(prefix); i++ {
			if prefix[i] != n[i] {
				prefix = prefix[:i]
				break
			}
		}
		if prefix == "" {
			return ""
		}
	}
	return prefix
}

func (lf *LinkFixer) isScannable(path string) bool {
	name := strings.ToLower(filepath.Base(path))
	for _, ext := range lf.extensions {
		if strings.HasSuffix(name, strings.ToLower(ext)) {
			return true
		}
	}
	return false
}

// Detect inline markdown destinations, including schemes such as ](unit::/units/...).
// Escaping is positional: spaces delimit markdown destinations but remain valid in JSON paths.
func isLinkDestination(line string, start int) bool {
	i := start - 1
	for i >= 0 && line[i] != '(' && line[i] != ')' && !isSpaceByte(line[i]) {
		i--
	}
	return i >= 1 && line[i] == '(' && line[i-1] == ']'
}

// ASCII whitespace cannot occur inside a multibyte rune.
func isSpaceByte(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r', '\f', '\v':
		return true
	}
	return false
}

// applyMatches checks both token boundaries; callers fill substitution line numbers.
func applyMatches(line string, pattern *regexp.Regexp, replace func(matched string, asDestination bool) string) (string, []LinkFixSubstitution) {
	idx := pattern.FindAllStringIndex(line, -1)
	if idx == nil {
		return line, nil
	}
	var b strings.Builder
	var subs []LinkFixSubstitution
	cursor := 0
	for _, m := range idx {
		start, end := m[0], m[1]
		leftOK := start == 0 || isBoundaryByte(line[start-1])
		rightOK := end == len(line) || isBoundaryByte(line[end])
		if !leftOK || !rightOK {
			continue
		}
		matched := line[start:end]
		replacement := replace(matched, isLinkDestination(line, start))
		b.WriteString(line[cursor:start])
		b.WriteString(replacement)
		cursor = end
		subs = append(subs, LinkFixSubstitution{OldValue: matched, NewValue: replacement})
	}
	if len(subs) == 0 {
		return line, nil
	}
	b.WriteString(line[cursor:])
	return b.String(), subs
}

// renameReplacement preserves the leading slash, child suffix and raw/escaped spelling.
// The anchored head finds the suffix despite encoding-dependent lengths. asDestination
// forces escaping when the new path cannot survive raw in a markdown destination.
func renameReplacement(matched, oldNormalised string, head *regexp.Regexp, newPath string, asDestination bool) string {
	body := stripLeadingSlash(matched)
	oldPart, suffix := body, ""
	if loc := head.FindStringIndex(body); loc != nil {
		oldPart, suffix = body[:loc[1]], body[loc[1]:]
	}
	replacement := stripLeadingSlash(newPath)
	if oldPart != oldNormalised || asDestination {
		replacement = encodeLinkPath(replacement)
	}
	return "/" + replacement + suffix
}

// readFileText rejects non-UTF-8/unreadable files, normalizes line endings and strips one
// trailing newline. Keeping it separate lets needle checks precede line splitting.
func readFileText(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	if !utf8.Valid(data) {
		return "", false
	}
	s := string(data)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.TrimSuffix(s, "\n"), true
}

func splitTextLines(s string) []string {
	return strings.Split(s, "\n")
}

// readLines strips line terminators, matching Files.readAllLines.
func readLines(path string) ([]string, bool) {
	s, ok := readFileText(path)
	if !ok {
		return nil, false
	}
	return splitTextLines(s), true
}

// writeLines appends a newline to every line (Files.write on Linux).
// Atomic replacement prevents readers from seeing truncated files and leaves whole files on failure.
func writeLines(path string, lines []string) error {
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(line)
		b.WriteString("\n")
	}
	// Preserve the existing mode; the fallback applies if the file disappeared during the pass.
	return core.WriteFileAtomic(path, []byte(b.String()), core.ExistingFileMode(path, 0o644))
}
