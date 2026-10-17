package hybridflowrunner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"kiao/worker/internal/core"
	"kiao/skills"
)

// bundleOf builds a skill the way the embedded one looks, without needing the real bundle.
func bundleOf(name string, files map[string]string) skills.Skill {
	tree := fstest.MapFS{}
	for path, content := range files {
		tree[path] = &fstest.MapFile{Data: []byte(content)}
	}
	return skills.Skill{Name: name, Files: tree}
}

// mustInstall installs a skill into the .agents target and fails the test on error, returning what
// it took. The rules the tests below are about — the marker, the two digests, the prune — are the
// two targets' shared half, so they are exercised through one of them; what is each directory's own
// is which CLI reads it, which no test here can observe.
func mustInstall(t *testing.T, root string, skill skills.Skill) skillOutcome {
	t.Helper()
	outcome, err := installSkill(agentsSkillTarget(root), skill)
	if err != nil {
		t.Fatalf("installSkill(%s): %v", skill.Name, err)
	}
	return outcome
}

// redirectHomes points the three legacy home derivations at a temporary directory, so that a test
// exercising syncSkills cleans a fixture and never the developer's own agent homes. Every test
// calling syncSkills calls this first: without it the cleanup half of the pass would remove the
// DCMS skills from the real ~/.claude/skills.
func redirectHomes(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	// os.UserHomeDir reads $HOME on unix; the Codex and Muse derivations prefer their own
	// variables, so those move too.
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	t.Setenv("CODEX_HOME", filepath.Join(home, "codex-home"))
	return home
}

func TestInstallSkillWritesTheTreeAndItsMarker(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("archdia", map[string]string{
		"SKILL.md":              "---\nname: archdia\n---\n",
		"references/format.md":  "the block format",
		".editorconfig":         "root = true",
		"scripts/positions.mjs": "export const x = 1",
	})

	if outcome := mustInstall(t, root, skill); outcome != skillInstalled {
		t.Fatalf("outcome = %v, want skillInstalled", outcome)
	}

	for path, want := range map[string]string{
		"SKILL.md":              "---\nname: archdia\n---\n",
		"references/format.md":  "the block format",
		".editorconfig":         "root = true",
		"scripts/positions.mjs": "export const x = 1",
	} {
		got := string(mustReadBytes(t, filepath.Join(root, "archdia", path)))
		if path == skills.Manifest {
			// The manifest is the one file that does not go out verbatim: it gains the short
			// description where the title carries one, and a footer saying where the text it came
			// from lives, since this copy is the one a session finds when it is asked to change
			// a skill, and editing it achieves nothing.
			if !strings.HasPrefix(got, want) {
				t.Errorf("%s = %q, want it to start with %q", path, got, want)
			}
			if !strings.Contains(got, "reference/kiao-skills/archdia/") {
				t.Errorf("%s does not name its source:\n%s", path, got)
			}
			continue
		}
		if got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
	if _, err := readSkillMarker(filepath.Join(root, "archdia")); err != nil {
		t.Errorf("no readable marker after install: %v", err)
	}
	// The marker names the source, because the marker is what someone finds when they wonder why
	// their edit to the installed copy keeps disappearing.
	marker := string(mustReadBytes(t, filepath.Join(root, "archdia", skillMarkerName)))
	if !strings.Contains(marker, "source=reference/kiao-skills/archdia/") {
		t.Errorf("the marker does not name the source:\n%s", marker)
	}
	// Nothing is left behind beside the skill: the staging directory is the one thing a reader of
	// the skills directory would be puzzled by.
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "archdia" {
		t.Errorf("skills directory holds %v, want just the skill", entries)
	}
}

func TestInstallSkillIsUnchangedOnASecondRun(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("graph", map[string]string{"SKILL.md": "one"})

	mustInstall(t, root, skill)
	if outcome := mustInstall(t, root, skill); outcome != skillUnchanged {
		t.Fatalf("outcome = %v, want skillUnchanged", outcome)
	}
}

// The point of the digest: a build whose skill text moved on rewrites the directory, and a file the
// previous version had goes with it rather than lingering as a half-update.
func TestInstallSkillUpdatesWhenTheBundleChanges(t *testing.T) {
	root := t.TempDir()
	mustInstall(t, root, bundleOf("graph", map[string]string{
		"SKILL.md":        "the old text",
		"references/a.md": "dropped in the new version",
	}))

	outcome := mustInstall(t, root, bundleOf("graph", map[string]string{"SKILL.md": "the new text"}))
	if outcome != skillUpdated {
		t.Fatalf("outcome = %v, want skillUpdated", outcome)
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "graph", "SKILL.md"))); !strings.HasPrefix(got, "the new text") {
		t.Errorf("SKILL.md = %q, want it to start with the new text", got)
	}
	if _, err := os.Stat(filepath.Join(root, "graph", "references", "a.md")); !os.IsNotExist(err) {
		t.Errorf("the file the new version dropped is still there (%v)", err)
	}
}

