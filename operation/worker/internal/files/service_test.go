package files

import (
	"archive/zip"
	"bytes"
	"errors"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func newTestService(root string) *FileService {
	storage := &core.Storage{Root: root}
	return newFileService(storage, newLinkFixer(storage, []string{".md", ".txt"}))
}

// ── storeInfo ─────────────────────────────────────────────────────────────────

// A deployment may configure the root as a relative path; the reported one is still absolute,
// because a client hands it to a terminal or an editor whose working directory is not this one.
func TestStoreInfoResolvesARelativeRoot(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	if err := os.Mkdir("store", 0o755); err != nil {
		t.Fatal(err)
	}

	got := newTestService("store").storeInfo().RootPath
	if !filepath.IsAbs(got) {
		t.Fatalf("rootPath = %q, want an absolute path", got)
	}
	// t.TempDir() can sit behind a symlink (/tmp → /private/tmp), which Abs does not resolve;
	// comparing the resolved forms keeps the assertion about the root, not about /tmp.
	want, err := filepath.EvalSymlinks(filepath.Join(root, "store"))
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(got)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != want {
		t.Errorf("rootPath = %q, want %q", resolved, want)
	}
}

// ── list ──────────────────────────────────────────────────────────────────────

func TestListHidesSubsidiaryAndFlagsIndexed(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	mustWrite(t, filepath.Join(root, "a.pdf"), "pdf\n")
	mustWrite(t, filepath.Join(root, "a.pdf.index.txt"), "extracted text\n") // subsidiary -> hidden
	mustWrite(t, filepath.Join(root, "b.pdf"), "pdf\n")                      // no index
	mustWrite(t, filepath.Join(root, "notes.blog.md"), "blog\n")             // orphan subsidiary -> shown

	entries, err := svc.list("")
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]FileDto{}
	for _, e := range entries {
		byPath[e.Path] = e
	}
	if _, hidden := byPath["a.pdf.index.txt"]; hidden {
		t.Errorf("a.pdf.index.txt should be hidden because a.pdf is present")
	}
	if len(entries) != 3 {
		t.Fatalf("list count = %d, want 3 (a.pdf, b.pdf, notes.blog.md): %+v", len(entries), entries)
	}
	if !byPath["a.pdf"].Indexed {
		t.Errorf("a.pdf should be flagged Indexed (has .index.txt)")
	}
	if byPath["b.pdf"].Indexed {
		t.Errorf("b.pdf should not be Indexed")
	}
	if _, ok := byPath["notes.blog.md"]; !ok {
		t.Errorf("orphan notes.blog.md should be listed")
	}
}

func TestListSortsCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "Banana.md"), "x\n")
	mustWrite(t, filepath.Join(root, "apple.md"), "x\n")
	mustWrite(t, filepath.Join(root, "Cherry.md"), "x\n")

	entries, err := svc.list("")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range entries {
		got = append(got, e.Path)
	}
	want := []string{"apple.md", "Banana.md", "Cherry.md"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("list order = %v, want %v", got, want)
	}
}

// ── search ────────────────────────────────────────────────────────────────────

// mustSearch runs a query and fails the test on error, so a case that is only interested in the
// hits does not have to unpack three return values.
func mustSearch(t *testing.T, svc *FileService, dir, query string) []SearchDto {
	t.Helper()
	res, _, err := svc.search(dir, query)
	if err != nil {
		t.Fatalf("search(%q, %q): %v", dir, query, err)
	}
	return res
}

// searchPaths is mustSearch reduced to the paths that matched, sorted, for a case about which files
// a walk reached rather than about what was found in them.
func searchPaths(t *testing.T, svc *FileService, dir, query string) []string {
	t.Helper()
	var out []string
	for _, r := range mustSearch(t, svc, dir, query) {
		out = append(out, r.File)
	}
	sort.Strings(out)
	return out
}

// TestSearchRegexWordBoundary covers what replaced the old whole-word toggle: a word term is a
// substring, and \b in a regex term is how you ask for the stricter reading.
func TestSearchRegexWordBoundary(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "w.md"), "category catalog\n") // no standalone "cat"

	if res := mustSearch(t, svc, "", `/\bcat\b/`); len(res) != 0 {
		t.Errorf(`/\bcat\b/ should not match 'category catalog': %+v`, res)
	}
	if res := mustSearch(t, svc, "", "cat"); len(res) != 1 {
		t.Errorf("the word 'cat' is a substring, it should match: %+v", res)
	}
}

func TestSearchRegexTerm(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "r.md"), "hello world\n")

	if res := mustSearch(t, svc, "", "/h.llo/"); len(res) != 1 {
		t.Errorf("regex /h.llo/ should match 'hello': %+v", res)
	}
	// The same text as a bare word is a literal, so the dot matches nothing here.
	if res := mustSearch(t, svc, "", "h.llo"); len(res) != 0 {
		t.Errorf("the word 'h.llo' should not match 'hello': %+v", res)
	}
}

func TestSearchInvalidRegex(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "r.md"), "text\n")

	_, _, err := svc.search("", "/[/")
	if !errors.Is(err, errBadPattern) {
		t.Errorf("an uncompilable regex should return errBadPattern, got %v", err)
	}
}

