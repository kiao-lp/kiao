package scope

import (
	"encoding/json"
	coreconfig "kiao/worker/internal/core/config"
	fileconfig "kiao/worker/internal/files/configuration"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// The two rules that carry the whole syntax, and the one an author writing .gitignore would get
// wrong if we got it wrong: a trailing slash is decoration, not an anchor.
func TestKiaoPatternAnchoring(t *testing.T) {
	cases := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"node_modules", "node_modules", true},
		{"node_modules", "a/b/node_modules", true},
		{"node_modules", "a/node_modules/pkg/index.js", true},
		{"node_modules", "node_modules_of_mine", false},
		{"build/generated", "build/generated", true},
		{"build/generated", "build/generated/deep/x.md", true},
		{"build/generated", "app/build/generated", false},
		{"vendor/", "app/vendor/lib.md", true},
		{"/vendor", "app/vendor", false},
		{"/vendor", "vendor/lib.md", true},
		{"*.generated.json", "a/b/model.generated.json", true},
		{"docs/*/draft", "docs/fr/draft", true},
		{"docs/*/draft", "docs/fr/nested/draft", false},
		{"/", "anything/at/all.md", true},
	}
	for _, c := range cases {
		d := parseKiaoFiles(c.pattern, "/store", "")
		if got := d.excludes(filepath.Join("/store", filepath.FromSlash(c.path)), ConcernRefactor); got != c.want {
			t.Errorf("%q excludes %q = %v, want %v", c.pattern, c.path, got, c.want)
		}
	}
}

// The folder a declaration governs is the thing being walked, not an entry in it, and a path
// outside it is none of its business.
func TestKiaoDeclIgnoresItsOwnFolderAndWhatIsOutsideIt(t *testing.T) {
	d := parseKiaoFiles("/", "/store", "")
	for _, p := range []string{"/store", "/elsewhere/x.md", "/store/../x.md"} {
		if d.excludes(p, ConcernRefactor) {
			t.Errorf("excludes(%q) = true, want false", p)
		}
	}
}

// The point of the format: one folder, three passes, and a rule that answers for one of them only.
func TestKiaoSectionsBoundOnePassEach(t *testing.T) {
	d := parseKiaoFiles(strings.Join([]string{
		"node_modules",
		"[migration]",
		"docs",
		"[refactor]",
		"fixtures",
		"[search]",
		"archive",
		"[future]",
		"whatever",
	}, "\n"), "/store", "")

	cases := []struct {
		path                      string
		migration, refact, search bool
	}{
		{"node_modules/x.md", true, true, true}, // before any section: every pass
		{"docs/x.md", true, false, false},
		{"fixtures/x.md", false, true, false},
		{"archive/x.md", false, false, true},
		{"whatever/x.md", false, false, false}, // an unknown section is parsed and never consulted
		{"units/x.md", false, false, false},
	}
	for _, c := range cases {
		abs := filepath.Join("/store", filepath.FromSlash(c.path))
		for _, k := range []struct {
			concern string
			want    bool
		}{
			{concernMigration, c.migration},
			{ConcernRefactor, c.refact},
			{ConcernSearch, c.search},
		} {
			if got := d.excludes(abs, k.concern); got != k.want {
				t.Errorf("%q %s = %v, want %v", c.path, k.concern, got, k.want)
			}
		}
	}
}

// The decision that makes an exclusion usable rather than a trap: it keeps a pass out of the
// folders nobody pointed it at, and answers for nothing about the folder that was pointed at. A
// search of an excluded folder searches it whole — the exemption has to reach the subtree, not just
// the one path — while the other rules of the same declaration keep applying inside it.
func TestKiaoScopeAtExemptsTheFolderWalked(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, KiaoFilesName), "vendor\ncache\n")

	inside := KiaoScopeAt(root, filepath.Join(root, "units"))
	if !inside.Excludes(filepath.Join(root, "units", "vendor", "x.md"), ConcernSearch) {
		t.Error("a walk aimed elsewhere stopped honouring the declaration")
	}

	aimed := KiaoScopeAt(root, filepath.Join(root, "vendor"))
	if aimed.Excludes(filepath.Join(root, "vendor", "deep", "x.md"), ConcernSearch) {
		t.Error("the folder walked is excluded from its own walk")
	}
	if !aimed.Excludes(filepath.Join(root, "vendor", "cache", "x.md"), ConcernSearch) {
		t.Error("aiming at one excluded folder dropped the rest of the declaration")
	}
}

