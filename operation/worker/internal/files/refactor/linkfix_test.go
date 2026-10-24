package refactor

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	pkgFilesystem "kiao/worker/internal/core/filesystem"
	pkgScope "kiao/worker/internal/files/scope"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// TestLinkFixRenameChildAndSlash pins the token-shaping rules: a link opens with the slash that
// makes it one, a nested "child" suffix is carried over, and a token whose match is followed by a
// non-boundary, non-slash byte is left alone.
func TestLinkFixRenameChildAndSlash(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})

	content := "" +
		"link [a](/docs/old) here\n" +
		"child /docs/old/child.png here\n" +
		"suffixed /docs/oldsuffix stays\n"
	mustWrite(t, filepath.Join(root, "ref.md"), content)

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	got := mustRead(t, filepath.Join(root, "ref.md"))
	want := "" +
		"link [a](/docs/new) here\n" +
		"child /docs/new/child.png here\n" +
		"suffixed /docs/oldsuffix stays\n"
	if got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
	if len(report.FileChanges) != 1 {
		t.Fatalf("expected 1 file change, got %d", len(report.FileChanges))
	}
	if n := len(report.FileChanges[0].Substitutions); n != 2 {
		t.Errorf("expected 2 substitutions (the link and its child), got %d", n)
	}
	if report.Operation != "RENAME" || report.NewPath == nil || *report.NewPath != "docs/new" {
		t.Errorf("report header mismatch: %+v", report)
	}
}

// The rule this pass now lives by, and the bug it exists to close. A store's root folders are
// called `docs`, `config`, `units` — ordinary words — and a rename used to rewrite every one of
// them wherever a path token happened to look like a link: a shell snippet, a stack trace pasted
// into a note, a sentence. Only what carries the leading slash is a link.
//
// The one thing given up with it is a reference written without the slash, and in markdown that is
// not a store link at all: `](sibling.md)` is read against the document, here, on GitHub and in an
// IDE preview alike, and it points somewhere else entirely.
func TestLinkFixLeavesBarePathsAlone(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})

	prose := "" +
		"run `cp config/values.json .` first\n" +
		"the config/values.json of the deployment\n" +
		"relative [a](config/values.json) reads against this document\n" +
		"the link [b](/config/values.json) is the one that moves\n"
	mustWrite(t, filepath.Join(root, "ref.md"), prose)

	report, err := lf.FixAfterRename("config", "kiao-user-config")
	if err != nil {
		t.Fatal(err)
	}
	want := "" +
		"run `cp config/values.json .` first\n" +
		"the config/values.json of the deployment\n" +
		"relative [a](config/values.json) reads against this document\n" +
		"the link [b](/kiao-user-config/values.json) is the one that moves\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
	if len(report.FileChanges) != 1 || len(report.FileChanges[0].Substitutions) != 1 {
		t.Errorf("expected the one link to be reported, got %+v", report.FileChanges)
	}
}

// TestLinkFixRenameAnchorNotMatched documents a boundary quirk: a '#' anchor is NOT a token
// boundary and not a child slash, so an "…/old#anchor" reference is left untouched.
//
// NOTE: pinned current behavior — revisit in prompt 05.
func TestLinkFixRenameAnchorNotMatched(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "see /docs/old#section for details\n")

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != "see /docs/old#section for details\n" {
		t.Errorf("anchor reference should be untouched, got %q", got)
	}
	if len(report.FileChanges) != 0 {
		t.Errorf("expected no changes for anchored reference, got %+v", report.FileChanges)
	}
}

// TestLinkFixExtensionFiltering verifies only files whose name ends with a configured extension
// are scanned, case-insensitively, and others are left byte-for-byte intact.
func TestLinkFixExtensionFiltering(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md", ".txt"})

	mustWrite(t, filepath.Join(root, "a.md"), "/path/old\n")
	mustWrite(t, filepath.Join(root, "b.TXT"), "/path/old\n")  // uppercase ext -> still scanned
	mustWrite(t, filepath.Join(root, "c.json"), "/path/old\n") // not configured -> skipped
	mustWrite(t, filepath.Join(root, "sub", "d.md"), "/path/old\n")

	report, err := lf.FixAfterRename("path/old", "path/new")
	if err != nil {
		t.Fatal(err)
	}
	if mustRead(t, filepath.Join(root, "a.md")) != "/path/new\n" {
		t.Errorf("a.md not rewritten")
	}
	if mustRead(t, filepath.Join(root, "b.TXT")) != "/path/new\n" {
		t.Errorf("b.TXT (uppercase ext) not rewritten")
	}
	if mustRead(t, filepath.Join(root, "c.json")) != "/path/old\n" {
		t.Errorf("c.json should be skipped but was modified")
	}
	if mustRead(t, filepath.Join(root, "sub", "d.md")) != "/path/new\n" {
		t.Errorf("nested sub/d.md not rewritten")
	}
	if len(report.FileChanges) != 3 {
		t.Errorf("expected 3 changed files (a.md, b.TXT, sub/d.md), got %d: %+v", len(report.FileChanges), report.FileChanges)
	}
}