// The store declaration bounds a search the way it bounds the passes that rewrite: a folder nobody
// pointed the walk at is not walked. A [refactor] rule says nothing about it, and the folder
// searched is searched whole whatever the declaration says about it — which is what keeps an
// exclusion from being a folder nobody can ever look inside.
func TestSearchHonoursTheStoreDeclaration(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, kiaoFilesName), "vendor\n[search]\narchive\n[refactor]\nfixtures\n")
	mustWrite(t, filepath.Join(root, "notes.md"), "findme\n")
	mustWrite(t, filepath.Join(root, "fixtures", "f.md"), "findme\n") // [refactor] only
	mustWrite(t, filepath.Join(root, "vendor", "v.md"), "findme\n")   // before any section
	mustWrite(t, filepath.Join(root, "archive", "a.md"), "findme\n")  // [search]
	mustWrite(t, filepath.Join(root, "archive", "deep", "d.md"), "findme\n")

	got := searchPaths(t, svc, "", "findme")
	want := []string{"fixtures/f.md", "notes.md"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("search from the root = %v, want %v", got, want)
	}

	// Aimed at the excluded folder, the whole of it answers: the exemption reaches the subtree, or
	// it would only have moved the refusal one level down.
	got = searchPaths(t, svc, "archive", "findme")
	want = []string{"archive/a.md", "archive/deep/d.md"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("search of the excluded folder itself = %v, want %v", got, want)
	}
	if got := searchPaths(t, svc, "vendor", "findme"); !reflect.DeepEqual(got, []string{"vendor/v.md"}) {
		t.Errorf("search of the excluded folder itself = %v, want [vendor/v.md]", got)
	}
}

// A store with no declaration of its own is bounded by the seeded defaults, and a folder that
// carries its own is honoured from the folder down — which is what lets a store hold a repository
// that answers for itself. Both are found by the walk, one directory listing at a time.
func TestSearchHonoursTheDefaultsAndNestedDeclarations(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "notes.md"), "findme\n")
	mustWrite(t, filepath.Join(root, "build", "gen.md"), "findme\n") // a seeded default
	mustWrite(t, filepath.Join(root, "repo", kiaoFilesName), "[search]\ngenerated\n")
	mustWrite(t, filepath.Join(root, "repo", "src.md"), "findme\n")
	mustWrite(t, filepath.Join(root, "repo", "generated", "g.md"), "findme\n")
	// A sibling of the declaring folder, sorted after it and holding the same folder name: what
	// repo declared covers repo, and nothing that merely looks like it elsewhere.
	mustWrite(t, filepath.Join(root, "units", "generated", "u.md"), "findme\n")

	got := searchPaths(t, svc, "", "findme")
	want := []string{"notes.md", "repo/src.md", "units/generated/u.md"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("search = %v, want %v", got, want)
	}
}

