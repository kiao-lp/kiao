package files

import (
	"fmt"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// GitService runs git commands against a directory of the store (a git working tree), mirroring
// kiao.worker.GitService. Commands are invoked with explicit argument lists — never a shell —
// so user-supplied paths and messages cannot inject commands.
//
// rootPath is the directory the commands run in, which `at` moves to the folder being browsed;
// storeRoot stays the store itself, so a repository can still be named relative to it.
type GitService struct {
	rootPath     string
	storeRoot    string
	gitUserName  string
	gitUserEmail string
}

const (
	gitDefaultTimeout = 60 * time.Second
	gitNetworkTimeout = 180 * time.Second
	// Repacking a large store is minutes of work, not seconds.
	gitMaintenanceTimeout = 15 * time.Minute
)

func newGitService(cfg *Config) *GitService {
	return &GitService{
		rootPath:     cfg.RootPath,
		storeRoot:    cfg.RootPath,
		gitUserName:  cfg.GitUserName,
		gitUserEmail: cfg.GitUserEmail,
	}
}

// at binds the service to the repository a folder of the store belongs to. The Git panel is scoped
// to the folder being browsed, so a store that holds repositories of its own manages the one the
// user is actually in rather than always the outermost. Every path the scoped service reports or
// accepts is relative to that repository's top level, which is why a caller must pass the same
// folder to the whole sequence of calls it makes.
//
// Both ways a folder can be unusable fall back to the store root, which is where every command ran
// before folders were taken into account: one that escapes the store is never let out of it, and one
// that no longer exists walks up to its nearest existing ancestor, since a working directory git
// cannot enter would fail every command with a message about the directory rather than about the
// repository.
func (g *GitService) at(folder string) *GitService {
	scoped := *g
	dir, err := core.ResolvePath(g.storeRoot, folder)
	if err != nil {
		return &scoped
	}
	root := filepath.Clean(g.storeRoot)
	for dir != root {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			break
		}
		dir = filepath.Dir(dir)
	}
	scoped.rootPath = dir
	return &scoped
}

var (
	branchTrackingRe = regexp.MustCompile(`\[(.+)\]\s*$`)
	aheadRe          = regexp.MustCompile(`ahead (\d+)`)
	behindRe         = regexp.MustCompile(`behind (\d+)`)
)

// status parses `git status --porcelain=v1 -z --branch`.
func (g *GitService) status() GitStatusDto {
	root := g.repoRoot()
	if root == "" {
		return GitStatusDto{Repo: false, Files: []GitFileDto{}}
	}

	res := g.run([]string{"status", "--porcelain=v1", "-z", "--branch"}, root, gitDefaultTimeout)
	if !res.OK() {
		logGit.Warn("git status failed", "output", res.Combined())
		return GitStatusDto{Repo: true, Root: g.repoLabel(root), Files: []GitFileDto{}}
	}

	dto := GitStatusDto{Repo: true, Root: g.repoLabel(root), Files: []GitFileDto{}}
	tokens := strings.Split(res.Stdout, "\x00")
	for i := 0; i < len(tokens); i++ {
		token := tokens[i]
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "##") {
			parseBranchLine(strings.TrimSpace(token[2:]), &dto)
			continue
		}
		if len(token) < 4 {
			continue
		}
		x := token[0:1]
		y := token[1:2]
		p := token[3:]

		var oldPath *string
		if x == "R" || x == "C" || y == "R" || y == "C" {
			if i+1 < len(tokens) {
				op := tokens[i+1]
				oldPath = &op
				i++
			}
		}

		untracked := x == "?" && y == "?"
		conflicted := x == "U" || y == "U" || (x == "A" && y == "A") || (x == "D" && y == "D")
		staged := !untracked && !conflicted && x != " " && x != "?"
		unstaged := untracked || conflicted || (y != " " && y != "?")

		dto.Files = append(dto.Files, GitFileDto{
			Path:       p,
			OldPath:    oldPath,
			Index:      x,
			Worktree:   y,
			Staged:     staged,
			Unstaged:   unstaged,
			Untracked:  untracked,
			Conflicted: conflicted,
		})
	}
	return dto
}

func (g *GitService) stage(path string) GitResultDto { return g.stageBatch([]string{path}) }

// stageBatch stages the whole list in a single `git add`, so a selection costs one git run.
func (g *GitService) stageBatch(paths []string) GitResultDto {
	root, safe, errRes := g.batchPaths(paths)
	if errRes != nil {
		return *errRes
	}
	return toResult(g.run(append([]string{"add", "--"}, safe...), root, gitDefaultTimeout))
}