// A skill directory nobody here wrote is somebody else's work — most plausibly a skill of the same
// name the user wrote themselves, since `graph` and `strategy` are names anyone might pick.
func TestInstallSkillLeavesAForeignDirectoryAlone(t *testing.T) {
	root := t.TempDir()
	theirs := filepath.Join(root, "graph")
	mustWriteBytes(t, filepath.Join(theirs, "SKILL.md"), []byte("the user's own graph skill"))

	if outcome := mustInstall(t, root, bundleOf("graph", map[string]string{"SKILL.md": "ours"})); outcome != skillForeign {
		t.Fatalf("outcome = %v, want skillForeign", outcome)
	}
	if got := string(mustReadBytes(t, filepath.Join(theirs, "SKILL.md"))); got != "the user's own graph skill" {
		t.Errorf("SKILL.md = %q; a skill we did not write must not be overwritten", got)
	}
}

// Deleting the marker is the documented way to adopt an installed skill, so it has to be the whole
// mechanism: after that, the directory is as foreign as one we never wrote.
func TestDeletingTheMarkerAdoptsTheSkill(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("graph", map[string]string{"SKILL.md": "ours"})
	mustInstall(t, root, skill)

	if err := os.Remove(filepath.Join(root, "graph", skillMarkerName)); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, filepath.Join(root, "graph", "SKILL.md"), []byte("edited by hand"))

	if outcome := mustInstall(t, root, bundleOf("graph", map[string]string{"SKILL.md": "a newer ours"})); outcome != skillForeign {
		t.Fatalf("outcome = %v, want skillForeign", outcome)
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "graph", "SKILL.md"))); got != "edited by hand" {
		t.Errorf("SKILL.md = %q, want the hand edit kept", got)
	}
}

func TestInstallSkillLeavesAFileOfThatNameAlone(t *testing.T) {
	root := t.TempDir()
	mustWriteBytes(t, filepath.Join(root, "graph"), []byte("not a directory at all"))

	if outcome := mustInstall(t, root, bundleOf("graph", map[string]string{"SKILL.md": "ours"})); outcome != skillForeign {
		t.Fatalf("outcome = %v, want skillForeign", outcome)
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "graph"))); got != "not a directory at all" {
		t.Errorf("the file was replaced: %q", got)
	}
}

// The promise stamped into every installed SKILL.md — that an edit made there is undone at the next
// start — has to hold on the far commoner case: the skill's text has not changed at all, so the
// version check alone would find nothing to do and leave the edit standing.
func TestInstallSkillUndoesAnEditMadeInPlace(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("graph", map[string]string{"SKILL.md": "the real instructions"})
	mustInstall(t, root, skill)

	manifest := filepath.Join(root, "graph", skills.Manifest)
	mustWriteBytes(t, manifest, []byte("edited in the installed copy"))

	if outcome := mustInstall(t, root, skill); outcome != skillRepaired {
		t.Fatalf("outcome = %v, want skillRepaired", outcome)
	}
	if got := string(mustReadBytes(t, manifest)); !strings.HasPrefix(got, "the real instructions") {
		t.Errorf("SKILL.md = %q, want the bundled text back", got)
	}
	// And the run after that has nothing left to do.
	if outcome := mustInstall(t, root, skill); outcome != skillUnchanged {
		t.Errorf("outcome = %v, want skillUnchanged once restored", outcome)
	}
}