// TestSearchEmptyQueryDoesNotIndex pins the early return that sits in front of the indexing walk:
// an empty query must cost nothing, not a full tree walk with PDF/OOXML extraction.
func TestSearchEmptyQueryDoesNotIndex(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWriteZipDoc(t, filepath.Join(root, "runbook.docx"), map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>text</w:t></w:r></w:p></w:body></w:document>`,
	})

	for _, q := range []string{"", "   ", `""`} {
		if res := mustSearch(t, svc, "", q); len(res) != 0 {
			t.Errorf("query %q should return nothing, got %+v", q, res)
		}
	}
	if fileExists(filepath.Join(root, "runbook.docx.index.txt")) {
		t.Error("an empty query should not have triggered the indexing walk")
	}
}

// TestSearchSkipsLargeFileContent: past the cap a file's content is not read, but its name is still
// matched — which is the only way an image or an oversized document is findable at all.
func TestSearchSkipsLargeFileContent(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	// A file larger than the 1 MiB scan cap that nonetheless contains the query.
	big := append(bytes.Repeat([]byte("filler line\n"), 100000), []byte("findme\n")...)
	if len(big) <= 1024*1024 {
		t.Fatalf("fixture not large enough: %d bytes", len(big))
	}
	mustWriteBytes(t, filepath.Join(root, "big.md"), big)
	mustWrite(t, filepath.Join(root, "small.md"), "findme here\n")

	res := mustSearch(t, svc, "", "findme")
	if len(res) != 1 || res[0].File != "small.md" {
		t.Errorf("the large file's content should be skipped; only small.md matches: %+v", res)
	}
	if res := mustSearch(t, svc, "", "big"); len(res) != 1 || res[0].File != "big.md" {
		t.Errorf("the large file should still be findable by name: %+v", res)
	}
}

// TestSearchMatchesNamesAndBinaries: a term is offered the file name as well as the content, so a
// file whose bytes search cannot read is still reachable.
func TestSearchMatchesNamesAndBinaries(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWriteBytes(t, filepath.Join(root, "diagram.png"), []byte{0x89, 'P', 'N', 'G', 0x00, 0xff, 0xfe})
	mustWrite(t, filepath.Join(root, "notes.md"), "see the diagram\n")

	res := mustSearch(t, svc, "", "diagram")
	if len(res) != 2 {
		t.Fatalf("both the named file and the mentioning file should match: %+v", res)
	}
	byFile := map[string][]SearchMatch{}
	for _, r := range res {
		byFile[r.File] = r.Matches
	}
	if m, ok := byFile["diagram.png"]; !ok || len(m) != 0 {
		t.Errorf("the binary should match on its name alone, with no lines: %+v", byFile)
	}
	if m := byFile["notes.md"]; len(m) != 1 || m[0].Line != 1 {
		t.Errorf("the content hit should carry its line: %+v", m)
	}
}

// TestSearchRequiresEveryTermInTheSameFile is the headline behaviour of the query language: the AND
// is satisfied at document level, so the words may sit on different lines.
func TestSearchRequiresEveryTermInTheSameFile(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "both.md"), "alpha here\nfiller\nand beta\n")
	mustWrite(t, filepath.Join(root, "one.md"), "alpha only\n")

	res := mustSearch(t, svc, "", "alpha beta")
	if len(res) != 1 || res[0].File != "both.md" {
		t.Fatalf("only the file holding both words should match: %+v", res)
	}
	if len(res[0].Matches) != 2 || res[0].Matches[0].Line != 1 || res[0].Matches[1].Line != 3 {
		t.Errorf("both matching lines should be reported: %+v", res[0].Matches)
	}
}

func TestSearchPhraseIsCaseSensitive(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "a.md"), "Hello World\n")
	mustWrite(t, filepath.Join(root, "b.md"), "hello world\n")

	if res := mustSearch(t, svc, "", `"Hello World"`); len(res) != 1 || res[0].File != "a.md" {
		t.Errorf("a phrase should match its exact case only: %+v", res)
	}
	if res := mustSearch(t, svc, "", "hello world"); len(res) != 2 {
		t.Errorf("bare words ignore case, both files should match: %+v", res)
	}
}

func TestSearchNegation(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "clean.md"), "the plan\n")
	mustWrite(t, filepath.Join(root, "dirty.md"), "the plan\nstill a draft\n")

	res := mustSearch(t, svc, "", "plan -draft")
	if len(res) != 1 || res[0].File != "clean.md" {
		t.Errorf("the excluded word should remove dirty.md: %+v", res)
	}
	if _, _, err := svc.search("", "-draft"); !errors.Is(err, errBadPattern) {
		t.Errorf("a query of only negations should be refused, got %v", err)
	}
}

// TestSearchSkipsDotDirsAndNodeModules matters in production, where the storage root is the git
// work tree: without the skip every search walks .git.
func TestSearchSkipsDotDirsAndNodeModules(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	for _, rel := range []string{".git/config", ".kiao/migrations.json", "node_modules/p/readme.md", "sub/visible.md"} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, p, "needle\n")
	}

	res := mustSearch(t, svc, "", "needle")
	if len(res) != 1 || res[0].File != "sub/visible.md" {
		t.Errorf("only content should be searched, got %+v", res)
	}
}

func TestSearchTruncatesAtTheResultCap(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	for i := 0; i < maxSearchResults+10; i++ {
		mustWrite(t, filepath.Join(root, "f"+strconv.Itoa(i)+".md"), "needle\n")
	}

	res, truncated, err := svc.search("", "needle")
	if err != nil {
		t.Fatal(err)
	}
	if !truncated || len(res) != maxSearchResults {
		t.Errorf("got %d results truncated=%v, want %d and truncated", len(res), truncated, maxSearchResults)
	}
}

// TestSearchRewritesIndexPath verifies a hit inside a "<file>.index.txt" (or .index.md) is
// reported against the original file name, and the indexed original is itself skipped.
func TestSearchRewritesIndexPath(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "report.pdf"), "binary-ish pdf bytes\n")
	mustWrite(t, filepath.Join(root, "report.pdf.index.txt"), "the needle is here\n")

	res := mustSearch(t, svc, "", "needle")
	if len(res) != 1 {
		t.Fatalf("expected 1 result, got %+v", res)
	}
	if res[0].File != "report.pdf" {
		t.Errorf("index hit should be reported as report.pdf, got %q", res[0].File)
	}
	// A name term sees the original too, never the ".index.txt" that was actually scanned.
	if res := mustSearch(t, svc, "", "report.pdf"); len(res) != 1 || res[0].File != "report.pdf" {
		t.Errorf("the index should be matched under its source's name: %+v", res)
	}
	if res := mustSearch(t, svc, "", "index.txt"); len(res) != 0 {
		t.Errorf("the index file's own name should never be searchable: %+v", res)
	}

	// Same via a .index.md companion.
	root2 := t.TempDir()
	svc2 := newTestService(root2)
	mustWrite(t, filepath.Join(root2, "paper.pdf"), "bytes\n")
	mustWrite(t, filepath.Join(root2, "paper.pdf.index.md"), "the needle is here\n")
	res = mustSearch(t, svc2, "", "needle")
	if len(res) != 1 || res[0].File != "paper.pdf" {
		t.Errorf(".index.md hit should be reported as paper.pdf, got %+v", res)
	}
}

// TestSearchIndexesOfficeDocuments covers the whole loop for a document search cannot read
// directly: pass 1 extracts its text into a sibling index, pass 2 scans that index, and the hit
// is reported against the original file.
func TestSearchIndexesOfficeDocuments(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	mustWriteZipDoc(t, filepath.Join(root, "runbook.docx"), map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>the needle is in the runbook</w:t></w:r></w:p></w:body></w:document>`,
	})
	mustWriteZipDoc(t, filepath.Join(root, "budget.xlsx"), xlsxEntries())

	res := mustSearch(t, svc, "", "needle")
	if len(res) != 1 {
		t.Fatalf("expected 1 result, got %+v", res)
	}
	if res[0].File != "runbook.docx" {
		t.Errorf("hit should be reported as runbook.docx, got %q", res[0].File)
	}
	if !fileExists(filepath.Join(root, "runbook.docx.index.md")) {
		t.Errorf("search should have created runbook.docx.index.md")
	}

	// A spreadsheet hit reports the whole row, because the index is one record per row.
	res = mustSearch(t, svc, "", "Widget")
	if len(res) != 1 || res[0].File != "budget.xlsx" {
		t.Fatalf("expected a budget.xlsx hit, got %+v", res)
	}
	if !strings.Contains(res[0].Matches[0].Content, "42") {
		t.Errorf("row hit lost its sibling cells: %q", res[0].Matches[0].Content)
	}
}