// stageAll stages every change in the working tree. The file set is resolved by git itself
// (`add -A`), so the caller sends no paths — a tree-wide action costs one command whatever its size.
func (g *GitService) stageAll() GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	return toResult(g.run([]string{"add", "-A"}, root, gitDefaultTimeout))
}

func (g *GitService) unstage(path string) GitResultDto { return g.unstageBatch([]string{path}) }

// unstageBatch unstages the whole list in one command, with the same `reset` fallback as unstage.
func (g *GitService) unstageBatch(paths []string) GitResultDto {
	root, safe, errRes := g.batchPaths(paths)
	if errRes != nil {
		return *errRes
	}
	r := g.run(append([]string{"restore", "--staged", "--"}, safe...), root, gitDefaultTimeout)
	if !r.OK() {
		r = g.run(append([]string{"reset", "-q", "--"}, safe...), root, gitDefaultTimeout)
	}
	return toResult(r)
}

// unstageAll empties the index back to HEAD, leaving the working tree alone. Like unstageBatch
// it prefers `restore --staged` with a `reset` fallback, over the whole tree instead of a path list.
func (g *GitService) unstageAll() GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	r := g.run([]string{"restore", "--staged", "."}, root, gitDefaultTimeout)
	if !r.OK() {
		r = g.run([]string{"reset", "-q"}, root, gitDefaultTimeout)
	}
	return toResult(r)
}

// batchPaths resolves the repository root and validates every path up front: one bad path rejects
// the whole batch, so no half-applied staging can result from a malformed request.
func (g *GitService) batchPaths(paths []string) (string, []string, *GitResultDto) {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return "", nil, errRes
	}
	if len(paths) == 0 {
		return "", nil, &GitResultDto{Ok: false, Output: "Path is required"}
	}
	safe := make([]string, 0, len(paths))
	for _, path := range paths {
		p, errRes := g.safePath(root, path)
		if errRes != nil {
			return "", nil, errRes
		}
		safe = append(safe, p)
	}
	return root, safe, nil
}

// revert discards working-tree changes for a file (or deletes it when untracked).
func (g *GitService) revert(path string) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	p, errRes := g.safePath(root, path)
	if errRes != nil {
		return *errRes
	}
	restore := g.run([]string{"checkout", "--", p}, root, gitDefaultTimeout)
	if restore.OK() {
		return toResult(restore)
	}
	resolved, err := core.ResolvePath(root, p)
	if err != nil {
		return GitResultDto{Ok: false, Output: restore.Combined()}
	}
	rmErr := os.Remove(resolved)
	if rmErr != nil && !os.IsNotExist(rmErr) {
		return GitResultDto{Ok: false, Output: restore.Combined()}
	}
	if rmErr == nil {
		return GitResultDto{Ok: true, Output: "Removed " + p}
	}
	return GitResultDto{Ok: true, Output: restore.Combined()}
}

// revertAll discards every unstaged change: tracked files go back to their staged content and
// untracked files are deleted, exactly what reverting each changed file would do. The index is left
// alone — staged changes are unstaged, not discarded. A failed restore stops the operation before
// anything is deleted, so no half-discarded tree results.
func (g *GitService) revertAll() GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	restore := g.run([]string{"restore", "."}, root, gitDefaultTimeout)
	if !restore.OK() {
		restore = g.run([]string{"checkout", "--", "."}, root, gitDefaultTimeout)
	}
	if !restore.OK() {
		return toResult(restore)
	}
	clean := g.run([]string{"clean", "-fd"}, root, gitDefaultTimeout)
	if !clean.OK() {
		return toResult(clean)
	}
	return GitResultDto{Ok: true, Output: strings.TrimSpace(restore.Combined() + "\n" + clean.Combined())}
}

func (g *GitService) commit(message string, amend bool) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	args := []string{"-c", "user.name=" + g.gitUserName, "-c", "user.email=" + g.gitUserEmail, "commit"}
	noMessage := strings.TrimSpace(message) == ""
	if amend {
		args = append(args, "--amend")
		if noMessage {
			args = append(args, "--no-edit")
		} else {
			args = append(args, "-m", message)
		}
	} else {
		if noMessage {
			args = append(args, "-m", "")
		} else {
			args = append(args, "-m", message)
		}
	}
	return toResult(g.run(args, root, gitDefaultTimeout))
}

