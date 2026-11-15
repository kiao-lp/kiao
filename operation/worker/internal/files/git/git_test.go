package git

import (
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/process"
	fileconfig "kiao/worker/internal/files/configuration"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestParseBranchLine(t *testing.T) {
	cases := []struct {
		name        string
		line        string // the text after the leading "## " has been stripped and trimmed
		wantBranch  string
		wantUpst    string
		wantHasUpst bool
		wantAhead   int
		wantBehind  int
	}{
		{"local only", "main", "main", "", false, 0, 0},
		{"with upstream, in sync", "main...origin/main", "main", "origin/main", true, 0, 0},
		{"ahead only", "main...origin/main [ahead 2]", "main", "origin/main", true, 2, 0},
		{"behind only", "main...origin/main [behind 3]", "main", "origin/main", true, 0, 3},
		{"ahead and behind", "feature/x...origin/feature/x [ahead 1, behind 4]", "feature/x", "origin/feature/x", true, 1, 4},
		{"no commits yet", "No commits yet on main", "main", "", false, 0, 0},
		{"detached head", "HEAD (no branch)", "HEAD (no branch)", "", false, 0, 0},
		{"gone upstream", "main...origin/main [gone]", "main", "origin/main", true, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var dto GitStatusDto
			parseBranchLine(c.line, &dto)
			if dto.Branch != c.wantBranch {
				t.Errorf("Branch = %q, want %q", dto.Branch, c.wantBranch)
			}
			if dto.Upstream != c.wantUpst {
				t.Errorf("Upstream = %q, want %q", dto.Upstream, c.wantUpst)
			}
			if dto.HasUpstream != c.wantHasUpst {
				t.Errorf("HasUpstream = %v, want %v", dto.HasUpstream, c.wantHasUpst)
			}
			if dto.Ahead != c.wantAhead {
				t.Errorf("Ahead = %d, want %d", dto.Ahead, c.wantAhead)
			}
			if dto.Behind != c.wantBehind {
				t.Errorf("Behind = %d, want %d", dto.Behind, c.wantBehind)
			}
		})
	}
}

func TestGitSafePath(t *testing.T) {
	g := &GitService{}
	base := "/repo"
	ok := []struct{ in, want string }{
		{"foo.md", "foo.md"},
		{"a/b.md", "a/b.md"},
		{"/leading.md", "leading.md"},                  // leading slash stripped
		{"nested/../inside.md", "nested/../inside.md"}, // stays inside -> allowed (raw, uncleaned)
		{"back\\slash.md", "back/slash.md"},            // backslashes normalized to forward slashes
	}
	for _, c := range ok {
		got, errRes := g.safePath(base, c.in)
		if errRes != nil {
			t.Errorf("safePath(%q) unexpected error: %s", c.in, errRes.Output)
			continue
		}
		if got != c.want {
			t.Errorf("safePath(%q) = %q, want %q", c.in, got, c.want)
		}
	}

	bad := []string{"", "   ", "../escape.md", "a/../../escape.md", ".."}
	for _, in := range bad {
		if _, errRes := g.safePath(base, in); errRes == nil {
			t.Errorf("safePath(%q): expected rejection, got none", in)
		}
	}
}

// newTestRepo creates an isolated git working tree with the developer's global/system git config
// neutralised, and returns a GitService rooted at it. Skipped in -short mode.
func newTestRepo(t *testing.T) (*GitService, string) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping git-backed test in -short mode")
	}
	// Neutralise the developer's global/system config and supply a commit identity via env so
	// setup commits succeed without touching ~/.gitconfig.
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_SYSTEM", os.DevNull)
	t.Setenv("GIT_AUTHOR_NAME", "Setup")
	t.Setenv("GIT_AUTHOR_EMAIL", "setup@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Setup")
	t.Setenv("GIT_COMMITTER_EMAIL", "setup@example.com")

	dir := t.TempDir()
	cfg := &fileconfig.Config{Config: &coreconfig.Config{RootPath: dir}, GitUserName: "Committer", GitUserEmail: "committer@example.com"}
	g := NewGitService(cfg)
	mustGit(t, dir, "init", "-b", "main")
	return g, dir
}