// A declaration whose own folder is the one walked has said `/` about it, and that rule goes with
// the others — otherwise a repository declaring itself entirely out of bounds could never be
// searched, not even by someone standing in it.
func TestKiaoScopeAtExemptsAFolderThatDeclaredItselfWhole(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "repo", KiaoFilesName), "[search]\n/\n")

	if KiaoScopeAt(root, filepath.Join(root, "repo")).Excludes(filepath.Join(root, "repo", "x.md"), ConcernSearch) {
		t.Error("a folder declaring itself out of bounds cannot be searched even directly")
	}

	// From above, the same file bounds nothing until the walk reaches the folder holding it: a
	// nested declaration is found in the folder it governs, so entering that folder is what puts it
	// in force over the entries the walk is about to read.
	above := NewKiaoWalk(root, root, ConcernSearch)
	if above.ExcludesDir(filepath.Join(root, "repo")) {
		t.Error("a folder was judged by a declaration that is its own")
	}
	if !above.ExcludesFile(filepath.Join(root, "repo", "x.md")) {
		t.Error("a search from above reached into a folder that declared itself out of bounds")
	}
}

// A nested declaration is anchored at its own folder and covers only what is under it. Sibling
// isolation is the case worth pinning: both siblings descend from the same parent scope, and a
// scope that appended in place would leak the first one's rules into the second.
func TestKiaoScopeIsPerSubtree(t *testing.T) {
	parent := KiaoScope{}.With(parseKiaoFiles("node_modules", "/store", ""))
	left := parent.With(parseKiaoFiles("/generated", "/store/left", ""))
	right := parent.With(parseKiaoFiles("cache", "/store/right", ""))

	if !left.Excludes("/store/left/generated/x.md", ConcernRefactor) {
		t.Error("the nested declaration does not cover its own folder")
	}
	if right.Excludes("/store/right/generated/x.md", ConcernRefactor) {
		t.Error("a sibling's declaration leaked across")
	}
	if parent.Excludes("/store/left/generated/x.md", ConcernRefactor) {
		t.Error("a nested declaration reached back into its parent's scope")
	}
	for _, s := range []KiaoScope{left, right} {
		if !s.Excludes("/store/anywhere/node_modules/x.md", ConcernRefactor) {
			t.Error("an ancestor's declaration stopped applying below it")
		}
	}
}

// A store whose root could not be seeded — read-only, or a permission the service does not have —
// still has to be fast, so an absent declaration means the defaults and not "nothing is excluded".
func TestRootDeclFallsBackToTheDefaults(t *testing.T) {
	root := t.TempDir()

	d := rootKiaoDecl(root)
	if d.source != "" {
		t.Errorf("source = %q, want the built-in defaults", d.source)
	}
	if !d.excludes(filepath.Join(root, "node_modules", "p", "x.md"), ConcernRefactor) {
		t.Error("the built-in defaults do not exclude node_modules")
	}

	// An empty file is a decision someone made: exclude nothing.
	mustWrite(t, filepath.Join(root, KiaoFilesName), "")
	if rootKiaoDecl(root).excludes(filepath.Join(root, "node_modules", "p", "x.md"), ConcernRefactor) {
		t.Error("an empty declaration still excluded something")
	}
}

func TestEnsureStoreDeclarationSeedsTheDefaults(t *testing.T) {
	root := t.TempDir()
	cfg := &fileconfig.Config{Config: &coreconfig.Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}}

	EnsureStoreDeclaration(cfg)

	body := mustRead(t, filepath.Join(root, KiaoFilesName))
	if !strings.Contains(body, "\nnode_modules\n") {
		t.Errorf("the seeded declaration is not in force:\n%s", body)
	}
	if got := parseKiaoFiles(body, root, "").byConcern[concernMigration]; len(got) > 0 {
		t.Errorf("a store with no legacy file got migration-only rules it never asked for: %+v", got)
	}
}