// TestLinkFixDeleteReport pins the DELETE report shape and the substitution line numbers.
func TestLinkFixDeleteReport(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "keep\nlink to /gone/file here\nkeep\n")

	report, err := lf.FixAfterDelete("gone/file")
	if err != nil {
		t.Fatal(err)
	}
	if report.Operation != "DELETE" || report.NewPath != nil || report.OriginalPath != "gone/file" {
		t.Errorf("delete report header mismatch: %+v", report)
	}
	if len(report.FileChanges) != 1 {
		t.Fatalf("expected 1 changed file, got %d", len(report.FileChanges))
	}
	subs := report.FileChanges[0].Substitutions
	if len(subs) != 1 || subs[0].LineNumber != 2 || subs[0].NewValue != DeletedSentinel {
		t.Errorf("substitution mismatch: %+v", subs)
	}
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != "keep\nlink to "+DeletedSentinel+" here\nkeep\n" {
		t.Errorf("delete rewrite mismatch: %q", got)
	}
}

// TestLinkFixSkipsBinary verifies a non-UTF-8 file with a matching extension is left untouched
// (readLines reports it as binary).
func TestLinkFixSkipsBinary(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	binary := []byte{0xff, 0xfe, 'p', 'a', 't', 'h', '/', 'o', 'l', 'd', 0x00}
	mustWriteBytes(t, filepath.Join(root, "blob.md"), binary)

	report, err := lf.FixAfterRename("path/old", "path/new")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.FileChanges) != 0 {
		t.Errorf("binary file should be skipped, got changes: %+v", report.FileChanges)
	}
	if got := mustReadBytes(t, filepath.Join(root, "blob.md")); string(got) != string(binary) {
		t.Errorf("binary file was modified")
	}
}

// TestLinkFixCanonicalStoredLink pins the shape Dashboard stores an internal link in: a path
// relative to the store root, with a leading slash and no context path. That form is the one the
// fixer repairs on a rename, which is the point of it — the older `/dashboard/…` shape is not,
// because the byte before the match is a '/', which is not a token boundary, so the match is
// rejected. Content written before links became portable therefore keeps a stale path here.
func TestLinkFixCanonicalStoredLink(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md", ".json"})

	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"stored [a](/units/abc/cadre.md) here\n"+
		"legacy [b](/dashboard/units/abc/cadre.md) here\n")
	mustWrite(t, filepath.Join(root, "sidecar.md.config.json"),
		"{\"bibliographyUrls\":{\"Cadre\":\"/units/abc/cadre.md\"}}\n")

	report, err := lf.FixAfterRename("units/abc/cadre.md", "units/abc/contexte.md")
	if err != nil {
		t.Fatal(err)
	}

	want := "" +
		"stored [a](/units/abc/contexte.md) here\n" +
		"legacy [b](/dashboard/units/abc/cadre.md) here\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
	wantSidecar := "{\"bibliographyUrls\":{\"Cadre\":\"/units/abc/contexte.md\"}}\n"
	if got := mustRead(t, filepath.Join(root, "sidecar.md.config.json")); got != wantSidecar {
		t.Errorf("sidecar rewrite mismatch:\n got=%q\nwant=%q", got, wantSidecar)
	}
	if len(report.FileChanges) != 2 {
		t.Fatalf("expected both files changed, got %d", len(report.FileChanges))
	}
}

// The state directory sits in the data root and is full of .json — a scannable extension. A rename
// must not reach into it: a conversation transcript is verbatim prompt text and the ledger records
// what a store has migrated, neither of which is a link anybody asked to fix.
func TestLinkFixLeavesMachineryDirectoriesAlone(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root, StateDir: ".kiao-config"}, []string{".md", ".json"})

	transcript := `{"prompt":"rename /docs/old please"}` + "\n"
	mustWrite(t, filepath.Join(root, ".kiao-config", "conversations", "c1.json"), transcript)
	mustWrite(t, filepath.Join(root, ".git", "gitk.json"), transcript)
	mustWrite(t, filepath.Join(root, "ref.md"), "see /docs/old\n")

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.FileChanges) != 1 || report.FileChanges[0].FilePath != "ref.md" {
		t.Errorf("file changes = %+v, want ref.md alone", report.FileChanges)
	}
	if got := mustRead(t, filepath.Join(root, ".kiao-config", "conversations", "c1.json")); got != transcript {
		t.Errorf("the transcript was rewritten: %q", got)
	}
	if got := mustRead(t, filepath.Join(root, ".git", "gitk.json")); got != transcript {
		t.Errorf("a file in .git was rewritten: %q", got)
	}
}