func mustGit(t *testing.T, dir string, args ...string) process.ProcResult {
	t.Helper()
	res := process.RunProc(append([]string{"git", "-c", "safe.directory=*"}, args...), dir, gitDefaultTimeout, nil)
	if !res.OK() {
		t.Fatalf("git %v failed (exit %d): %s", args, res.Exit, res.Combined())
	}
	return res
}

// fileByPath finds a status entry by its Path, failing the test if absent.
func fileByPath(t *testing.T, dto GitStatusDto, path string) GitFileDto {
	t.Helper()
	for _, f := range dto.Files {
		if f.Path == path {
			return f
		}
	}
	t.Fatalf("no status entry for %q in %+v", path, dto.Files)
	return GitFileDto{}
}

func TestGitStatusNonRepo(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping git-backed test in -short mode")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_SYSTEM", os.DevNull)
	// A plain temp dir with no repo above it.
	g := NewGitService(&fileconfig.Config{Config: &coreconfig.Config{RootPath: t.TempDir()}})
	dto := g.Status()
	if dto.Repo {
		t.Errorf("status of non-repo: Repo = true, want false")
	}
	if len(dto.Files) != 0 {
		t.Errorf("status of non-repo: Files = %+v, want empty", dto.Files)
	}
}

func TestGitStatusEmptyRepo(t *testing.T) {
	g, _ := newTestRepo(t)
	dto := g.Status()
	if !dto.Repo {
		t.Fatalf("fresh repo: Repo = false, want true")
	}
	if dto.Branch != "main" {
		t.Errorf("fresh repo: Branch = %q, want main (from 'No commits yet on main')", dto.Branch)
	}
	if len(dto.Files) != 0 {
		t.Errorf("fresh repo: Files = %+v, want empty", dto.Files)
	}
}

func TestGitStatusFileStates(t *testing.T) {
	g, dir := newTestRepo(t)

	// untracked
	mustWrite(t, filepath.Join(dir, "untracked.md"), "hi\n")
	u := fileByPath(t, g.Status(), "untracked.md")
	if !u.Untracked || u.Staged || !u.Unstaged || u.Index != "?" || u.Worktree != "?" {
		t.Errorf("untracked entry mismatch: %+v", u)
	}

	// staged new file: index "A", worktree " "
	res := g.Stage("untracked.md")
	if !res.Ok {
		t.Fatalf("stage failed: %s", res.Output)
	}
	s := fileByPath(t, g.Status(), "untracked.md")
	if !s.Staged || s.Unstaged || s.Untracked || s.Index != "A" || s.Worktree != " " {
		t.Errorf("staged-new entry mismatch: %+v", s)
	}

	// stage + modify the same file again: "AM" (staged and unstaged)
	mustWrite(t, filepath.Join(dir, "untracked.md"), "hi\nmore\n")
	am := fileByPath(t, g.Status(), "untracked.md")
	if !am.Staged || !am.Unstaged || am.Index != "A" || am.Worktree != "M" {
		t.Errorf("staged+modified entry mismatch: %+v", am)
	}

	// re-stage so index == worktree, then commit clears the working tree
	if res := g.Stage("untracked.md"); !res.Ok {
		t.Fatalf("re-stage failed: %s", res.Output)
	}
	res = g.Commit("initial", false)
	if !res.Ok {
		t.Fatalf("commit failed: %s", res.Output)
	}
	if files := g.Status().Files; len(files) != 0 {
		t.Errorf("after commit: Files = %+v, want empty", files)
	}

	// modify a committed file: index " ", worktree "M", unstaged only
	mustWrite(t, filepath.Join(dir, "untracked.md"), "hi\nmore\nevenmore\n")
	m := fileByPath(t, g.Status(), "untracked.md")
	if m.Staged || !m.Unstaged || m.Untracked || m.Index != " " || m.Worktree != "M" {
		t.Errorf("worktree-modified entry mismatch: %+v", m)
	}
}