func (g *GitService) push() GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	upstream := g.run([]string{"rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"}, root, gitDefaultTimeout)
	var args []string
	if upstream.OK() {
		args = []string{"push"}
	} else {
		args = []string{"push", "-u", "origin", "HEAD"}
	}
	return toResult(g.run(args, root, gitNetworkTimeout))
}

func (g *GitService) pull() GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	return toResult(g.run([]string{"pull"}, root, gitNetworkTimeout))
}

// branches lists what the branch selector offers: every local branch, then every remote-tracking
// branch that has no local counterpart — checking one of those out is how a branch that so far
// only exists on the remote gets started here.
func (g *GitService) branches() GitBranchesDto {
	root := g.repoRoot()
	if root == "" {
		return GitBranchesDto{Branches: []GitBranchDto{}}
	}
	dto := GitBranchesDto{Branches: []GitBranchDto{}}
	dto.Current = strings.TrimSpace(g.run([]string{"symbolic-ref", "--quiet", "--short", "HEAD"}, root, gitDefaultTimeout).Stdout)

	local := map[string]bool{}
	for _, name := range g.refNames(root, "refs/heads/") {
		local[name] = true
		dto.Branches = append(dto.Branches, GitBranchDto{Name: name, Current: name == dto.Current})
	}
	for _, name := range g.refNames(root, "refs/remotes/") {
		// `origin/HEAD` is a symbolic alias for the remote's default branch rather than a branch of
		// its own, and checking it out would detach HEAD.
		if strings.HasSuffix(name, "/HEAD") {
			continue
		}
		if _, short, found := strings.Cut(name, "/"); found && local[short] {
			continue
		}
		dto.Branches = append(dto.Branches, GitBranchDto{Name: name, Remote: true})
	}
	return dto
}

// refNames lists what a ref namespace holds, sorted the way the selector shows it, each name with
// the namespace stripped. The stripping is done here rather than asked of `%(refname:short)`, which
// shortens `refs/remotes/origin/HEAD` all the way to `origin` and would hide that ref among the
// branches instead of alongside them.
func (g *GitService) refNames(root, namespace string) []string {
	r := g.run([]string{"for-each-ref", "--format=%(refname)", "--sort=refname", namespace}, root, gitDefaultTimeout)
	if !r.OK() {
		return nil
	}
	var names []string
	for _, line := range strings.Split(r.Stdout, "\n") {
		if name := strings.TrimPrefix(strings.TrimSpace(line), namespace); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// checkout switches the working tree to another branch; a remote-only one is taken with --track, so
// the local branch that follows it is created on the way. `switch` rather than `checkout`: it only
// ever takes a branch, so a name can never be read as a pathspec. Git refuses a switch that would
// drop uncommitted work, and that refusal is what the panel reports.
func (g *GitService) checkout(branch string) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	name, errRes := g.cleanBranchName(root, branch)
	if errRes != nil {
		return *errRes
	}
	if g.run([]string{"show-ref", "--verify", "--quiet", "refs/heads/" + name}, root, gitDefaultTimeout).OK() {
		return toResult(g.run([]string{"switch", "--", name}, root, gitDefaultTimeout))
	}
	if g.run([]string{"show-ref", "--verify", "--quiet", "refs/remotes/" + name}, root, gitDefaultTimeout).OK() {
		return toResult(g.run([]string{"switch", "--track", "--", name}, root, gitDefaultTimeout))
	}
	return GitResultDto{Ok: false, Output: "No such branch: " + name}
}

// createBranch starts a new branch at HEAD and switches to it, which is also how a detached HEAD
// is given a name again. `switch -c` takes no `--` — it reads the separator as the branch name
// and fails — so the option-like guard in cleanBranchName is what keeps a crafted name from
// reaching git as a flag. An already-taken name fails in git, and that failure is reported as-is.
func (g *GitService) createBranch(branch string) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	name, errRes := g.cleanBranchName(root, branch)
	if errRes != nil {
		return *errRes
	}
	return toResult(g.run([]string{"switch", "-c", name}, root, gitDefaultTimeout))
}

// cleanBranchName trims and validates a user-supplied branch name. A branch name is not a path,
// so safePath does not apply: refusing the option-like keeps a crafted name from reaching git as
// a flag, and check-ref-format rejects the rest.
func (g *GitService) cleanBranchName(root, branch string) (string, *GitResultDto) {
	name := strings.TrimSpace(branch)
	if name == "" || strings.HasPrefix(name, "-") ||
		!g.run([]string{"check-ref-format", "--branch", name}, root, gitDefaultTimeout).OK() {
		return "", &GitResultDto{Ok: false, Output: "Invalid branch name: " + branch}
	}
	return name, nil
}