// TestLinkFixBatchAppliesEveryOpInOneWalk pins that a batch produces one report per op, in the
// caller's order, with the same per-file substitutions separate passes produced — and that a
// single file touched by two ops is rewritten once with both.
func TestLinkFixBatchAppliesEveryOpInOneWalk(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})

	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"see /docs/one and /docs/two\n"+
		"and /docs/two/child.png\n")
	mustWrite(t, filepath.Join(root, "other.md"), "only /docs/one here\n")

	reports, err := lf.FixBatch([]LinkFixOp{
		RenameOp("docs/one", "docs/uno"),
		DeleteOp("docs/two"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(reports) != 2 {
		t.Fatalf("expected 2 reports, got %d", len(reports))
	}

	want := "" +
		"see /docs/uno and " + DeletedSentinel + "\n" +
		"and " + DeletedSentinel + "\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("ref.md:\n got=%q\nwant=%q", got, want)
	}
	if got := mustRead(t, filepath.Join(root, "other.md")); got != "only /docs/uno here\n" {
		t.Errorf("other.md = %q", got)
	}

	if reports[0].Operation != "RENAME" || reports[0].NewPath == nil || *reports[0].NewPath != "docs/uno" {
		t.Errorf("report 0 header = %+v", reports[0])
	}
	if len(reports[0].FileChanges) != 2 {
		t.Errorf("op 0 should have changed 2 files, got %+v", reports[0].FileChanges)
	}
	if reports[1].Operation != "DELETE" || reports[1].NewPath != nil {
		t.Errorf("report 1 header = %+v", reports[1])
	}
	if len(reports[1].FileChanges) != 1 || reports[1].FileChanges[0].FilePath != "ref.md" {
		t.Fatalf("op 1 file changes = %+v, want ref.md alone", reports[1].FileChanges)
	}
	subs := reports[1].FileChanges[0].Substitutions
	if len(subs) != 2 || subs[0].LineNumber != 1 || subs[1].LineNumber != 2 {
		t.Errorf("delete substitutions = %+v, want lines 1 and 2", subs)
	}
}

// TestLinkFixBatchOpsSeeEachOther pins the sequential semantics: within a line, op N is applied to
// what op N-1 left behind, exactly as running the ops as separate walks did.
func TestLinkFixBatchOpsSeeEachOther(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "link to /a.md\n")

	reports, err := lf.FixBatch([]LinkFixOp{
		RenameOp("a.md", "b.md"),
		RenameOp("b.md", "c.md"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != "link to /c.md\n" {
		t.Errorf("chained renames gave %q, want %q", got, "link to /c.md\n")
	}
	if len(reports[0].FileChanges) != 1 || len(reports[1].FileChanges) != 1 {
		t.Errorf("both ops should report ref.md: %+v / %+v", reports[0].FileChanges, reports[1].FileChanges)
	}
}

// TestLinkFixBatchEmptyIsNoWalk keeps a batch of nothing from being a full tree read.
func TestLinkFixBatchEmptyIsNoWalk(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "see /docs/one\n")

	reports, err := lf.FixBatch(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(reports) != 0 {
		t.Errorf("expected no reports, got %+v", reports)
	}
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != "see /docs/one\n" {
		t.Errorf("ref.md was touched: %q", got)
	}
}

// TestCommonNeedlePrefix pins the batch's cheap first gate. A needle can only be in a file if its
// prefix is, so the prefix must be a genuine prefix of every needle — and "" whenever there is no
// shared start, which turns the gate off rather than filtering wrongly.
func TestCommonNeedlePrefix(t *testing.T) {
	cases := []struct {
		name    string
		needles []string
		want    string
	}{
		{"siblings under one folder", []string{"doomed/a.md", "doomed/b.md"}, "/doomed/"},
		{"a folder and its children", []string{"doomed/a.md", "doomed"}, "/doomed"},
		// Every needle opens with the slash a link opens with, so the gate never collapses to
		// nothing: two paths sharing no folder still share it.
		{"nothing in common but the slash", []string{"units/a.md", "other/b.md"}, "/"},
		{"one op is its own prefix", []string{"docs/old"}, "/docs/old"},
		{"a path that is all escapes", []string{"docs/old", "\U0001F393/x"}, "/"},
		{"no ops", nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ops := make([]LinkFixOp, 0, len(c.needles))
			for _, n := range c.needles {
				ops = append(ops, DeleteOp(n))
			}
			if got := commonNeedlePrefix(ops); got != c.want {
				t.Errorf("commonNeedlePrefix(%q) = %q, want %q", c.needles, got, c.want)
			}
			// Whatever the prefix, it must never rule out a file that does hold a link.
			for _, n := range c.needles {
				if n == "" {
					continue
				}
				if !anyNeedleIn(ops, commonNeedlePrefix(ops), "see /"+n+" here") {
					t.Errorf("the gate rejected a file holding %q", n)
				}
			}
		})
	}
}

// TestLinkFixConcurrencyMatchesSerial pins that spreading the pass over workers changes nothing a
// caller can observe: same rewritten files, and reports listing them in the same (lexical) order a
// one-worker pass produces. Run with -race, this is also the guard on the shared state in fixBatch.
func TestLinkFixConcurrencyMatchesSerial(t *testing.T) {
	// Enough files, in enough directories, that the workers genuinely interleave.
	build := func(t *testing.T) string {
		t.Helper()
		root := t.TempDir()
		for d := 0; d < 12; d++ {
			for f := 0; f < 20; f++ {
				name := filepath.Join(root, fmt.Sprintf("dir-%02d", d), fmt.Sprintf("f-%02d.md", f))
				// Two thirds of the files reference something the batch touches, the rest nothing.
				switch f % 3 {
				case 0:
					mustWrite(t, name, "see /docs/old and /docs/gone\n")
				case 1:
					mustWrite(t, name, "only [x](/docs/gone/child.png)\n")
				default:
					mustWrite(t, name, "nothing to see here\n")
				}
			}
		}
		return root
	}

	run := func(t *testing.T, root string, workers int) []LinkFixReport {
		t.Helper()
		lf := NewLinkFixerWithWorkers(&pkgFilesystem.Storage{Root: root}, []string{".md"}, workers)
		reports, err := lf.FixBatch([]LinkFixOp{
			RenameOp("docs/old", "docs/new"),
			DeleteOp("docs/gone"),
		})
		if err != nil {
			t.Fatal(err)
		}
		return reports
	}

	serialRoot := build(t)
	serial := run(t, serialRoot, 1)
	parallelRoot := build(t)
	parallel := run(t, parallelRoot, 16)

	if len(serial) != len(parallel) {
		t.Fatalf("report count %d vs %d", len(serial), len(parallel))
	}
	for i := range serial {
		s, p := serial[i], parallel[i]
		if s.Operation != p.Operation || s.OriginalPath != p.OriginalPath {
			t.Errorf("report %d header differs: %+v vs %+v", i, s, p)
		}
		if len(s.FileChanges) != len(p.FileChanges) {
			t.Fatalf("report %d changed %d files serially, %d concurrently", i, len(s.FileChanges), len(p.FileChanges))
		}
		if len(s.FileChanges) == 0 {
			t.Fatalf("report %d changed nothing — the fixture is not exercising the pass", i)
		}
		for j := range s.FileChanges {
			if s.FileChanges[j].FilePath != p.FileChanges[j].FilePath {
				t.Fatalf("report %d change %d: %q serially vs %q concurrently — order is not stable",
					i, j, s.FileChanges[j].FilePath, p.FileChanges[j].FilePath)
			}
			if !reflect.DeepEqual(s.FileChanges[j].Substitutions, p.FileChanges[j].Substitutions) {
				t.Errorf("report %d, %s: substitutions differ", i, s.FileChanges[j].FilePath)
			}
		}
		// Lexical order is what a serial WalkDir yields; assert it outright.
		for j := 1; j < len(p.FileChanges); j++ {
			if p.FileChanges[j-1].FilePath >= p.FileChanges[j].FilePath {
				t.Errorf("report %d is not in lexical order at %d: %q then %q",
					i, j, p.FileChanges[j-1].FilePath, p.FileChanges[j].FilePath)
			}
		}
	}

	// And the trees themselves must be byte-identical.
	for d := 0; d < 12; d++ {
		for f := 0; f < 20; f++ {
			relName := filepath.Join(fmt.Sprintf("dir-%02d", d), fmt.Sprintf("f-%02d.md", f))
			if got, want := mustRead(t, filepath.Join(parallelRoot, relName)), mustRead(t, filepath.Join(serialRoot, relName)); got != want {
				t.Fatalf("%s: %q concurrently vs %q serially", relName, got, want)
			}
		}
	}
}

// The whole point of the declaration: a rename does not read, and cannot rewrite, what the store
// says is not content. The defaults are in force on a store that has no declaration of its own,
// which is what makes a fresh store fast with nothing configured.
func TestLinkFixHonoursTheStoreDeclaration(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root, StateDir: ".kiao-config"}, []string{".md"})

	ref := "see /docs/old\n"
	mustWrite(t, filepath.Join(root, "ref.md"), ref)
	mustWrite(t, filepath.Join(root, "node_modules", "pkg", "readme.md"), ref) // a default
	mustWrite(t, filepath.Join(root, "build", "out.md"), ref)                  // a default
	mustWrite(t, filepath.Join(root, "sources", "note.md"), ref)
	mustWrite(t, filepath.Join(root, pkgScope.KiaoFilesName), "node_modules\nbuild\nsources\n")

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.FileChanges) != 1 || report.FileChanges[0].FilePath != "ref.md" {
		t.Errorf("file changes = %+v, want ref.md alone", report.FileChanges)
	}
	for _, p := range []string{"node_modules/pkg/readme.md", "build/out.md", "sources/note.md"} {
		if got := mustRead(t, filepath.Join(root, filepath.FromSlash(p))); got != ref {
			t.Errorf("%s was rewritten: %q", p, got)
		}
	}
}