// A file added to an installed skill is as much a divergence as an edited one.
func TestInstallSkillRemovesAFileAddedInPlace(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("graph", map[string]string{"SKILL.md": "ours"})
	mustInstall(t, root, skill)
	mustWriteBytes(t, filepath.Join(root, "graph", "notes.md"), []byte("scratch"))

	if outcome := mustInstall(t, root, skill); outcome != skillRepaired {
		t.Fatalf("outcome = %v, want skillRepaired", outcome)
	}
	if _, err := os.Stat(filepath.Join(root, "graph", "notes.md")); !os.IsNotExist(err) {
		t.Errorf("the added file survived (%v)", err)
	}
}

// A marker from a build that recorded no `installed` digest cannot answer the second question, so
// the skill is rewritten once and answers it from then on.
func TestAMarkerWithoutAnInstalledDigestIsRepairedOnce(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("graph", map[string]string{"SKILL.md": "ours"})
	mustInstall(t, root, skill)

	digest, err := skillDigest(skill)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, filepath.Join(root, "graph", skillMarkerName), []byte("digest="+digest+"\n"))

	if outcome := mustInstall(t, root, skill); outcome != skillRepaired {
		t.Fatalf("outcome = %v, want skillRepaired", outcome)
	}
	if outcome := mustInstall(t, root, skill); outcome != skillUnchanged {
		t.Errorf("outcome = %v, want skillUnchanged on the run after", outcome)
	}
}

// A marker we cannot read a digest out of is not proof of ownership, so it buys no write.
func TestAnUnreadableMarkerCountsAsForeign(t *testing.T) {
	root := t.TempDir()
	mustWriteBytes(t, filepath.Join(root, "graph", "SKILL.md"), []byte("theirs"))
	mustWriteBytes(t, filepath.Join(root, "graph", skillMarkerName), []byte("# no digest line here\n"))

	if outcome := mustInstall(t, root, bundleOf("graph", map[string]string{"SKILL.md": "ours"})); outcome != skillForeign {
		t.Fatalf("outcome = %v, want skillForeign", outcome)
	}
}

func TestSkillDigestChangesWithNamesAndContents(t *testing.T) {
	base, err := skillDigest(bundleOf("s", map[string]string{"SKILL.md": "a", "b.md": "c"}))
	if err != nil {
		t.Fatal(err)
	}
	same, err := skillDigest(bundleOf("s", map[string]string{"SKILL.md": "a", "b.md": "c"}))
	if err != nil {
		t.Fatal(err)
	}
	if base != same {
		t.Error("the same tree hashed to two different digests")
	}
	for name, other := range map[string]map[string]string{
		"a changed file":  {"SKILL.md": "a", "b.md": "different"},
		"a renamed file":  {"SKILL.md": "a", "renamed.md": "c"},
		"an extra file":   {"SKILL.md": "a", "b.md": "c", "extra.md": ""},
		"shifted content": {"SKILL.md": "ab", "b.md": ".c"},
	} {
		digest, err := skillDigest(bundleOf("s", other))
		if err != nil {
			t.Fatal(err)
		}
		if digest == base {
			t.Errorf("%s hashed the same as the original", name)
		}
	}
}

func TestPruneSkillsRemovesOnlyOurOwnStaleOnes(t *testing.T) {
	root := t.TempDir()
	mustInstall(t, root, bundleOf("kept", map[string]string{"SKILL.md": "still bundled"}))
	mustInstall(t, root, bundleOf("dropped", map[string]string{"SKILL.md": "renamed away"}))
	mustWriteBytes(t, filepath.Join(root, "theirs", "SKILL.md"), []byte("the user's own"))
	mustWriteBytes(t, filepath.Join(root, "loose.md"), []byte("not a skill"))
	// What another installer halfway through installing `kept` looks like from here: marked, and
	// not a bundled name. Deleting it would pull the tree out from under that installer's rename.
	mustWriteBytes(t, filepath.Join(root, ".kept.tmp-999", skillMarkerName), []byte("digest=abc\n"))

	if removed := pruneSkills(root, map[string]bool{"kept": true}); removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if _, err := os.Stat(filepath.Join(root, "dropped")); !os.IsNotExist(err) {
		t.Errorf("the stale skill is still there (%v)", err)
	}
	for _, survivor := range []string{"kept", "theirs", "loose.md", ".kept.tmp-999"} {
		if _, err := os.Stat(filepath.Join(root, survivor)); err != nil {
			t.Errorf("%s was removed and should not have been: %v", survivor, err)
		}
	}
}