func TestGitUnstage(t *testing.T) {
	g, dir := newTestRepo(t)
	mustWrite(t, filepath.Join(dir, "f.md"), "content\n")
	mustGit(t, dir, "add", "f.md")
	mustGit(t, dir, "-c", "user.name=S", "-c", "user.email=s@e.x", "commit", "-m", "base")

	mustWrite(t, filepath.Join(dir, "f.md"), "changed\n")
	if res := g.Stage("f.md"); !res.Ok {
		t.Fatalf("stage failed: %s", res.Output)
	}
	if s := fileByPath(t, g.Status(), "f.md"); !s.Staged {
		t.Fatalf("expected staged before unstage: %+v", s)
	}
	if res := g.Unstage("f.md"); !res.Ok {
		t.Fatalf("unstage failed: %s", res.Output)
	}
	after := fileByPath(t, g.Status(), "f.md")
	if after.Staged || !after.Unstaged {
		t.Errorf("after unstage: expected unstaged-only, got %+v", after)
	}
}

func TestGitStageBatch(t *testing.T) {
	g, dir := newTestRepo(t)
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		mustWrite(t, filepath.Join(dir, name), "content\n")
	}

	if res := g.StageBatch([]string{"a.md", "b.md", "c.md"}); !res.Ok {
		t.Fatalf("stageBatch failed: %s", res.Output)
	}
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		if f := fileByPath(t, g.Status(), name); !f.Staged || f.Index != "A" {
			t.Errorf("%s: expected staged-new, got %+v", name, f)
		}
	}

	if res := g.UnstageBatch([]string{"a.md", "c.md"}); !res.Ok {
		t.Fatalf("unstageBatch failed: %s", res.Output)
	}
	for _, name := range []string{"a.md", "c.md"} {
		if f := fileByPath(t, g.Status(), name); f.Staged {
			t.Errorf("%s: expected unstaged after unstageBatch, got %+v", name, f)
		}
	}
	if f := fileByPath(t, g.Status(), "b.md"); !f.Staged {
		t.Errorf("b.md: expected to stay staged, got %+v", f)
	}
}

// A path outside the repository rejects the whole batch, leaving nothing staged.
func TestGitStageBatchRejectsBadPath(t *testing.T) {
	g, dir := newTestRepo(t)
	mustWrite(t, filepath.Join(dir, "a.md"), "content\n")

	res := g.StageBatch([]string{"a.md", "../escape.md"})
	if res.Ok {
		t.Fatalf("stageBatch with a traversal path: Ok = true, want false")
	}
	if f := fileByPath(t, g.Status(), "a.md"); f.Staged {
		t.Errorf("a.md staged despite the rejected batch: %+v", f)
	}

	if res := g.StageBatch(nil); res.Ok {
		t.Errorf("stageBatch(nil): Ok = true, want false")
	}
}

func TestGitStageAllStagesEveryChange(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "tracked.md", "one\n", "c1")
	mustWrite(t, filepath.Join(dir, "tracked.md"), "two\n")
	mustWrite(t, filepath.Join(dir, "new.md"), "new\n")

	if res := g.StageAll(); !res.Ok {
		t.Fatalf("stageAll failed: %s", res.Output)
	}
	for _, name := range []string{"tracked.md", "new.md"} {
		if f := fileByPath(t, g.Status(), name); !f.Staged || f.Unstaged {
			t.Errorf("%s after stageAll: expected staged-only, got %+v", name, f)
		}
	}
}

func TestGitUnstageAllKeepsTheWorkTree(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "tracked.md", "one\n", "c1")
	mustWrite(t, filepath.Join(dir, "tracked.md"), "two\n")
	mustWrite(t, filepath.Join(dir, "new.md"), "new\n")
	if res := g.StageAll(); !res.Ok {
		t.Fatalf("setup stageAll failed: %s", res.Output)
	}

	if res := g.UnstageAll(); !res.Ok {
		t.Fatalf("unstageAll failed: %s", res.Output)
	}
	tracked := fileByPath(t, g.Status(), "tracked.md")
	if tracked.Staged || !tracked.Unstaged {
		t.Errorf("tracked.md after unstageAll: expected unstaged-only, got %+v", tracked)
	}
	fresh := fileByPath(t, g.Status(), "new.md")
	if !fresh.Untracked {
		t.Errorf("new.md after unstageAll: expected untracked, got %+v", fresh)
	}
	if got := mustRead(t, filepath.Join(dir, "tracked.md")); got != "two\n" {
		t.Errorf("tracked.md content = %q, want the working copy kept", got)
	}
}