// A declaration in a subdirectory covers that subtree and nothing else — the case a store holding
// several unrelated repositories is made of, and the one a store-root-only file cannot express.
func TestLinkFixHonoursANestedDeclaration(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})

	ref := "see /docs/old\n"
	mustWrite(t, filepath.Join(root, "repo-a", "gen", "note.md"), ref)
	mustWrite(t, filepath.Join(root, "repo-b", "gen", "note.md"), ref)
	mustWrite(t, filepath.Join(root, "repo-a", pkgScope.KiaoFilesName), "gen\n")

	if _, err := lf.FixAfterRename("docs/old", "docs/new"); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(root, "repo-a", "gen", "note.md")); got != ref {
		t.Errorf("repo-a/gen was rewritten despite its own declaration: %q", got)
	}
	if got := mustRead(t, filepath.Join(root, "repo-b", "gen", "note.md")); got == ref {
		t.Error("repo-a's declaration reached into repo-b")
	}
}

// The two passes are declared separately because they are different decisions. A folder fenced off
// from migrations is still a folder whose links must not rot.
func TestLinkFixIgnoresAMigrationOnlyRule(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "docs", "note.md"), "see /docs/old\n")
	mustWrite(t, filepath.Join(root, pkgScope.KiaoFilesName), "[migration]\ndocs\n")

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.FileChanges) != 1 {
		t.Fatalf("file changes = %+v, want docs/note.md rewritten", report.FileChanges)
	}
}