// ── the one rendering ─────────────────────────────────────────────────────────

// The short description Codex's skills catalogue shows, taken from the subtitle of the document's
// own title. The rest of the front matter is the same two keys every CLI reads, and the body is
// the same bytes.
func TestRenderManifestAddsAShortDescription(t *testing.T) {
	source := []byte("---\nname: archdia\ndescription: a long list of trigger phrases\n---\n\n" +
		"# ArchDia — Architecture Diagrams with Free Positioning\n\nthe body\n")

	got := string(renderManifest("archdia", source))

	if !strings.Contains(got, "metadata:\n  short-description: \"Architecture Diagrams with Free Positioning\"\n") {
		t.Errorf("the short description was not added:\n%s", got)
	}
	if !strings.Contains(got, "description: a long list of trigger phrases") {
		t.Errorf("the description the dialects share was lost:\n%s", got)
	}
	if !strings.Contains(got, "\n\nthe body\n") {
		t.Errorf("the body was rewritten:\n%s", got)
	}
}

// Anything the line-based edit cannot make sense of is left exactly as it stands: a rewrite that
// guesses is worse than a skill without the one optional key.
func TestRenderManifestLeavesWhatItCannotReadAlone(t *testing.T) {
	unchanged := []string{
		"# No front matter at all\n",
		"---\nname: x\ndescription: y\n---\n\n# A title with no subtitle\n",
		"---\nname: x\nmetadata:\n  short-description: mine\n---\n\n# X — already said\n",
		"---\nname: x\ndescription: y\n",
	}
	for _, source := range unchanged {
		got := string(renderManifest("x", []byte(source)))
		// The footer is the installer's signature and always added; the source text must come
		// through it untouched.
		if !strings.HasPrefix(got, source) {
			t.Errorf("this was rewritten:\n%s\ninto:\n%s", source, got)
		}
		if strings.Count(got, "short-description:") > strings.Count(source, "short-description:") {
			t.Errorf("a short description was added where none could be read:\n%s", got)
		}
	}
}

// A subtitle carrying a colon has to stay one value rather than become a mapping.
func TestTheShortDescriptionIsQuoted(t *testing.T) {
	source := []byte("---\nname: x\n---\n\n# X — Notes: free-positioned\n")
	if got := string(withShortDescription(source)); !strings.Contains(got, `short-description: "Notes: free-positioned"`) {
		t.Errorf("an unquoted scalar:\n%s", got)
	}
}

// Both store directories carry the same bytes: the rendering is one, and the two installers agree
// on which version they hold.
func TestBothStoreDirectoriesCarryTheSameRendering(t *testing.T) {
	root := t.TempDir()
	skill := bundleOf("archdia", map[string]string{
		"SKILL.md": "---\nname: archdia\ndescription: trigger phrases\n---\n\n# ArchDia — Free Positioning\n",
	})
	if _, err := installSkill(agentsSkillTarget(filepath.Join(root, "agents")), skill); err != nil {
		t.Fatal(err)
	}
	if _, err := installSkill(claudeSkillTarget(filepath.Join(root, "claude")), skill); err != nil {
		t.Fatal(err)
	}
	agentsManifest := string(mustReadBytes(t, filepath.Join(root, "agents", "archdia", skills.Manifest)))
	claudeManifest := string(mustReadBytes(t, filepath.Join(root, "claude", "archdia", skills.Manifest)))
	if agentsManifest != claudeManifest {
		t.Errorf("the two copies differ:\n%s\n---\n%s", agentsManifest, claudeManifest)
	}
	if !strings.Contains(agentsManifest, "short-description:") {
		t.Errorf("neither copy carries the short description:\n%s", agentsManifest)
	}
}

// ── the whole pass ────────────────────────────────────────────────────────────