func TestGitRevertAllDiscardsUnstagedAndKeepsStaged(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "tracked.md", "one\n", "c1")
	commitFile(t, dir, "staged.md", "base\n", "c2")
	// Staged content the revert must keep in both the index and the work tree.
	mustWrite(t, filepath.Join(dir, "staged.md"), "staged edit\n")
	mustGit(t, dir, "add", "staged.md")
	// Unstaged changes the revert must discard.
	mustWrite(t, filepath.Join(dir, "tracked.md"), "tampered\n")
	mustWrite(t, filepath.Join(dir, "junk.md"), "delete me\n")

	if res := g.RevertAll(); !res.Ok {
		t.Fatalf("revertAll failed: %s", res.Output)
	}
	if got := mustRead(t, filepath.Join(dir, "tracked.md")); got != "one\n" {
		t.Errorf("tracked.md = %q, want the committed content back", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "junk.md")); !os.IsNotExist(err) {
		t.Errorf("junk.md survived revertAll; stat err = %v", err)
	}
	kept := fileByPath(t, g.Status(), "staged.md")
	if !kept.Staged || kept.Unstaged {
		t.Errorf("staged.md after revertAll: expected staged-only, got %+v", kept)
	}
	if got := mustRead(t, filepath.Join(dir, "staged.md")); got != "staged edit\n" {
		t.Errorf("staged.md = %q, want the staged edit kept", got)
	}
	// A work tree with nothing unstaged left is a successful no-op, not an error.
	if res := g.RevertAll(); !res.Ok {
		t.Errorf("second revertAll failed: %s", res.Output)
	}
}

func TestGitRevertModifiedRestoresContent(t *testing.T) {
	g, dir := newTestRepo(t)
	mustWrite(t, filepath.Join(dir, "f.md"), "original\n")
	mustGit(t, dir, "add", "f.md")
	mustGit(t, dir, "-c", "user.name=S", "-c", "user.email=s@e.x", "commit", "-m", "base")

	mustWrite(t, filepath.Join(dir, "f.md"), "tampered\n")
	if res := g.Revert("f.md"); !res.Ok {
		t.Fatalf("revert failed: %s", res.Output)
	}
	if got := mustRead(t, filepath.Join(dir, "f.md")); got != "original\n" {
		t.Errorf("after revert: content = %q, want original", got)
	}
}

func TestGitRevertUntrackedDeletes(t *testing.T) {
	g, dir := newTestRepo(t)
	path := filepath.Join(dir, "junk.md")
	mustWrite(t, path, "delete me\n")

	res := g.Revert("junk.md")
	if !res.Ok {
		t.Fatalf("revert of untracked failed: %s", res.Output)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("revert of untracked should delete the file; stat err = %v", err)
	}
}

func TestGitRenameStatusReportsOldPath(t *testing.T) {
	g, dir := newTestRepo(t)
	mustWrite(t, filepath.Join(dir, "before.md"), "stable content that git can track as a rename\n")
	mustGit(t, dir, "add", "before.md")
	mustGit(t, dir, "-c", "user.name=S", "-c", "user.email=s@e.x", "commit", "-m", "base")

	mustGit(t, dir, "mv", "before.md", "after.md")

	entry := fileByPath(t, g.Status(), "after.md")
	if entry.Index != "R" {
		t.Errorf("rename: Index = %q, want R", entry.Index)
	}
	if entry.OldPath == nil || *entry.OldPath != "before.md" {
		t.Errorf("rename: OldPath = %v, want before.md", entry.OldPath)
	}
	if !entry.Staged {
		t.Errorf("rename via git mv should be staged: %+v", entry)
	}
}