// The one thing the old layout held that cannot be reconstructed is the operator's own patterns.
// They are absorbed verbatim, into the section they answered for, and the file they were in goes:
// a declaration nothing reads any more is a file someone will keep editing.
func TestEnsureStoreDeclarationAbsorbsALegacyMigrationIgnore(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, ".kiao-config")
	cfg := &fileconfig.Config{Config: &coreconfig.Config{RootPath: root, StatePath: state}}
	legacy := filepath.Join(state, LegacyMigrationIgnoreFile)
	mustWrite(t, legacy, "# only this store's own rules are worth keeping\nmy-sources\ndocs/examples\n")

	EnsureStoreDeclaration(cfg)

	body := mustRead(t, filepath.Join(root, KiaoFilesName))
	migration, refactor := parseKiaoFiles(body, root, ""), parseKiaoFiles(body, root, "")
	for _, p := range []string{"my-sources/lib.md", "docs/examples/x.md"} {
		abs := filepath.Join(root, filepath.FromSlash(p))
		if !migration.excludes(abs, concernMigration) {
			t.Errorf("%q is no longer out of bounds for a migration", p)
		}
		if refactor.excludes(abs, ConcernRefactor) {
			t.Errorf("%q became out of bounds for link updates, which it never was", p)
		}
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("the legacy file survived the conversion: %v", err)
	}
}

// It is the operator's from the moment it exists.
func TestEnsureStoreDeclarationKeepsAnExistingOne(t *testing.T) {
	root := t.TempDir()
	cfg := &fileconfig.Config{Config: &coreconfig.Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}}
	mustWrite(t, filepath.Join(root, KiaoFilesName), "my-own-rule\n")
	mustWrite(t, filepath.Join(cfg.StatePath, LegacyMigrationIgnoreFile), "vendor\n")

	EnsureStoreDeclaration(cfg)

	if got := mustRead(t, filepath.Join(root, KiaoFilesName)); got != "my-own-rule\n" {
		t.Errorf("declaration = %q, want the operator's own kept", got)
	}
	if _, err := os.Stat(filepath.Join(cfg.StatePath, LegacyMigrationIgnoreFile)); err != nil {
		t.Errorf("a legacy file was removed without being absorbed: %v", err)
	}
}

// The grammar is read by two implementations — this one, and the migration helpers' in Node — and
// they have to agree. The cases live once, outside both, and each suite reads them: a rule that
// quietly matched less here than it does there would let a link update reach a file the operator
// fenced off from migrations, and nothing else would notice.
func TestKiaoFilesSharedCorpus(t *testing.T) {
	const corpus = "../../../../../migrations/test/kiao-files-corpus.json"
	data, err := os.ReadFile(corpus)
	if err != nil {
		t.Skipf("shared corpus not available (%v); run from a full checkout", err)
	}
	var doc struct {
		Defaults []string `json:"defaults"`
		Cases    []struct {
			Name        string `json:"name"`
			Declaration string `json:"declaration"`
			Path        string `json:"path"`
			Migration   bool   `json:"migration"`
			Refactor    bool   `json:"refactor"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("cannot read %s: %v", corpus, err)
	}
	if len(doc.Cases) == 0 {
		t.Fatalf("%s holds no cases", corpus)
	}
	// The defaults are the other half of the contract: the grammar agreeing is no use if a store
	// with no declaration of its own is bounded differently by each side.
	if got := rootKiaoDecl(t.TempDir()).rules(""); !reflect.DeepEqual(got, doc.Defaults) {
		t.Errorf("seeded defaults = %v, want %v (from %s)", got, doc.Defaults, corpus)
	}
	for _, c := range doc.Cases {
		d := parseKiaoFiles(c.Declaration, "/store", corpus)
		abs := filepath.Join("/store", filepath.FromSlash(c.Path))
		if got := d.excludes(abs, concernMigration); got != c.Migration {
			t.Errorf("%s: migration excludes %q = %v, want %v", c.Name, c.Path, got, c.Migration)
		}
		if got := d.excludes(abs, ConcernRefactor); got != c.Refactor {
			t.Errorf("%s: refactor excludes %q = %v, want %v", c.Name, c.Path, got, c.Refactor)
		}
	}
}