// A stored link keeps the percent-encoding it was written with, while a rename names the path in
// UTF-8. Both spellings are the same link, so both have to be recognised — and the new path goes
// back written the way the link that carried the old one was.
func TestLinkFixMatchesEscapedPaths(t *testing.T) {
	cases := []struct {
		name string
		link string
		want string
	}{
		{"escaped", "/docs/%F0%9F%8E%93/Board/note.md", "/docs/%F0%9F%8E%93/LearnBoard/note.md"},
		{"raw", "/docs/\U0001F393/Board/note.md", "/docs/\U0001F393/LearnBoard/note.md"},
		{"lowercase escape", "/docs/%f0%9f%8e%93/Board", "/docs/%F0%9F%8E%93/LearnBoard"},
		{"the folder itself", "/docs/%F0%9F%8E%93/Board", "/docs/%F0%9F%8E%93/LearnBoard"},
		{"escaped child kept", "/docs/%F0%9F%8E%93/Board/mes%20notes.md", "/docs/%F0%9F%8E%93/LearnBoard/mes%20notes.md"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".json"})
			mustWrite(t, filepath.Join(root, "carte.mmap.json"),
				"{\"content\":\"[Titre]("+c.link+")\"}\n")

			report, err := lf.FixAfterRename("docs/\U0001F393/Board", "docs/\U0001F393/LearnBoard")
			if err != nil {
				t.Fatal(err)
			}
			want := "{\"content\":\"[Titre](" + c.want + ")\"}\n"
			if got := mustRead(t, filepath.Join(root, "carte.mmap.json")); got != want {
				t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
			}
			if len(report.FileChanges) != 1 {
				t.Fatalf("expected the mindmap to be reported, got %+v", report.FileChanges)
			}
		})
	}
}