func TestGitOriginalAndWorkingContent(t *testing.T) {
	g, dir := newTestRepo(t)
	mustWrite(t, filepath.Join(dir, "doc.md"), "committed\n")
	mustGit(t, dir, "add", "doc.md")
	mustGit(t, dir, "-c", "user.name=S", "-c", "user.email=s@e.x", "commit", "-m", "base")
	mustWrite(t, filepath.Join(dir, "doc.md"), "working copy\n")

	if got := g.OriginalContent("doc.md"); got != "committed\n" {
		t.Errorf("originalContent = %q, want committed", got)
	}
	if got := g.WorkingContent("doc.md"); got != "working copy\n" {
		t.Errorf("workingContent = %q, want working copy", got)
	}
	// Untracked / never-committed path: originalContent is empty.
	if got := g.OriginalContent("nope.md"); got != "" {
		t.Errorf("originalContent of unknown = %q, want empty", got)
	}
}

func TestGitSaveWorkingCreatesParents(t *testing.T) {
	g, dir := newTestRepo(t)
	res := g.SaveWorking("nested/deep/new.md", "fresh\n")
	if !res.Ok {
		t.Fatalf("saveWorking failed: %s", res.Output)
	}
	if got := mustRead(t, filepath.Join(dir, "nested", "deep", "new.md")); got != "fresh\n" {
		t.Errorf("saveWorking content = %q, want fresh", got)
	}
}

func TestGitRepoRoot(t *testing.T) {
	g, dir := newTestRepo(t)
	root := g.At("").repoRoot()
	if root == "" {
		t.Fatalf("repoRoot returned empty for a real repo")
	}
	// repoRoot should resolve to the same directory (symlinks aside) we initialised.
	if filepath.Base(root) != filepath.Base(dir) {
		t.Errorf("repoRoot base = %q, want %q", filepath.Base(root), filepath.Base(dir))
	}
}

// newNestedRepo builds a store repository holding a second one at "sub", which is what folder
// scoping exists for: the panel must manage the repository the browsed folder belongs to.
func newNestedRepo(t *testing.T) (*GitService, string) {
	t.Helper()
	g, dir := newTestRepo(t)
	commitFile(t, dir, "outer.md", "outer\n", "outer")
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatalf("mkdir sub: %v", err)
	}
	mustGit(t, sub, "init", "-b", "inner")
	commitFile(t, sub, "inner.md", "inner\n", "inner")
	return g, dir
}

func TestGitAtScopesToTheRepositoryTheFolderBelongsTo(t *testing.T) {
	g, dir := newNestedRepo(t)
	mustWrite(t, filepath.Join(dir, "outer.md"), "outer edited\n")
	mustWrite(t, filepath.Join(dir, "sub", "inner.md"), "inner edited\n")

	outer := g.At("").Status()
	if outer.Root != "" {
		t.Errorf("store scope Root = %q, want empty", outer.Root)
	}
	if outer.Branch != "main" {
		t.Errorf("store scope Branch = %q, want main", outer.Branch)
	}
	// The nested repository is opaque to the outer one: its edited file is never an outer path.
	fileByPath(t, outer, "outer.md")
	for _, f := range outer.Files {
		if f.Path == "inner.md" {
			t.Errorf("store scope reported the nested repository's file %q", f.Path)
		}
	}

	inner := g.At("sub").Status()
	if inner.Root != "sub" {
		t.Errorf("nested scope Root = %q, want \"sub\"", inner.Root)
	}
	if inner.Branch != "inner" {
		t.Errorf("nested scope Branch = %q, want inner", inner.Branch)
	}
	// Paths are relative to the answering repository, not to the store.
	fileByPath(t, inner, "inner.md")
}

func TestGitScopedActionsApplyInsideTheNestedRepository(t *testing.T) {
	g, dir := newNestedRepo(t)
	mustWrite(t, filepath.Join(dir, "sub", "inner.md"), "inner edited\n")

	scoped := g.At("sub")
	if res := scoped.Stage("inner.md"); !res.Ok {
		t.Fatalf("stage in nested repo failed: %s", res.Output)
	}
	if f := fileByPath(t, scoped.Status(), "inner.md"); !f.Staged {
		t.Errorf("inner.md not staged in the nested repository")
	}
	if got := scoped.OriginalContent("inner.md"); got != "inner\n" {
		t.Errorf("nested originalContent = %q, want %q", got, "inner\n")
	}
	if got := scoped.WorkingContent("inner.md"); got != "inner edited\n" {
		t.Errorf("nested workingContent = %q, want %q", got, "inner edited\n")
	}
	// The store repository saw none of it: "inner.md" is not one of its paths at all.
	for _, f := range g.At("").Status().Files {
		if f.Path == "inner.md" {
			t.Errorf("staging in the nested repository leaked into the store repository")
		}
	}
}