// TestSearchScansLargeIndexFiles pins the size-cap exemption: an index is extracted text this
// service wrote, so it must stay searchable past the cap that protects search from large
// uploaded binaries. Without the exemption a long document would be indexed and then ignored.
func TestSearchScansLargeIndexFiles(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	big := append(bytes.Repeat([]byte("filler line\n"), (maxSearchFileBytes/12)+1), []byte("the needle is here\n")...)
	mustWrite(t, filepath.Join(root, "manual.pdf"), "binary-ish pdf bytes\n")
	mustWriteBytes(t, filepath.Join(root, "manual.pdf.index.txt"), big)
	// A plain file of the same size stays subject to the cap.
	mustWriteBytes(t, filepath.Join(root, "plain.md"), big)

	res := mustSearch(t, svc, "", "needle")
	if len(res) != 1 {
		t.Fatalf("expected only the index hit, got %+v", res)
	}
	if res[0].File != "manual.pdf" {
		t.Errorf("hit should be reported as manual.pdf, got %q", res[0].File)
	}
}

func TestSearchNonDirectoryErrors(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "f.md"), "x\n")
	if _, _, err := svc.search("f.md", "x"); err == nil {
		t.Errorf("search on a file path should error (not a directory)")
	}
}

// ── determineContentType ──────────────────────────────────────────────────────

func TestDetermineContentType(t *testing.T) {
	svc := &FileService{}

	// Video fallbacks (returned either by the system mime table or the explicit switch).
	video := map[string]string{
		"clip.mp4":  "video/mp4",
		"clip.webm": "video/webm",
		"clip.mov":  "video/quicktime",
		"clip.mkv":  "video/x-matroska",
	}
	for name, want := range video {
		if got := svc.determineContentType(name); got != want {
			t.Errorf("determineContentType(%q) = %q, want %q", name, got, want)
		}
	}
	// Extension match is case-insensitive.
	if got := svc.determineContentType("CLIP.MP4"); got != "video/mp4" {
		t.Errorf("determineContentType(CLIP.MP4) = %q, want video/mp4", got)
	}

	// Audio fallbacks. None of these extensions is in Go's builtin table, so on the Alpine image —
	// which carries no /etc/mime.types either — the switch is the only thing standing between an
	// episode and application/octet-stream. A host that does have a system table answers from it,
	// which is why only the family is asserted beyond the one type both agree on.
	if got := svc.determineContentType("episode.mp3"); got != "audio/mpeg" {
		t.Errorf("determineContentType(episode.mp3) = %q, want audio/mpeg", got)
	}
	for _, name := range []string{"a.m4a", "a.aac", "a.ogg", "a.oga", "a.opus", "a.flac", "a.wav"} {
		if got := svc.determineContentType(name); !strings.HasPrefix(got, "audio/") {
			t.Errorf("determineContentType(%q) = %q, want an audio/* type", name, got)
		}
	}

	// Unknown extension and no extension fall back to octet-stream.
	if got := svc.determineContentType("data.unknownext"); got != "application/octet-stream" {
		t.Errorf("unknown ext = %q, want application/octet-stream", got)
	}
	if got := svc.determineContentType("noextension"); got != "application/octet-stream" {
		t.Errorf("no ext = %q, want application/octet-stream", got)
	}

	// Well-known types come from Go's built-in mime table (charset suffixes tolerated).
	for name, prefix := range map[string]string{
		"page.html": "text/html",
		"pic.png":   "image/png",
		"data.json": "application/json",
		"doc.pdf":   "application/pdf",
	} {
		if got := svc.determineContentType(name); !strings.HasPrefix(got, prefix) {
			t.Errorf("determineContentType(%q) = %q, want prefix %q", name, got, prefix)
		}
	}
}

// ── deleteBatch & moveBatch ──────────────────────────────────────────────────

func TestDeleteBatch(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "file1.md"), "content 1\n")
	mustWrite(t, filepath.Join(root, "file2.md"), "content 2\n")

	reports, err := svc.deleteBatch([]string{"file1.md", "file2.md"})
	if err != nil {
		t.Fatalf("deleteBatch error: %v", err)
	}
	if len(reports) != 2 {
		t.Errorf("expected 2 reports, got %d", len(reports))
	}
	if fileExists(filepath.Join(root, "file1.md")) || fileExists(filepath.Join(root, "file2.md")) {
		t.Errorf("files should be deleted")
	}
}