// The whole pass, over the skills this binary actually carries — the thing that has to work on the
// a server, under bin/local-start-kiao.sh, under the kiao executable and in the image.
func TestSyncSkillsInstallsTheBundleIntoTheStore(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	cfg := &Config{Config: &core.Config{RootPath: store}}

	syncSkills(cfg)

	bundled := skills.All()
	if len(bundled) == 0 {
		t.Fatal("this build carries no skills")
	}
	for _, dir := range []string{storeAgentsSkills(store), storeClaudeSkills(store)} {
		for _, skill := range bundled {
			manifest := filepath.Join(dir, skill.Name, skills.Manifest)
			if _, err := os.Stat(manifest); err != nil {
				t.Errorf("%s was not installed into %s: %v", skill.Name, dir, err)
				continue
			}
			// Every real skill says where it came from, not just the synthetic ones above: this
			// is the copy a session reaches for, and the source is a repository it may not
			// even have.
			installed := string(mustReadBytes(t, manifest))
			if !strings.Contains(installed, skillSourcePath(skill.Name)) {
				t.Errorf("the installed %s in %s does not name its source", skill.Name, dir)
			}
		}
	}

	// And again: the second start of the day must be a no-op, not a rewrite.
	before := modTimes(t, store)
	syncSkills(cfg)
	if after := modTimes(t, store); len(after) != len(before) {
		t.Errorf("the second run changed the file set: %d files, was %d", len(after), len(before))
	}
}

// The directories are store content, written always: a deployment that vetoed every agent still
// serves a store whose skills are in place for whoever opens it.
func TestSyncSkillsInstallsWhateverTheDeploymentOffers(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	cfg := &Config{
		Config:         &core.Config{RootPath: store},
		ClaudeDisabled: true, CodexDisabled: true, MuseDisabled: true,
	}

	syncSkills(cfg)

	if len(skills.All()) == 0 {
		t.Fatal("this build carries no skills")
	}
	for _, skill := range skills.All() {
		for _, dir := range []string{storeAgentsSkills(store), storeClaudeSkills(store)} {
			if _, err := os.Stat(filepath.Join(dir, skill.Name, skills.Manifest)); err != nil {
				t.Errorf("%s was not installed into %s: %v", skill.Name, dir, err)
			}
		}
	}
}

// The store's own skills live beside the installed ones: this checkout's verify, hexarch and
// markdown-anchors sit in .agents/skills, and the pass must neither touch them nor prune them.
func TestSyncSkillsLeavesTheStoreSkillsAlone(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	theirs := filepath.Join(storeAgentsSkills(store), "verify")
	mustWriteBytes(t, filepath.Join(theirs, "SKILL.md"), []byte("the store's own skill"))

	syncSkills(&Config{Config: &core.Config{RootPath: store}})

	if got := string(mustReadBytes(t, filepath.Join(theirs, "SKILL.md"))); got != "the store's own skill" {
		t.Errorf("SKILL.md = %q; a skill we did not write must not be overwritten", got)
	}
}

func TestSyncSkillsIsOffWithoutAStoreRoot(t *testing.T) {
	home := redirectHomes(t)

	syncSkills(&Config{})

	// Nothing installed anywhere — and the cleanup found empty homes, so nothing removed either.
	if entries, err := os.ReadDir(home); err != nil || len(entries) != 0 {
		t.Errorf("something was written despite an empty store root: %v %v", entries, err)
	}
}

func TestStoreSkillTargets(t *testing.T) {
	if targets := storeSkillTargets(&Config{}); targets != nil {
		t.Errorf("targets = %v, want none without a store root", targets)
	}
	if targets := storeSkillTargets(nil); targets != nil {
		t.Errorf("targets = %v, want none for a nil config", targets)
	}
	targets := storeSkillTargets(&Config{Config: &core.Config{RootPath: "/store"}})
	if len(targets) != 2 {
		t.Fatalf("targets = %v, want the two store directories", targets)
	}
	if targets[0].root != filepath.Join("/store", ".agents", "skills") {
		t.Errorf("targets[0] = %q", targets[0].root)
	}
	if targets[1].root != filepath.Join("/store", ".claude", "skills") {
		t.Errorf("targets[1] = %q", targets[1].root)
	}
}

// modTimes maps every file under root to its modification time.
func modTimes(t *testing.T, root string) map[string]int64 {
	t.Helper()
	times := map[string]int64{}
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		times[path] = info.ModTime().UnixNano()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return times
}