func TestGitAtFallsBackWhenTheFolderIsNotUsable(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	cases := map[string]string{
		"a folder that no longer exists": "gone/deeper",
		"a path that escapes the store":  "../../elsewhere",
		"a file rather than a folder":    "doc.md",
	}
	for name, folder := range cases {
		t.Run(name, func(t *testing.T) {
			dto := g.At(folder).Status()
			if !dto.Repo || dto.Root != "" {
				t.Errorf("at(%q) = {Repo:%v, Root:%q}, want the store repository", folder, dto.Repo, dto.Root)
			}
		})
	}
}

// withRemoteBranches gives the repository a real remote holding "main" — which is local too — and
// "only-there", which is not, plus the symbolic `origin/HEAD` a clone brings along.
func withRemoteBranches(t *testing.T, dir string) {
	t.Helper()
	remote := t.TempDir()
	mustGit(t, remote, "init", "--bare", "-b", "main", ".")
	mustGit(t, dir, "remote", "add", "origin", remote)
	mustGit(t, dir, "push", "-u", "origin", "main")
	mustGit(t, dir, "push", "origin", "main:only-there")
	mustGit(t, dir, "fetch", "origin")
	mustGit(t, dir, "remote", "set-head", "origin", "main")
}

func TestGitBranchesListsLocalThenRemoteOnly(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	mustGit(t, dir, "branch", "feature/x")
	withRemoteBranches(t, dir)

	dto := g.At("").Branches()
	if dto.Current != "main" {
		t.Errorf("Current = %q, want main", dto.Current)
	}
	var got []string
	for _, b := range dto.Branches {
		got = append(got, b.Name)
	}
	want := []string{"feature/x", "main", "origin/only-there"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("branches = %v, want %v", got, want)
	}
	for _, b := range dto.Branches {
		if (b.Name == "main") != b.Current {
			t.Errorf("%q Current = %v", b.Name, b.Current)
		}
		if (b.Name == "origin/only-there") != b.Remote {
			t.Errorf("%q Remote = %v", b.Name, b.Remote)
		}
	}
}

func TestGitCheckoutSwitchesLocalAndTracksRemote(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	mustGit(t, dir, "branch", "feature/x")
	withRemoteBranches(t, dir)

	if res := g.At("").Checkout("feature/x"); !res.Ok {
		t.Fatalf("checkout of a local branch failed: %s", res.Output)
	}
	if got := g.At("").Status().Branch; got != "feature/x" {
		t.Errorf("branch after checkout = %q, want feature/x", got)
	}

	// A remote-only branch is taken with --track, which creates the local branch that follows it.
	if res := g.At("").Checkout("origin/only-there"); !res.Ok {
		t.Fatalf("checkout of a remote-only branch failed: %s", res.Output)
	}
	dto := g.At("").Status()
	if dto.Branch != "only-there" {
		t.Errorf("branch after tracking checkout = %q, want only-there", dto.Branch)
	}
	if !dto.HasUpstream || dto.Upstream != "origin/only-there" {
		t.Errorf("upstream after tracking checkout = %q (has=%v), want origin/only-there", dto.Upstream, dto.HasUpstream)
	}
}

func TestGitCheckoutRefusesWhatIsNotABranch(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	for _, name := range []string{"", "   ", "--orphan", "bad name", "no-such-branch"} {
		if res := g.At("").Checkout(name); res.Ok {
			t.Errorf("checkout(%q) succeeded, want refusal", name)
		}
	}
	if got := g.At("").Status().Branch; got != "main" {
		t.Errorf("branch after refused checkouts = %q, want main", got)
	}
}