func TestMoveBatch(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "file1.md"), "content 1\n")
	mustWrite(t, filepath.Join(root, "file2.md"), "content 2\n")
	if err := svc.createFolder("dest"); err != nil {
		t.Fatal(err)
	}

	req := MoveBatchRequestDto{
		Paths:        []string{"file1.md", "file2.md"},
		TargetFolder: "dest",
	}
	reports, err := svc.moveBatch(req)
	if err != nil {
		t.Fatalf("moveBatch error: %v", err)
	}
	if len(reports) != 2 {
		t.Errorf("expected 2 reports, got %d", len(reports))
	}
	if !fileExists(filepath.Join(root, "dest", "file1.md")) || !fileExists(filepath.Join(root, "dest", "file2.md")) {
		t.Errorf("files should be moved to dest")
	}
}

// TestDeleteBatchFixesLinksToEveryPath keeps the batch's single link-fix pass covering all of it:
// each deleted path must still be replaced by the sentinel wherever it is referenced, and the
// report for each path must name the file it was fixed in.
func TestDeleteBatchFixesLinksToEveryPath(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "doomed", "one.md"), "one\n")
	mustWrite(t, filepath.Join(root, "doomed", "two.md"), "two\n")
	mustWrite(t, filepath.Join(root, "index.md"), "- [1](/doomed/one.md)\n- [2](/doomed/two.md)\n")

	reports, err := svc.deleteBatch([]string{"doomed/one.md", "doomed/two.md"})
	if err != nil {
		t.Fatalf("deleteBatch error: %v", err)
	}
	want := "- [1](" + deletedSentinel + ")\n- [2](" + deletedSentinel + ")\n"
	if got := mustRead(t, filepath.Join(root, "index.md")); got != want {
		t.Errorf("index.md:\n got=%q\nwant=%q", got, want)
	}
	for i, rep := range reports {
		if len(rep.FileChanges) != 1 || rep.FileChanges[0].FilePath != "index.md" {
			t.Errorf("report %d file changes = %+v, want index.md", i, rep.FileChanges)
		}
	}
}

// TestMoveBatchFixesLinksToEveryPath is the same guarantee for a move.
func TestMoveBatchFixesLinksToEveryPath(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "one.md"), "one\n")
	mustWrite(t, filepath.Join(root, "two.md"), "two\n")
	mustWrite(t, filepath.Join(root, "index.md"), "- [1](/one.md)\n- [2](/two.md)\n")
	if err := svc.createFolder("dest"); err != nil {
		t.Fatal(err)
	}

	reports, err := svc.moveBatch(MoveBatchRequestDto{
		Paths:        []string{"one.md", "two.md"},
		TargetFolder: "dest",
	})
	if err != nil {
		t.Fatalf("moveBatch error: %v", err)
	}
	want := "- [1](/dest/one.md)\n- [2](/dest/two.md)\n"
	if got := mustRead(t, filepath.Join(root, "index.md")); got != want {
		t.Errorf("index.md:\n got=%q\nwant=%q", got, want)
	}
	for i, rep := range reports {
		if len(rep.FileChanges) != 1 || rep.FileChanges[0].FilePath != "index.md" {
			t.Errorf("report %d file changes = %+v, want index.md", i, rep.FileChanges)
		}
	}
}

// ── copyBatch ────────────────────────────────────────────────────────────────

func TestCopyBatchIntoTargetFolder(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "file1.md"), "content 1\n")
	mustWrite(t, filepath.Join(root, "file2.md"), "content 2\n")
	if err := svc.createFolder("dest"); err != nil {
		t.Fatal(err)
	}

	results, err := svc.copyBatch(CopyBatchRequestDto{
		Paths:        []string{"file1.md", "file2.md"},
		TargetFolder: "dest",
	})
	if err != nil {
		t.Fatalf("copyBatch error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].To != "dest/file1.md" || results[1].To != "dest/file2.md" {
		t.Errorf("unexpected destinations: %+v", results)
	}
	for _, rel := range []string{"file1.md", "file2.md", "dest/file1.md", "dest/file2.md"} {
		if !fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
			t.Errorf("%s should exist", rel)
		}
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "dest", "file1.md"))); got != "content 1\n" {
		t.Errorf("copied content = %q", got)
	}
}

func TestCopyBatchCopiesWholeDirectoryTree(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "A\n")
	mustWrite(t, filepath.Join(root, "src", "sub", "b.txt"), "B\n")
	if err := svc.createFolder("dest"); err != nil {
		t.Fatal(err)
	}

	results, err := svc.copyBatch(CopyBatchRequestDto{Paths: []string{"src"}, TargetFolder: "dest"})
	if err != nil {
		t.Fatalf("copyBatch error: %v", err)
	}
	if len(results) != 1 || results[0].To != "dest/src" {
		t.Fatalf("unexpected results: %+v", results)
	}
	for _, rel := range []string{"dest/src/a.txt", "dest/src/sub/b.txt", "src/a.txt", "src/sub/b.txt"} {
		if !fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
			t.Errorf("%s should exist", rel)
		}
	}
}

func TestCopyBatchResolvesNameCollisions(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "src", "note.md"), "N\n")

	// Pasting into the source's own folder duplicates rather than being skipped.
	for i, want := range []string{"src/note (copy).md", "src/note (copy 2).md"} {
		results, err := svc.copyBatch(CopyBatchRequestDto{Paths: []string{"src/note.md"}, TargetFolder: "src"})
		if err != nil {
			t.Fatalf("copyBatch %d error: %v", i, err)
		}
		if results[0].To != want {
			t.Fatalf("copy %d landed at %q, want %q", i, results[0].To, want)
		}
		if !fileExists(filepath.Join(root, filepath.FromSlash(want))) {
			t.Errorf("%s should exist", want)
		}
	}
}