// The bug this pass carried for as long as it has matched escapes at all: it modelled the *address
// bar*'s encoding, which leaves the sub-delimiters raw, while Dashboard writes a stored link with
// `encodeURIComponent` and escapes the parentheses on top of it (`storedLinkOf`). Every character
// in that gap — "&", "(", ")", ",", ":", the ones a real filename is full of — was written escaped
// by the application and looked for raw here, so a bookmark on `/docs/Bilan%20%282026%29/note.md`
// came through the rename of the folder it points at untouched, pointing at nothing.
//
// Each character is checked in both of its spellings, because the fix must not buy the escaped one
// at the cost of the raw one: the two are the same link and a store holds both.
func TestLinkFixMatchesEveryFormAWriterProduces(t *testing.T) {
	cases := []struct {
		name    string
		folder  string
		escaped string
	}{
		{"space", "a b", "a%20b"},
		{"dollar", "a$b", "a%24b"},
		{"ampersand", "a&b", "a%26b"},
		{"plus", "a+b", "a%2Bb"},
		{"comma", "a,b", "a%2Cb"},
		{"semicolon", "a;b", "a%3Bb"},
		{"equals", "a=b", "a%3Db"},
		{"colon", "a:b", "a%3Ab"},
		{"at", "a@b", "a%40b"},
		{"parentheses", "Bilan (2026)", "Bilan%20%282026%29"},
		{"apostrophe", "l'ete", "l%27ete"},
		{"exclamation", "a!b", "a%21b"},
		{"lowercase escape", "a&b", "a%26b"},
	}
	for _, c := range cases {
		for _, spelling := range []string{c.escaped, c.folder} {
			t.Run(c.name+"/"+spelling, func(t *testing.T) {
				root := t.TempDir()
				lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
				mustWrite(t, filepath.Join(root, "bookmarks.md"),
					"### [Note](/docs/"+spelling+"/note.md)\n")

				if _, err := lf.FixAfterRename("docs/"+c.folder, "docs/renamed"); err != nil {
					t.Fatal(err)
				}
				want := "### [Note](/docs/renamed/note.md)\n"
				if got := mustRead(t, filepath.Join(root, "bookmarks.md")); got != want {
					t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
				}
			})
		}
	}
}