// fetchAndStatus fetches without merging (best-effort), then returns the updated status.
func (g *GitService) fetchAndStatus() GitStatusDto {
	root := g.repoRoot()
	if root == "" {
		return GitStatusDto{Repo: false, Files: []GitFileDto{}}
	}
	g.run([]string{"fetch", "--quiet"}, root, gitNetworkTimeout)
	return g.status()
}

// originalContent returns the file content as of HEAD, or "" when new/untracked.
func (g *GitService) originalContent(path string) string {
	root := g.repoRoot()
	if root == "" {
		return ""
	}
	p, errRes := g.safePath(root, path)
	if errRes != nil {
		return ""
	}
	r := g.run([]string{"show", "HEAD:" + p}, root, gitDefaultTimeout)
	if r.OK() {
		return r.Stdout
	}
	return ""
}

// workingContent returns the current working-tree content of the file.
func (g *GitService) workingContent(path string) string {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return ""
	}
	p, errRes := g.safePath(root, path)
	if errRes != nil {
		return ""
	}
	resolved, err := core.ResolvePath(root, p)
	if err != nil {
		return ""
	}
	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		return ""
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return ""
	}
	return string(data)
}

// saveWorking overwrites the working-tree file, creating parent directories.
func (g *GitService) saveWorking(path, content string) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	p, errRes := g.safePath(root, path)
	if errRes != nil {
		return *errRes
	}
	resolved, err := core.ResolvePath(root, p)
	if err != nil {
		return GitResultDto{Ok: false, Output: "Save failed: " + err.Error()}
	}
	if parent := filepath.Dir(resolved); parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return GitResultDto{Ok: false, Output: "Save failed: " + err.Error()}
		}
	}
	if err := os.WriteFile(resolved, []byte(content), 0o644); err != nil {
		return GitResultDto{Ok: false, Output: "Save failed: " + err.Error()}
	}
	return GitResultDto{Ok: true, Output: "Saved " + path}
}

// ── internals ───────────────────────────────────────────────────────────────

func parseBranchLine(line string, dto *GitStatusDto) {
	working := line
	if strings.HasPrefix(working, "No commits yet on ") {
		dto.Branch = strings.TrimSpace(working[len("No commits yet on "):])
		return
	}
	var trackingPart string
	if m := branchTrackingRe.FindStringSubmatchIndex(working); m != nil {
		trackingPart = working[m[2]:m[3]]
		working = strings.TrimSpace(working[:m[0]])
	}
	if sep := strings.Index(working, "..."); sep >= 0 {
		dto.Branch = strings.TrimSpace(working[:sep])
		dto.Upstream = strings.TrimSpace(working[sep+3:])
		dto.HasUpstream = true
	} else {
		dto.Branch = strings.TrimSpace(working)
		dto.HasUpstream = false
	}
	if trackingPart != "" {
		if a := aheadRe.FindStringSubmatch(trackingPart); a != nil {
			dto.Ahead, _ = strconv.Atoi(a[1])
		}
		if b := behindRe.FindStringSubmatch(trackingPart); b != nil {
			dto.Behind, _ = strconv.Atoi(b[1])
		}
	}
}

// repoRoot returns the git top-level for the configured root, or "" when it is not a work tree.
func (g *GitService) repoRoot() string {
	r := g.run([]string{"rev-parse", "--show-toplevel"}, g.rootPath, gitDefaultTimeout)
	if !r.OK() {
		return ""
	}
	top := strings.TrimSpace(r.Stdout)
	return top
}

// repoLabel names the repository within the store: "" for the store's own repository, the
// store-relative path for one nested inside it. It is what lets the panel say which repository the
// folder it is scoped to belongs to, instead of leaving a changed file list unexplained. A
// repository that contains the store — the store checked out as a subdirectory of a larger tree —
// has no such path, and is reported as the store's own.
func (g *GitService) repoLabel(root string) string {
	store := filepath.Clean(g.storeRoot)
	// repoRoot comes back from git with symlinks resolved; the configured store root may not be,
	// and an unresolved pair would make every repository look nested.
	if resolved, err := filepath.EvalSymlinks(store); err == nil {
		store = resolved
	}
	rel, err := filepath.Rel(store, root)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return ""
	}
	return filepath.ToSlash(rel)
}