func TestCopyBatchRefusesDestinationInsideSource(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "A\n")

	_, err := svc.copyBatch(CopyBatchRequestDto{Paths: []string{"src"}, TargetFolder: "src"})
	if !errors.Is(err, errCopyIntoSelf) {
		t.Fatalf("expected errCopyIntoSelf, got %v", err)
	}
	if fileExists(filepath.Join(root, "src", "src")) {
		t.Errorf("nothing should have been written")
	}
}

func TestCopyBatchCopiesSubsidiaries(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "a.pdf"), "pdf\n")
	mustWrite(t, filepath.Join(root, "a.pdf.index.txt"), "extracted\n")
	if err := svc.createFolder("dest"); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.copyBatch(CopyBatchRequestDto{Paths: []string{"a.pdf"}, TargetFolder: "dest"}); err != nil {
		t.Fatalf("copyBatch error: %v", err)
	}
	if !fileExists(filepath.Join(root, "dest", "a.pdf.index.txt")) {
		t.Errorf("subsidiary should have been copied alongside its main file")
	}
	if !fileExists(filepath.Join(root, "a.pdf.index.txt")) {
		t.Errorf("original subsidiary should be untouched")
	}
}

func TestCopyBatchExplicitItems(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "A\n")

	results, err := svc.copyBatch(CopyBatchRequestDto{Items: []MoveItemDto{{From: "src/a.txt", To: "renamed.txt"}}})
	if err != nil {
		t.Fatalf("copyBatch error: %v", err)
	}
	if len(results) != 1 || results[0].To != "renamed.txt" {
		t.Fatalf("unexpected results: %+v", results)
	}
	if !fileExists(filepath.Join(root, "renamed.txt")) {
		t.Errorf("renamed.txt should exist")
	}
}

func TestCopyBatchMissingSourceIsNotFound(t *testing.T) {
	svc := newTestService(t.TempDir())

	_, err := svc.copyBatch(CopyBatchRequestDto{Paths: []string{"nope.txt"}, TargetFolder: "dest"})
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected os.ErrNotExist, got %v", err)
	}
}

func TestInsertCopySuffix(t *testing.T) {
	for _, tc := range []struct {
		name string
		n    int
		want string
	}{
		{"file.txt", 1, "file (copy).txt"},
		{"file.txt", 2, "file (copy 2).txt"},
		{"README", 1, "README (copy)"},
		{".env", 1, ".env (copy)"},   // a dotfile's leading dot is not an extension
		{"a.b.c", 1, "a.b (copy).c"}, // only the last dot counts
	} {
		if got := insertCopySuffix(tc.name, tc.n); got != tc.want {
			t.Errorf("insertCopySuffix(%q, %d) = %q, want %q", tc.name, tc.n, got, tc.want)
		}
	}
}

func TestCopyWouldRecurse(t *testing.T) {
	for _, tc := range []struct {
		from, to string
		want     bool
	}{
		{"src", "src/src", true},
		{"src", "src/deep/nested/src", true},
		{"src", "src", true},
		{"/src/", "src/src", true}, // normalised before comparing
		{"src", "dest/src", false},
		{"src", "srcx/src", false}, // prefix match must respect the segment boundary
		{"src/a.txt", "dest/a.txt", false},
		{"", "anything", true}, // the storage root contains every destination
	} {
		if got := copyWouldRecurse(tc.from, tc.to); got != tc.want {
			t.Errorf("copyWouldRecurse(%q, %q) = %v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
}

// A zip of the store root is an archive the user hands on. The state directory sits in that root
// now, so the walk has to leave it out — it holds the migration ledger and verbatim prompt text.
func TestZipFolderLeavesTheStateDirectoryOut(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root, StateDir: ".kiao-config"}
	svc := newFileService(storage, newLinkFixer(storage, []string{".md"}))
	mustWrite(t, filepath.Join(root, ".kiao-config", "conversations", "c1.json"), `{"prompt":"secret"}`)
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello\n")

	var buf bytes.Buffer
	if err := svc.zipFolder("", &buf); err != nil {
		t.Fatalf("zipFolder: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("reading the archive: %v", err)
	}
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if len(names) != 1 || names[0] != "welcome.md" {
		t.Errorf("archive holds %v, want welcome.md alone", names)
	}
}

// TestDeleteBatchFixesLinksForWhatWentBeforeItFailed pins that aborting the batch does not leave
// references pointing at files that are already gone.
func TestDeleteBatchFixesLinksForWhatWentBeforeItFailed(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "gone.md"), "gone\n")
	mustWrite(t, filepath.Join(root, "index.md"), "- [g](/gone.md)\n")

	// "../escape" is outside the root, so removeOne rejects it and the batch aborts.
	_, err := svc.deleteBatch([]string{"gone.md", "../escape"})
	if err == nil {
		t.Fatal("expected the batch to fail on a path outside the root")
	}
	if fileExists(filepath.Join(root, "gone.md")) {
		t.Error("the first path should still have been deleted")
	}
	want := "- [g](" + deletedSentinel + ")\n"
	if got := mustRead(t, filepath.Join(root, "index.md")); got != want {
		t.Errorf("index.md:\n got=%q\nwant=%q", got, want)
	}
}

// TestPathsCoveredByAnAncestor pins which paths a batch can skip removing because another path in
// the same batch takes them recursively.
func TestPathsCoveredByAnAncestor(t *testing.T) {
	cases := []struct {
		name  string
		paths []string
		want  []bool
	}{
		{
			// The shape Dashboard sends: every descendant, then the folder.
			"descendants of a folder in the batch",
			[]string{"d/a.md", "d/sub/b.md", "d/sub", "d"},
			[]bool{true, true, true, false},
		},
		{"unrelated siblings", []string{"a.md", "b.md"}, []bool{false, false}},
		{"a child without its parent", []string{"d/a.md"}, []bool{false}},
		{"a duplicate does not cover itself", []string{"a.md", "a.md"}, []bool{false, false}},
		{"leading and trailing slashes still match", []string{"/d/a.md", "d/"}, []bool{true, false}},
		{"a deep descendant of a shallow ancestor", []string{"d/x/y/z.md", "d"}, []bool{true, false}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := pathsCoveredByAnAncestor(c.paths)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("pathsCoveredByAnAncestor(%q) = %v, want %v", c.paths, got, c.want)
			}
		})
	}
}