// ── the previous install ──────────────────────────────────────────────────────

// plantLegacySkill writes a skill the way the previous install left it: a directory with a
// readable marker, whether or not this build still bundles a skill of that name.
func plantLegacySkill(t *testing.T, home, name string) {
	t.Helper()
	mustWriteBytes(t, filepath.Join(home, name, "SKILL.md"), []byte("from the previous install"))
	mustWriteBytes(t, filepath.Join(home, name, skillMarkerName), []byte(
		skillMarkerHeader+"skill="+name+"\n"+"source=reference/kiao-skills/"+name+"/\n"+
			"digest=abc\n"+"installed=def\n"))
}

func TestCleanLegacySkillHomeRemovesOnlyOurOwn(t *testing.T) {
	root := t.TempDir()
	plantLegacySkill(t, root, "graph")
	plantLegacySkill(t, root, "dropped-long-ago") // stale under any bundle: still ours
	mustWriteBytes(t, filepath.Join(root, "theirs", "SKILL.md"), []byte("the user's own"))
	mustWriteBytes(t, filepath.Join(root, "loose.md"), []byte("not a skill"))
	mustWriteBytes(t, filepath.Join(root, ".staging.tmp-1", skillMarkerName), []byte("digest=abc\n"))

	cleanLegacySkillHome("claude", root)

	for _, gone := range []string{"graph", "dropped-long-ago"} {
		if _, err := os.Stat(filepath.Join(root, gone)); !os.IsNotExist(err) {
			t.Errorf("%s survived the cleanup (%v)", gone, err)
		}
	}
	for _, survivor := range []string{"theirs", "loose.md", ".staging.tmp-1"} {
		if _, err := os.Stat(filepath.Join(root, survivor)); err != nil {
			t.Errorf("%s was removed and should not have been: %v", survivor, err)
		}
	}
}

// A home that was never written to — or whose copies are already gone — costs one directory read
// and no log line. Absent entirely is quieter still.
func TestCleanLegacySkillHomeIsQuietWhenThereIsNothing(t *testing.T) {
	cleanLegacySkillHome("claude", t.TempDir())
	cleanLegacySkillHome("claude", filepath.Join(t.TempDir(), "no-such-dir"))
	cleanLegacySkillHome("claude", "")
	cleanLegacySkillHome("claude", "  ")
}

// The whole move in one pass: the first start after it writes the store directories and empties
// the three homes of what the previous install wrote there.
func TestSyncSkillsMovesThePreviousInstallIntoTheStore(t *testing.T) {
	home := redirectHomes(t)
	claudeHome := filepath.Join(home, ".claude", "skills")
	codexHome := filepath.Join(home, "codex-home", "skills")
	museHome := filepath.Join(home, "xdg", "muse", "skills")
	for _, dir := range []string{claudeHome, codexHome, museHome} {
		plantLegacySkill(t, dir, "graph")
		mustWriteBytes(t, filepath.Join(dir, "theirs", "SKILL.md"), []byte("the user's own"))
	}
	store := t.TempDir()

	syncSkills(&Config{Config: &core.Config{RootPath: store}})

	for _, dir := range []string{claudeHome, codexHome, museHome} {
		if _, err := os.Stat(filepath.Join(dir, "graph")); !os.IsNotExist(err) {
			t.Errorf("%s/graph survived the move (%v)", dir, err)
		}
		if _, err := os.Stat(filepath.Join(dir, "theirs", "SKILL.md")); err != nil {
			t.Errorf("the user's own skill in %s was removed: %v", dir, err)
		}
	}
	if len(skills.All()) == 0 {
		t.Fatal("this build carries no skills")
	}
	for _, skill := range skills.All() {
		if _, err := os.Stat(filepath.Join(storeAgentsSkills(store), skill.Name, skills.Manifest)); err != nil {
			t.Errorf("%s was not installed into the store: %v", skill.Name, err)
		}
	}

	// And again: the second start finds nothing to clean and nothing to install.
	before := modTimes(t, store)
	syncSkills(&Config{Config: &core.Config{RootPath: store}})
	if after := modTimes(t, store); len(after) != len(before) {
		t.Errorf("the second run changed the file set: %d files, was %d", len(after), len(before))
	}
	for _, dir := range []string{claudeHome, codexHome, museHome} {
		if _, err := os.Stat(filepath.Join(dir, "theirs", "SKILL.md")); err != nil {
			t.Errorf("the user's own skill in %s went missing on the second run: %v", dir, err)
		}
	}
}