func (g *GitService) requireRepoRoot() (string, *GitResultDto) {
	r := g.repoRoot()
	if r == "" {
		return "", &GitResultDto{Ok: false, Output: "Not a git repository"}
	}
	return r, nil
}

// safePath rejects absolute paths and parent-directory traversal, returning a top-level-relative
// path.
func (g *GitService) safePath(base, path string) (string, *GitResultDto) {
	if strings.TrimSpace(path) == "" {
		return "", &GitResultDto{Ok: false, Output: "Path is required"}
	}
	p := strings.ReplaceAll(path, "\\", "/")
	for strings.HasPrefix(p, "/") {
		p = p[1:]
	}
	if _, err := core.ResolvePath(base, p); err != nil {
		return "", &GitResultDto{Ok: false, Output: "Path is outside the repository"}
	}
	if strings.HasPrefix(filepath.Clean(p), "..") {
		return "", &GitResultDto{Ok: false, Output: "Path is outside the repository"}
	}
	return p, nil
}

func toResult(r core.ProcResult) GitResultDto {
	return GitResultDto{Ok: r.OK(), Output: r.Combined()}
}

// run invokes git with safe.directory disabled-refusal, in workDir, with a timeout.
func (g *GitService) run(gitArgs []string, workDir string, timeout time.Duration) core.ProcResult {
	command := append([]string{"git", "-c", "safe.directory=*"}, gitArgs...)
	logGit.Info("git command", "args", strings.Join(gitArgs, " "), "cwd", workDir)
	return core.RunProc(command, workDir, timeout, nil)
}

// ── consolidate ─────────────────────────────────────────────────────────────

// consolidate frees the space a long history occupies: it rewrites the current branch as a single
// root commit carrying HEAD's tree, optionally force-pushes that rewrite to the upstream, then
// expires the reflogs and prunes every object no ref reaches any more. The index and the working
// tree are left alone — the new commit has HEAD's exact tree, so `git status` reads the same before
// and after. A requested push that fails stops the operation before any pruning, so the previous
// commits stay recoverable from the reflog.
func (g *GitService) consolidate(message string, pushRemote bool) GitResultDto {
	root, errRes := g.requireRepoRoot()
	if errRes != nil {
		return *errRes
	}
	branch := strings.TrimSpace(g.run([]string{"symbolic-ref", "--quiet", "--short", "HEAD"}, root, gitDefaultTimeout).Stdout)
	if branch == "" {
		return GitResultDto{Ok: false, Output: "HEAD is detached — check out a branch before consolidating."}
	}
	if !g.run([]string{"rev-parse", "--verify", "--quiet", "HEAD"}, root, gitDefaultTimeout).OK() {
		return GitResultDto{Ok: false, Output: "Nothing to consolidate: " + branch + " has no commit yet."}
	}

	sizeBefore := g.gitDirSize(root)
	report, errRes := g.squashToRoot(root, branch, message)
	if errRes != nil {
		return *errRes
	}

	if pushRemote {
		line, errRes := g.forcePush(root, branch)
		if errRes != nil {
			report = append(report, errRes.Output,
				"Nothing was pruned — the previous commits are still in the reflog, and `git reset --hard ORIG_HEAD` undoes the squash.")
			return GitResultDto{Ok: false, Output: strings.Join(report, "\n")}
		}
		report = append(report, line)
	}

	g.run([]string{"reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"}, root, gitMaintenanceTimeout)
	// cruftPacks off forces the explode-then-prune path, so unreachable objects are deleted rather
	// than parked in a cruft pack on the git versions that default it on.
	gc := g.run([]string{"-c", "gc.cruftPacks=false", "gc", "--prune=now"}, root, gitMaintenanceTimeout)
	if !gc.OK() {
		report = append(report, "Pruning failed:\n"+gc.Combined())
		return GitResultDto{Ok: false, Output: strings.Join(report, "\n")}
	}
	report = append(report, "Expired the reflogs and pruned every unreachable object.")

	sizeAfter := g.gitDirSize(root)
	freed := sizeBefore - sizeAfter
	if freed < 0 {
		freed = 0
	}
	report = append(report, fmt.Sprintf("Repository: %s → %s (freed %s).",
		humanBytes(sizeBefore), humanBytes(sizeAfter), humanBytes(freed)))
	if held := g.refsHoldingOtherHistory(root); held != "" {
		report = append(report, held)
	}
	return GitResultDto{Ok: true, Output: strings.Join(report, "\n")}
}