// TestDeleteBatchOfAFolderAndItsDescendants is the end-to-end guarantee: everything goes, and every
// requested path still gets a report and still has its references fixed.
func TestDeleteBatchOfAFolderAndItsDescendants(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "d", "a.md"), "a\n")
	mustWrite(t, filepath.Join(root, "d", "sub", "b.md"), "b\n")
	mustWrite(t, filepath.Join(root, "d", "a.md.config.json"), "{}\n")
	mustWrite(t, filepath.Join(root, "index.md"), "- [a](/d/a.md)\n- [b](/d/sub/b.md)\n- [folder](/d)\n")

	// Files first, then directories deepest-first — exactly what the client sends.
	reports, err := svc.deleteBatch([]string{"d/a.md", "d/sub/b.md", "d/sub", "d"})
	if err != nil {
		t.Fatalf("deleteBatch error: %v", err)
	}
	if len(reports) != 4 {
		t.Errorf("expected one report per requested path, got %d", len(reports))
	}
	if fileExists(filepath.Join(root, "d")) {
		t.Error("the folder should be gone")
	}
	want := "- [a](" + deletedSentinel + ")\n- [b](" + deletedSentinel + ")\n- [folder](" + deletedSentinel + ")\n"
	if got := mustRead(t, filepath.Join(root, "index.md")); got != want {
		t.Errorf("index.md:\n got=%q\nwant=%q", got, want)
	}
}

// TestDeleteBatchStillRemovesSidecarsOfAnUncoveredFile keeps the skip from swallowing the
// subsidiary/sidecar cleanup for a file deleted on its own.
func TestDeleteBatchStillRemovesSidecarsOfAnUncoveredFile(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "a.md"), "a\n")
	mustWrite(t, filepath.Join(root, "a.md.config.json"), "{}\n")
	mustWrite(t, filepath.Join(root, "a.md.index.txt"), "idx\n")

	if _, err := svc.deleteBatch([]string{"a.md"}); err != nil {
		t.Fatal(err)
	}
	for _, leftover := range []string{"a.md", "a.md.config.json", "a.md.index.txt"} {
		if fileExists(filepath.Join(root, leftover)) {
			t.Errorf("%s should have been deleted", leftover)
		}
	}
}

// A folder and its descendants in one batch cost what the folder costs: the descendants are removed
// by the folder's own recursive removal, and their references are rewritten by the folder's own
// link-fix operation, because a path token carries its child suffix. The response still holds one
// report per requested path, so the wire shape does not depend on the shape of the batch.
func TestDeleteBatchCollapsesDescendantsIntoTheirFolder(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "doomed", "one.md"), "one\n")
	mustWrite(t, filepath.Join(root, "doomed", "deep", "two.md"), "two\n")
	mustWrite(t, filepath.Join(root, "index.md"),
		"- [1](/doomed/one.md)\n- [2](/doomed/deep/two.md)\n- [f](/doomed)\n")

	paths := []string{"doomed/one.md", "doomed/deep/two.md", "doomed/deep", "doomed"}
	reports, err := svc.deleteBatch(paths)
	if err != nil {
		t.Fatalf("deleteBatch error: %v", err)
	}
	if len(reports) != len(paths) {
		t.Fatalf("reports = %d, want one per requested path (%d)", len(reports), len(paths))
	}
	want := "- [1](" + deletedSentinel + ")\n- [2](" + deletedSentinel + ")\n- [f](" + deletedSentinel + ")\n"
	if got := mustRead(t, filepath.Join(root, "index.md")); got != want {
		t.Errorf("index.md:\n got=%q\nwant=%q", got, want)
	}
	if fileExists(filepath.Join(root, "doomed")) {
		t.Error("the folder survived the batch")
	}
	// The folder is the only path that did any rewriting; the ones it covers report nothing,
	// which is where their references were actually fixed.
	if n := len(reports[3].FileChanges); n != 1 {
		t.Errorf("the folder's report has %d file changes, want 1", n)
	}
	for i := 0; i < 3; i++ {
		if n := len(reports[i].FileChanges); n != 0 {
			t.Errorf("report %d (%s) has %d file changes, want none — its ancestor did the work",
				i, paths[i], n)
		}
		if reports[i].OriginalPath != paths[i] || reports[i].Operation != "DELETE" {
			t.Errorf("report %d = %+v, want it to name %s", i, reports[i], paths[i])
		}
	}
}