func TestDefaultClaudeSkillsPath(t *testing.T) {
	if got := defaultClaudeSkillsPath("/home/someone"); got != filepath.Join("/home/someone", ".claude", "skills") {
		t.Errorf("path = %q", got)
	}
	// No home to derive one from cleans nothing rather than guessing at a path.
	if got := defaultClaudeSkillsPath("  "); got != "" {
		t.Errorf("path = %q, want empty", got)
	}
}

func TestDefaultCodexSkillsPath(t *testing.T) {
	t.Setenv("CODEX_HOME", "")
	if got := defaultCodexSkillsPath("/home/someone"); got != filepath.Join("/home/someone", ".codex", "skills") {
		t.Errorf("got %q", got)
	}
	// $CODEX_HOME moves everything that CLI keeps, skills included.
	t.Setenv("CODEX_HOME", "/srv/codex")
	if got := defaultCodexSkillsPath("/home/someone"); got != filepath.Join("/srv/codex", "skills") {
		t.Errorf("CODEX_HOME got %q", got)
	}
}

func TestDefaultMuseSkillsPath(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	if got := defaultMuseSkillsPath("/home/someone"); got != filepath.Join("/home/someone", ".config", "muse", "skills") {
		t.Errorf("got %q", got)
	}
	// The skills move with the XDG config home, which is the only home that CLI has.
	t.Setenv("XDG_CONFIG_HOME", "/srv/xdg")
	if got := defaultMuseSkillsPath("/home/someone"); got != filepath.Join("/srv/xdg", "muse", "skills") {
		t.Errorf("XDG_CONFIG_HOME got %q", got)
	}
	// And with no home at all there is no guess: the cleanup is off rather than misplaced.
	t.Setenv("XDG_CONFIG_HOME", "")
	if got := defaultMuseSkillsPath(""); got != "" {
		t.Errorf("got %q, want the cleanup off", got)
	}
}

// ── the store's plugin list decides which skills it gets ──────────────────────

// writePluginList writes a dashboard.json naming those plugins, where the default layout puts it.
func writePluginList(t *testing.T, store string, plugins ...string) {
	t.Helper()
	if plugins == nil {
		plugins = []string{} // a nil slice marshals to null, which is the store that has not said
	}
	document, err := json.Marshal(map[string]any{"chatEnabled": true, "plugins": plugins})
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, filepath.Join(store, core.StateDirName, dashboardConfigDoc), document)
}

// skillsInstalledIn is what a target directory holds, by name.
func skillsInstalledIn(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("cannot read %s: %v", dir, err)
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			names = append(names, entry.Name())
		}
	}
	return names
}

// The point of the whole thing: a store that loads the graph editor and nothing else gets the two
// skills about graphs, and is not handed nine descriptions of formats it cannot open.
func TestSyncSkillsInstallsOnlyWhatTheStoresPluginsCallFor(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	writePluginList(t, store, "markdown-edit", "graph-edit")

	syncSkills(&Config{Config: &core.Config{RootPath: store}})

	for _, dir := range []string{storeAgentsSkills(store), storeClaudeSkills(store)} {
		got := skillsInstalledIn(t, dir)
		want := []string{"graph", "passage-link", "strategy"}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s holds %v, want %v", dir, got, want)
		}
	}
}

// And switching a plugin off afterwards takes its skill away, rather than leaving it to be read by
// every turn until somebody restarts the service. It is the prune that does it, so the rule is the
// marker's: this is the same removal as a skill the build has dropped.
func TestSyncSkillsRemovesASkillWhosePluginHasGoneOff(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	cfg := &Config{Config: &core.Config{RootPath: store}}

	writePluginList(t, store, "archdia-edit", "graph-edit")
	syncSkills(cfg)
	if _, err := os.Stat(filepath.Join(storeClaudeSkills(store), "archdia")); err != nil {
		t.Fatalf("archdia was not installed to begin with: %v", err)
	}

	writePluginList(t, store, "graph-edit")
	syncSkills(cfg)

	for _, dir := range []string{storeAgentsSkills(store), storeClaudeSkills(store)} {
		if _, err := os.Stat(filepath.Join(dir, "archdia")); !os.IsNotExist(err) {
			t.Errorf("archdia is still in %s after its plugin was switched off: %v", dir, err)
		}
		if _, err := os.Stat(filepath.Join(dir, "graph", skills.Manifest)); err != nil {
			t.Errorf("graph went with it: %v", err)
		}
	}
}