func TestGitCreateBranchStartsAtHeadAndSwitchesToIt(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	head := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD").Stdout)

	if res := g.At("").CreateBranch("feature/y"); !res.Ok {
		t.Fatalf("createBranch failed: %s", res.Output)
	}
	if got := g.At("").Status().Branch; got != "feature/y" {
		t.Errorf("branch after create = %q, want feature/y", got)
	}
	if got := strings.TrimSpace(mustGit(t, dir, "rev-parse", "refs/heads/feature/y").Stdout); got != head {
		t.Errorf("feature/y points at %q, want HEAD %q", got, head)
	}
}

func TestGitCreateBranchRefusesTheInvalidAndTheTaken(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	for _, name := range []string{"", "   ", "--track", "bad name", "main"} {
		if res := g.At("").CreateBranch(name); res.Ok {
			t.Errorf("createBranch(%q) succeeded, want refusal", name)
		}
	}
	if got := g.At("").Status().Branch; got != "main" {
		t.Errorf("branch after refused creates = %q, want main", got)
	}
}

// commitFile writes a file and commits it, so a test can build a history worth squashing.
func commitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()
	mustWrite(t, filepath.Join(dir, name), content)
	mustGit(t, dir, "add", name)
	mustGit(t, dir, "-c", "user.name=S", "-c", "user.email=s@e.x", "commit", "-m", message)
}

func commitCount(t *testing.T, dir string) int {
	t.Helper()
	n, err := strconv.Atoi(strings.TrimSpace(mustGit(t, dir, "rev-list", "--count", "HEAD").Stdout))
	if err != nil {
		t.Fatalf("commit count: %v", err)
	}
	return n
}

func TestGitConsolidateSquashesHistoryAndKeepsWorkingState(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	commitFile(t, dir, "doc.md", "two\n", "c2")
	commitFile(t, dir, "doc.md", "three\n", "c3")
	dropped := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD~2").Stdout)

	// A dirty index and a dirty working tree must survive the rewrite untouched.
	mustWrite(t, filepath.Join(dir, "staged.md"), "staged\n")
	mustGit(t, dir, "add", "staged.md")
	mustWrite(t, filepath.Join(dir, "doc.md"), "edited\n")

	res := g.Consolidate("Consolidated", false)
	if !res.Ok {
		t.Fatalf("consolidate failed: %s", res.Output)
	}
	if n := commitCount(t, dir); n != 1 {
		t.Errorf("commit count = %d, want 1", n)
	}
	if subject := strings.TrimSpace(mustGit(t, dir, "log", "-1", "--format=%s").Stdout); subject != "Consolidated" {
		t.Errorf("root commit subject = %q, want Consolidated", subject)
	}
	// The tree is HEAD's former tree: the last committed content, not the working copy.
	if blob := mustGit(t, dir, "show", "HEAD:doc.md").Stdout; blob != "three\n" {
		t.Errorf("root commit content = %q, want three", blob)
	}
	// Dropped commits are gone from the object database, which is the point of the operation.
	if process.RunProc([]string{"git", "cat-file", "-e", dropped}, dir, gitDefaultTimeout, nil).OK() {
		t.Errorf("commit %s survived the prune", dropped)
	}
	staged := fileByPath(t, g.Status(), "staged.md")
	if !staged.Staged || staged.Index != "A" {
		t.Errorf("staged file lost its staging: %+v", staged)
	}
	doc := fileByPath(t, g.Status(), "doc.md")
	if !doc.Unstaged || doc.Worktree != "M" {
		t.Errorf("working-tree edit lost: %+v", doc)
	}
	if got := mustRead(t, filepath.Join(dir, "doc.md")); got != "edited\n" {
		t.Errorf("working file content = %q, want edited", got)
	}
}

func TestGitConsolidateSingleCommitIsANoOp(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	head := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD").Stdout)

	res := g.Consolidate("Consolidated", false)
	if !res.Ok {
		t.Fatalf("consolidate failed: %s", res.Output)
	}
	if now := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD").Stdout); now != head {
		t.Errorf("HEAD rewritten to %s, want the untouched %s", now, head)
	}
	if !strings.Contains(res.Output, "already a single commit") {
		t.Errorf("output does not say the history was left as is: %s", res.Output)
	}
}