// listRecursive is what a client asks instead of walking the store one round trip per directory.
// It describes the scope the way the browser shows it: a subsidiary is hidden beside its main file,
// a settings sidecar is not — and both go when the main file does.
func TestListRecursiveDescribesTheWholeScope(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "folder", "a.md"), "a\n")
	mustWrite(t, filepath.Join(root, "folder", "deep", "b.md"), "b\n")
	mustWrite(t, filepath.Join(root, "folder", "a.md.index.md"), "idx\n")   // subsidiary: hidden
	mustWrite(t, filepath.Join(root, "folder", "a.md.config.json"), "{}\n") // sidecar: shown
	mustWrite(t, filepath.Join(root, "loose.md"), "l\n")

	files, truncated, err := svc.listRecursive([]string{"folder", "folder/a.md", "loose.md", "gone.md"})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	if truncated {
		t.Error("truncated = true for a scope well under the cap")
	}
	got := make([]string, 0, len(files))
	for _, f := range files {
		got = append(got, f.Path)
	}
	want := []string{"folder", "folder/a.md", "folder/a.md.config.json", "folder/deep", "folder/deep/b.md", "loose.md"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("scope = %v, want %v", got, want)
	}
}

// Describing a delete must not send the walk somewhere nobody pointed it: a declared folder is
// listed — it does go with the delete — and its contents are left uncounted. Named directly it is
// described in full, like anything else that was asked for by name.
func TestListRecursiveListsADeclaredFolderWithoutWalkingIt(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, kiaoFilesName), "[search]\nvendor\n")
	mustWrite(t, filepath.Join(root, "folder", "a.md"), "a\n")
	mustWrite(t, filepath.Join(root, "folder", "vendor", "lib", "big.md"), "b\n")
	// vendor also declares itself out of bounds. Named directly, both rules step aside: the
	// ancestor's, and its own — which the walk would otherwise read a second time on entering it.
	mustWrite(t, filepath.Join(root, "folder", "vendor", kiaoFilesName), "[search]\n/\n")

	files, truncated, err := svc.listRecursive([]string{"folder"})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	if !truncated {
		t.Error("truncated = false, but what the declared folder holds was left uncounted")
	}
	got := make([]string, 0, len(files))
	for _, f := range files {
		got = append(got, f.Path)
	}
	want := []string{"folder", "folder/a.md", "folder/vendor"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("scope = %v, want %v (the declared folder listed, not walked)", got, want)
	}

	files, truncated, err = svc.listRecursive([]string{"folder/vendor"})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	if truncated {
		t.Error("truncated = true for the folder named, which is described in full")
	}
	got = got[:0]
	for _, f := range files {
		got = append(got, f.Path)
	}
	want = []string{"folder/vendor", "folder/vendor/.kiao-files", "folder/vendor/lib", "folder/vendor/lib/big.md"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("scope of the declared folder itself = %v, want %v", got, want)
	}
}

// The cap is the feature: a client that asks about a folder holding a node_modules gets a prefix
// and a flag, in one short walk, rather than an enumeration neither end can use.
func TestListRecursiveStopsAtTheCap(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	for i := 0; i < maxScopeEntries+50; i++ {
		mustWrite(t, filepath.Join(root, "big", "f"+strconv.Itoa(1000+i)+".md"), "x\n")
	}

	files, truncated, err := svc.listRecursive([]string{"big"})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	if !truncated {
		t.Error("truncated = false for a scope past the cap")
	}
	if len(files) != maxScopeEntries {
		t.Errorf("entries = %d, want the cap (%d)", len(files), maxScopeEntries)
	}
}

// The state directory is not part of the store, so it is not part of what deleting the root would
// take with it either — a scope listing must not be the one endpoint that names a transcript.
func TestListRecursiveHidesTheStateDirectory(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root, StateDir: ".kiao-config"}
	svc := newFileService(storage, newLinkFixer(storage, []string{".md"}))
	mustWrite(t, filepath.Join(root, ".kiao-config", "conversations", "c1.json"), "{}\n")
	mustWrite(t, filepath.Join(root, "kept.md"), "k\n")

	files, _, err := svc.listRecursive([]string{""})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	for _, f := range files {
		if strings.HasPrefix(f.Path, ".kiao-config") {
			t.Errorf("scope names %s", f.Path)
		}
	}
}

// The git directory is not content either, and in production it is the largest thing in the root
// by far. Neither the archive a user downloads nor the scope a delete confirmation describes may
// name it.
func TestGitDirectoryIsNeitherZippedNorInDeleteScope(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root, StateDir: ".kiao-config"}
	svc := newFileService(storage, newLinkFixer(storage, []string{".md"}))
	mustWrite(t, filepath.Join(root, ".git", "objects", "pack", "pack-1.pack"), "binary")
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello\n")

	var buf bytes.Buffer
	if err := svc.zipFolder("", &buf); err != nil {
		t.Fatalf("zipFolder: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("reading the archive: %v", err)
	}
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, ".git/") {
			t.Errorf("archive holds %s", f.Name)
		}
	}

	files, _, err := svc.listRecursive([]string{""})
	if err != nil {
		t.Fatalf("listRecursive error: %v", err)
	}
	for _, f := range files {
		if strings.HasPrefix(f.Path, ".git") {
			t.Errorf("scope names %s", f.Path)
		}
	}
}