// squashToRoot replaces the branch tip with a fresh root commit holding HEAD's tree. It goes
// through commit-tree + `reset --soft` rather than a rebase, so it costs one write whatever the
// history length and leaves staged and unstaged changes exactly where they were.
func (g *GitService) squashToRoot(root, branch, message string) ([]string, *GitResultDto) {
	count := 0
	if c := g.run([]string{"rev-list", "--count", "HEAD"}, root, gitDefaultTimeout); c.OK() {
		count, _ = strconv.Atoi(strings.TrimSpace(c.Stdout))
	}
	if count <= 1 {
		return []string{branch + " was already a single commit — history left as it is."}, nil
	}
	tree := g.run([]string{"rev-parse", "HEAD^{tree}"}, root, gitDefaultTimeout)
	if !tree.OK() {
		return nil, &GitResultDto{Ok: false, Output: "Squash failed: " + tree.Combined()}
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		msg = "Consolidated history"
	}
	made := g.run([]string{"-c", "user.name=" + g.gitUserName, "-c", "user.email=" + g.gitUserEmail,
		"commit-tree", strings.TrimSpace(tree.Stdout), "-m", msg}, root, gitDefaultTimeout)
	if !made.OK() {
		return nil, &GitResultDto{Ok: false, Output: "Squash failed: " + made.Combined()}
	}
	newCommit := strings.TrimSpace(made.Stdout)
	if reset := g.run([]string{"reset", "--soft", newCommit}, root, gitDefaultTimeout); !reset.OK() {
		return nil, &GitResultDto{Ok: false, Output: "Squash failed: " + reset.Combined()}
	}
	return []string{fmt.Sprintf("Squashed %d commits of %s into the single root commit %s.",
		count, branch, shortSha(newCommit))}, nil
}

// forcePush publishes the rewritten branch to its upstream. `--force-with-lease` keeps the rewrite
// from overwriting anything the remote gained since the last fetch: the lease is the
// remote-tracking ref, which the squash did not move.
func (g *GitService) forcePush(root, branch string) (string, *GitResultDto) {
	remote := strings.TrimSpace(g.run([]string{"config", "--get", "branch." + branch + ".remote"}, root, gitDefaultTimeout).Stdout)
	mergeRef := strings.TrimSpace(g.run([]string{"config", "--get", "branch." + branch + ".merge"}, root, gitDefaultTimeout).Stdout)
	if remote == "" || mergeRef == "" {
		return branch + " has no upstream — nothing was pushed.", nil
	}
	r := g.run([]string{"push", "--force-with-lease", remote, "HEAD:" + mergeRef}, root, gitNetworkTimeout)
	if !r.OK() {
		return "", &GitResultDto{Ok: false, Output: "Force-push to " + remote + " failed:\n" + r.Combined()}
	}
	return "Force-pushed the rewritten history to " + remote + "/" + strings.TrimPrefix(mergeRef, "refs/heads/") + ".", nil
}

// refsHoldingOtherHistory names the refs that still reach something other than the new root commit
// — another branch, a tag, a remote-tracking ref that was not pushed. They are why a consolidation
// can free far less than expected, so the panel says so rather than leaving it a mystery.
func (g *GitService) refsHoldingOtherHistory(root string) string {
	head := strings.TrimSpace(g.run([]string{"rev-parse", "HEAD"}, root, gitDefaultTimeout).Stdout)
	r := g.run([]string{"for-each-ref", "--format=%(refname) %(objectname)"}, root, gitDefaultTimeout)
	if !r.OK() || head == "" {
		return ""
	}
	var others []string
	for _, line := range strings.Split(strings.TrimSpace(r.Stdout), "\n") {
		name, sha, found := strings.Cut(strings.TrimSpace(line), " ")
		if !found || sha == head {
			continue
		}
		others = append(others, name)
	}
	if len(others) == 0 {
		return ""
	}
	shown, extra := others, ""
	if len(shown) > 6 {
		shown = shown[:6]
		extra = fmt.Sprintf(" (+%d more)", len(others)-len(shown))
	}
	return "Older history is still reachable from " + strings.Join(shown, ", ") + extra +
		" — everything those refs hold was kept."
}

// gitDirSize sums the bytes under the repository's git directory, which is what a consolidation
// sets out to shrink.
func (g *GitService) gitDirSize(root string) int64 {
	dir := strings.TrimSpace(g.run([]string{"rev-parse", "--absolute-git-dir"}, root, gitDefaultTimeout).Stdout)
	if dir == "" {
		return 0
	}
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

func shortSha(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %sB", float64(n)/float64(div), []string{"K", "M", "G", "T"}[exp])
}