func TestGitConsolidateRefusesUnbornAndDetachedHead(t *testing.T) {
	g, dir := newTestRepo(t)
	if res := g.Consolidate("", false); res.Ok || !strings.Contains(res.Output, "no commit yet") {
		t.Errorf("consolidate on an empty repo = %+v, want a refusal", res)
	}
	commitFile(t, dir, "doc.md", "one\n", "c1")
	commitFile(t, dir, "doc.md", "two\n", "c2")
	mustGit(t, dir, "checkout", "--detach", "HEAD")
	if res := g.Consolidate("", false); res.Ok || !strings.Contains(res.Output, "detached") {
		t.Errorf("consolidate on a detached HEAD = %+v, want a refusal", res)
	}
	if n := commitCount(t, dir); n != 2 {
		t.Errorf("refused consolidate still rewrote history: %d commits", n)
	}
}

func TestGitConsolidateReportsRefsStillHoldingHistory(t *testing.T) {
	g, dir := newTestRepo(t)
	commitFile(t, dir, "doc.md", "one\n", "c1")
	commitFile(t, dir, "doc.md", "two\n", "c2")
	mustGit(t, dir, "branch", "keepsake")

	res := g.Consolidate("Consolidated", false)
	if !res.Ok {
		t.Fatalf("consolidate failed: %s", res.Output)
	}
	if !strings.Contains(res.Output, "refs/heads/keepsake") {
		t.Errorf("output does not name the branch still holding history: %s", res.Output)
	}
	// That branch still resolves, so its commits were kept rather than pruned.
	if !process.RunProc([]string{"git", "rev-parse", "--verify", "keepsake^{commit}"}, dir, gitDefaultTimeout, nil).OK() {
		t.Errorf("keepsake branch lost its commits")
	}
}

func TestGitConsolidatePushesTheRewriteToTheUpstream(t *testing.T) {
	g, dir := newTestRepo(t)
	remote := t.TempDir()
	mustGit(t, remote, "init", "--bare", "-b", "main", ".")
	commitFile(t, dir, "doc.md", "one\n", "c1")
	commitFile(t, dir, "doc.md", "two\n", "c2")
	mustGit(t, dir, "remote", "add", "origin", remote)
	mustGit(t, dir, "push", "-u", "origin", "main")

	res := g.Consolidate("Consolidated", true)
	if !res.Ok {
		t.Fatalf("consolidate failed: %s", res.Output)
	}
	head := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD").Stdout)
	if remoteHead := strings.TrimSpace(mustGit(t, remote, "rev-parse", "main").Stdout); remoteHead != head {
		t.Errorf("remote main = %s, want the rewritten %s", remoteHead, head)
	}
	if tracking := strings.TrimSpace(mustGit(t, dir, "rev-parse", "origin/main").Stdout); tracking != head {
		t.Errorf("origin/main = %s, want the rewritten %s", tracking, head)
	}
	status := g.Status()
	if status.Ahead != 0 || status.Behind != 0 {
		t.Errorf("after the push: ahead %d behind %d, want a branch in sync", status.Ahead, status.Behind)
	}
}

func TestGitConsolidateKeepsHistoryWhenThePushFails(t *testing.T) {
	g, dir := newTestRepo(t)
	remote := t.TempDir()
	mustGit(t, remote, "init", "--bare", "-b", "main", ".")
	commitFile(t, dir, "doc.md", "one\n", "c1")
	commitFile(t, dir, "doc.md", "two\n", "c2")
	mustGit(t, dir, "remote", "add", "origin", remote)
	mustGit(t, dir, "push", "-u", "origin", "main")
	old := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD~1").Stdout)
	// Break the remote: the push fails, and nothing may be pruned after it.
	if err := os.RemoveAll(remote); err != nil {
		t.Fatal(err)
	}

	res := g.Consolidate("Consolidated", true)
	if res.Ok {
		t.Fatalf("consolidate reported success with an unreachable remote: %s", res.Output)
	}
	if !strings.Contains(res.Output, "ORIG_HEAD") {
		t.Errorf("output does not say how to undo the squash: %s", res.Output)
	}
	if !process.RunProc([]string{"git", "cat-file", "-e", old}, dir, gitDefaultTimeout, nil).OK() {
		t.Errorf("commit %s was pruned even though the push failed", old)
	}
}