// …and the same for a delete, which is the other half of what a bookmark on a document with an
// ordinary French name has to survive.
func TestLinkFixDeleteMatchesAnEscapedSubDelimiter(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "bookmarks.md"),
		"### [Bilan](/docs/Bilan%20%282026%29/note.md)\n")

	if _, err := lf.FixAfterDelete("docs/Bilan (2026)"); err != nil {
		t.Fatal(err)
	}
	want := "### [Bilan](" + DeletedSentinel + ")\n"
	if got := mustRead(t, filepath.Join(root, "bookmarks.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// What the fixer writes is what the application writes, so a link it puts back reads as the link
// Dashboard would have written for the same document — the parentheses escaped, and with them the
// sub-delimiters `encodeURIComponent` escapes.
func TestLinkFixWritesTheApplicationsEncoding(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "bookmarks.md"),
		"### [Note](/docs/mes%20idees/note.md)\n")

	if _, err := lf.FixAfterRename("docs/mes idees", "docs/Bilan (2026) & suite"); err != nil {
		t.Fatal(err)
	}
	want := "### [Note](/docs/Bilan%20%282026%29%20%26%20suite/note.md)\n"
	if got := mustRead(t, filepath.Join(root, "bookmarks.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// A parenthesis ends a markdown destination exactly as a space does, so a rename onto a name
// carrying one escapes the destination it rewrites even when the reference it found was raw —
// otherwise the pass would hand back a "link" the renderer stops reading halfway through.
func TestLinkFixEscapesAParenthesisedNewPath(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"link [a](/notes/bilan/plan.md) here\n"+
		"plain /notes/bilan/plan.md there\n")

	if _, err := lf.FixAfterRename("notes/bilan", "notes/bilan (2026)"); err != nil {
		t.Fatal(err)
	}
	want := "" +
		"link [a](/notes/bilan%20%282026%29/plan.md) here\n" +
		"plain /notes/bilan (2026)/plan.md there\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// A space is the escape that matters most: it cannot be written raw in a markdown destination, so
// a new path carrying one comes back escaped there whatever form the old one was written in.
func TestLinkFixEscapesASpacedNewPath(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"escaped [a](/notes/mes%20idees/plan.md) here\n"+
		"raw [b](/notes/mes idees/plan.md) here\n")

	if _, err := lf.FixAfterRename("notes/mes idees", "notes/mes notes"); err != nil {
		t.Fatal(err)
	}
	want := "" +
		"escaped [a](/notes/mes%20notes/plan.md) here\n" +
		"raw [b](/notes/mes%20notes/plan.md) here\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// The escaping is for the destination and for nothing else. A unit's members entry is a JSON
// string, and every reader of one hands what it finds straight to getFile, which takes the path
// as it reads. Escaping one would break the fetch, so a rename onto a spaced folder writes the
// two contexts differently in the very same file.
func TestLinkFixLeavesANonDestinationRaw(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".json"})
	mustWrite(t, filepath.Join(root, "s.mlunit.json"), ""+
		"{\"members\":[\"/units/abc/abc.mlunit.json\"],\n"+
		" \"note\":\"see [it](/units/abc/abc.mlunit.json)\"}\n")

	if _, err := lf.FixAfterRename("units/abc", "units/Mon titre"); err != nil {
		t.Fatal(err)
	}
	want := "" +
		"{\"members\":[\"/units/Mon titre/abc.mlunit.json\"],\n" +
		" \"note\":\"see [it](/units/Mon%20titre/abc.mlunit.json)\"}\n"
	if got := mustRead(t, filepath.Join(root, "s.mlunit.json")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// A destination reached through a markdown scheme is a destination: "](unit::/units/…)" puts a
// colon in front of the path, not the "(" itself.
func TestLinkFixEscapesASchemeDestination(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".json"})
	mustWrite(t, filepath.Join(root, "carte.mmap.json"),
		"{\"content\":\"[Sommaire](unit::/units/abc/abc.mlunit.json)\"}\n")

	if _, err := lf.FixAfterRename("units/abc", "units/Mon titre"); err != nil {
		t.Fatal(err)
	}
	want := "{\"content\":\"[Sommaire](unit::/units/Mon%20titre/abc.mlunit.json)\"}\n"
	if got := mustRead(t, filepath.Join(root, "carte.mmap.json")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// A delete blanks an escaped reference too, sentinel and all.
func TestLinkFixDeleteMatchesEscapedPaths(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".json"})
	mustWrite(t, filepath.Join(root, "carte.mmap.json"),
		"{\"content\":\"[Titre](/docs/%F0%9F%8E%93/Board)\"}\n")

	report, err := lf.FixAfterDelete("docs/\U0001F393/Board")
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"content\":\"[Titre](" + DeletedSentinel + ")\"}\n"
	if got := mustRead(t, filepath.Join(root, "carte.mmap.json")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
	if len(report.FileChanges) != 1 {
		t.Fatalf("expected the mindmap to be reported, got %+v", report.FileChanges)
	}
}

// literalPrefix is what the fast skip tests for: it must stop at the first character that could
// have been escaped, and never at one that could not.
func TestLiteralPrefix(t *testing.T) {
	cases := map[string]string{
		"docs/\U0001F393/Board": "/docs/",
		"notes/mes idees":       "/notes/mes",
		"units/abc/cadre.md":    "/units/abc/cadre.md",
		"\U0001F393/Board":      "/",
	}
	for in, want := range cases {
		if got := literalPrefix(in); got != want {
			t.Errorf("literalPrefix(%q) = %q, want %q", in, got, want)
		}
	}
}

// The fixer rewrites files it did not create, in a batch, so it replaces each one instead of
// truncating it — and a replace that took the temp file's mode would silently widen every
// restricted document a rename happened to mention.
func TestWriteLinesReplacesTheFileAndKeepsItsMode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.md")
	mustWriteBytes(t, path, []byte("a much longer line than what replaces it\n"))
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := filesystem.WriteLines(path, []string{"see", "docs/new"}); err != nil {
		t.Fatalf("writeLines() = %v", err)
	}
	if got := string(mustReadBytes(t, path)); got != "see\ndocs/new\n" {
		t.Errorf("content = %q, want the rewritten lines and nothing of the old file", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %o, want the 600 the file already had", perm)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("directory holds %d entries, want only the rewritten file", len(entries))
	}
}

// A markdown scheme carries its path behind a ':' — `unit::/units/abc/abc.mlunit.json`, and the
// `template::` that is its precedent — so the ':' is a token boundary and a reference written that
// way is repaired on a rename like any other. This is what makes a unit reference maintained for
// free: a path that is not maintained rots the moment the unit moves.
func TestLinkFixRepairsASchemeReference(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md", ".json"})

	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"unit [a](unit::/units/abc/abc.mlunit.json) here\n"+
		"template [b](template::/units/abc/abc.mlunit.json) here\n"+
		"bare unit::units/abc/abc.mlunit.json here\n") // no slash, so not a link
	mustWrite(t, filepath.Join(root, "sommaire.mlunit.json"),
		"{\"members\":[\"/units/abc/abc.mlunit.json\"]}\n")

	report, err := lf.FixAfterRename("units/abc/abc.mlunit.json", "cours/abc/abc.mlunit.json")
	if err != nil {
		t.Fatal(err)
	}

	want := "" +
		"unit [a](unit::/cours/abc/abc.mlunit.json) here\n" +
		"template [b](template::/cours/abc/abc.mlunit.json) here\n" +
		"bare unit::units/abc/abc.mlunit.json here\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
	wantMembers := "{\"members\":[\"/cours/abc/abc.mlunit.json\"]}\n"
	if got := mustRead(t, filepath.Join(root, "sommaire.mlunit.json")); got != wantMembers {
		t.Errorf("members rewrite mismatch:\n got=%q\nwant=%q", got, wantMembers)
	}
	if len(report.FileChanges) != 2 {
		t.Fatalf("expected both files changed, got %+v", report.FileChanges)
	}
}

// The other half of the same rule: a deleted unit leaves the sentinel behind the scheme, so a
// reader of `unit::` sees a reference it can show as broken rather than one it will try to fetch.
func TestLinkFixTombstonesASchemeReference(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"unit [a](unit::/units/abc/abc.mlunit.json) here\n"+
		"template [b](template::/templates/fiche.temp.md) here\n")

	if _, err := lf.FixAfterDelete("units/abc"); err != nil {
		t.Fatal(err)
	}
	if _, err := lf.FixAfterDelete("templates/fiche.temp.md"); err != nil {
		t.Fatal(err)
	}

	want := "" +
		"unit [a](unit::" + DeletedSentinel + ") here\n" +
		"template [b](template::" + DeletedSentinel + ") here\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("tombstone mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// What the ':' boundary deliberately does not reach. A URL is safe not because a scheme is
// recognised — nothing here parses one — but because the byte in front of the path in
// `http://host/units/…` is the '/' that follows the host, and a '/' is no boundary, exactly as it
// is not in the legacy `/dashboard/…` form. The cases that are matched through a ':' are matched
// because they are references: a store path is a store path whether a `key:` or a `unit::` sits in
// front of it.
func TestLinkFixColonBoundaryLeavesUrlsAlone(t *testing.T) {
	const doc = "units/abc/abc.mlunit.json"
	cases := []struct {
		name       string
		line       string
		wantChange bool
	}{
		{"an http url", "see http://host/" + doc + " ok", false},
		{"an https url", "see https://host/" + doc + " ok", false},
		{"an https url with a port", "see https://host:8080/" + doc + " ok", false},
		{"a file url", "see file:///" + doc + " ok", false},
		{"a url whose host is the folder", "see http://units/abc/abc.mlunit.json ok", false},
		{"a quoted value in compact json", "{\"unit\":\"/" + doc + "\"}", true},
		{"a yaml key and value", "unit: /" + doc, true},
		{"the unit scheme", "[a](unit::/" + doc + ")", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
			mustWrite(t, filepath.Join(root, "ref.md"), c.line+"\n")

			report, err := lf.FixAfterRename(doc, "cours/abc/abc.mlunit.json")
			if err != nil {
				t.Fatal(err)
			}
			changed := mustRead(t, filepath.Join(root, "ref.md")) != c.line+"\n"
			if changed != c.wantChange {
				t.Errorf("line %q: changed=%v, want %v (report %+v)", c.line, changed, c.wantChange, report.FileChanges)
			}
			if (len(report.FileChanges) > 0) != c.wantChange {
				t.Errorf("line %q: report says %+v", c.line, report.FileChanges)
			}
		})
	}
}

// The boundary is a delimiter, not a scheme rule, and it ends a token as well as starting one: a
// ':' also stops the `/child…` suffix. So a reference to a child whose own name carries a ':' is
// tombstoned up to that ':' and no further — the reference is still marked deleted, and the tail of
// a name no filesystem the store runs on would accept is what is left standing.
func TestLinkFixColonEndsAChildSuffix(t *testing.T) {
	root := t.TempDir()
	lf := NewLinkFixer(&pkgFilesystem.Storage{Root: root}, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), ""+
		"trailing see /units/abc/cadre.md: it moved\n"+
		"child [a](/docs/old/my:file.md) here\n")

	if _, err := lf.FixAfterRename("units/abc/cadre.md", "units/abc/contexte.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := lf.FixAfterDelete("docs/old"); err != nil {
		t.Fatal(err)
	}

	want := "" +
		"trailing see /units/abc/contexte.md: it moved\n" +
		"child [a](" + DeletedSentinel + ":file.md) here\n"
	if got := mustRead(t, filepath.Join(root, "ref.md")); got != want {
		t.Errorf("rewrite mismatch:\n got=%q\nwant=%q", got, want)
	}
}