// A store that loads no plugin at all has answered the question, and the answer is none. The
// directories are still made and still pruned — that is what takes the previous set away.
func TestAnEmptyPluginListInstallsNoSkills(t *testing.T) {
	redirectHomes(t)
	store := t.TempDir()
	cfg := &Config{Config: &core.Config{RootPath: store}}

	syncSkills(cfg)
	writePluginList(t, store)
	syncSkills(cfg)

	for _, dir := range []string{storeAgentsSkills(store), storeClaudeSkills(store)} {
		if got := skillsInstalledIn(t, dir); len(got) != 0 {
			t.Errorf("%s holds %v, want nothing", dir, got)
		}
	}
}

// Everything that is not an answer reads as "every plugin", because the cost of guessing that way
// is a skill directory nobody reads and the cost of guessing the other way is a turn that no
// longer knows the formats of the store it is working in.
func TestAnUnansweredPluginListMeansEverySkill(t *testing.T) {
	for _, document := range []struct{ name, content string }{
		{"no document at all", ""},
		{"a document with no plugin list", `{"chatEnabled":true}`},
		{"a null plugin list", `{"plugins":null}`},
		{"a document that is not JSON", `{"plugins":[`},
		{"a plugin list that is not a list", `{"plugins":"graph-edit"}`},
	} {
		t.Run(document.name, func(t *testing.T) {
			redirectHomes(t)
			store := t.TempDir()
			if document.content != "" {
				mustWriteBytes(t, filepath.Join(store, core.StateDirName, dashboardConfigDoc), []byte(document.content))
			}

			syncSkills(&Config{Config: &core.Config{RootPath: store}})

			for _, skill := range skills.All() {
				if _, err := os.Stat(filepath.Join(storeClaudeSkills(store), skill.Name, skills.Manifest)); err != nil {
					t.Errorf("%s was not installed: %v", skill.Name, err)
				}
			}
		})
	}
}

// The document is read where the deployment keeps its state, which is not always inside the store:
// a store served with KIAO_WORKER_STATE_PATH elsewhere must still be asked about its own
// plugins rather than read as one that has never been configured.
func TestThePluginListIsReadFromTheStateDirectory(t *testing.T) {
	redirectHomes(t)
	store, state := t.TempDir(), t.TempDir()
	mustWriteBytes(t, filepath.Join(state, dashboardConfigDoc), []byte(`{"plugins":["archdia-edit"]}`))

	syncSkills(&Config{Config: &core.Config{RootPath: store, StatePath: state}})

	if got := skillsInstalledIn(t, storeClaudeSkills(store)); strings.Join(got, ",") != "archdia" {
		t.Errorf("installed %v, want just archdia", got)
	}
}

// What the reading answers, in its own right: the ids as a set, and "the store has said" as a
// second answer — which is what tells an empty list from a store that has never been asked.
func TestEnabledPluginsReadsTheList(t *testing.T) {
	store := t.TempDir()
	writePluginList(t, store, "graph-edit", "markdown-edit")

	enabled, chosen := enabledPlugins(&Config{Config: &core.Config{RootPath: store}})
	if !chosen {
		t.Fatal("the store named its plugins and was read as having named none")
	}
	if !enabled["graph-edit"] || !enabled["markdown-edit"] || enabled["archdia-edit"] {
		t.Errorf("enabled = %v, want the two named and nothing else", enabled)
	}
}

// A Config with no store behind it — which is most of the tests in this package — has no document
// to read and no store to install into either.
func TestEnabledPluginsHasNowhereToLookWithoutAStore(t *testing.T) {
	if _, chosen := enabledPlugins(&Config{}); chosen {
		t.Error("a config with no store root read a plugin list from somewhere")
	}
}
