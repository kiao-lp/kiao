package files

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// write puts content at a store-relative path, creating the folders on the way.
func writeAt(t *testing.T, root, rel, content string) {
	t.Helper()
	mustWriteBytes(t, filepath.Join(root, filepath.FromSlash(rel)), []byte(content))
}

// pathsOf names the files of a group, for an assertion that reads like the store.
func pathsOf(g DuplicateGroupDto) []string {
	out := make([]string, 0, len(g.Files))
	for _, f := range g.Files {
		out = append(out, f.Path)
	}
	return out
}

func groupHolding(res FileOptimizationsDto, path string) (DuplicateGroupDto, bool) {
	for _, g := range res.Duplicates {
		for _, f := range g.Files {
			if f.Path == path {
				return g, true
			}
		}
	}
	return DuplicateGroupDto{}, false
}

// ── the scan ──────────────────────────────────────────────────────────────────

// The whole promise of the duplicates tab: same size and same content is one group, and same size
// with different content is not — which is the case a size-only scan would get wrong, and the
// reason the candidates are read rather than counted.
func TestFileOptimizationsGroupsIdenticalFilesAndNotMerelyEqualSizedOnes(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "the same bytes")
	writeAt(t, root, "b/brand.png", "the same bytes")
	writeAt(t, root, "c/other.png", "the SAME bytes") // same length, different content
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Duplicates) != 1 {
		t.Fatalf("duplicate groups = %d (%+v), want 1", len(res.Duplicates), res.Duplicates)
	}
	got := res.Duplicates[0]
	want := []string{"a/logo.png", "b/brand.png"}
	if strings.Join(pathsOf(got), ",") != strings.Join(want, ",") {
		t.Errorf("group = %v, want %v", pathsOf(got), want)
	}
	if got.Size != int64(len("the same bytes")) || got.Wasted != got.Size {
		t.Errorf("size/wasted = %d/%d, want %d/%d", got.Size, got.Wasted, got.Size, got.Size)
	}
	if got.Hash == "" {
		t.Error("a group reported without the hash that settled it")
	}
}

// Three copies waste two of them, and the groups are ordered by what removing the extras gives
// back — which is the order the tab draws and the order a reader stops reading in.
func TestFileOptimizationsOrdersGroupsByWhatTheyWaste(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "small/one.txt", "xx")
	writeAt(t, root, "small/two.txt", "xx")
	big := strings.Repeat("y", 500)
	writeAt(t, root, "big/one.bin", big)
	writeAt(t, root, "big/two.bin", big)
	writeAt(t, root, "big/three.bin", big)
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Duplicates) != 2 {
		t.Fatalf("duplicate groups = %d, want 2", len(res.Duplicates))
	}
	if res.Duplicates[0].Wasted != 1000 {
		t.Errorf("first group wastes %d, want 1000 (two extra copies of 500)", res.Duplicates[0].Wasted)
	}
	if res.Duplicates[1].Wasted != 2 {
		t.Errorf("second group wastes %d, want 2", res.Duplicates[1].Wasted)
	}
}

// Empty files are identical to each other and are not a finding: the placeholders a store keeps a
// folder alive with are not a duplicate group, and offering to reduce them to one would be a
// destructive answer to a question nobody asked. Named without a leading dot on purpose — a dotfile
// is out of the walk anyway, and this is about the size rule.
func TestFileOptimizationsIgnoresEmptyFiles(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/keep.txt", "")
	writeAt(t, root, "b/keep.txt", "")
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Duplicates) != 0 {
		t.Errorf("duplicates = %+v, want none", res.Duplicates)
	}
	if res.Scanned != 0 {
		t.Errorf("scanned = %d, want 0", res.Scanned)
	}
}

// A subsidiary goes with its main file everywhere else; consolidating one on its own account would
// break that pairing, and its main file being a duplicate already covers it. An orphaned one, whose
// document is gone, is a file like any other.
func TestFileOptimizationsSkipsSubsidiariesButNotOrphanedOnes(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "docs/report.pdf", "%PDF-1.7 fixture")
	writeAt(t, root, "docs/report.pdf.index.md", "extracted text")
	writeAt(t, root, "archive/gone.pdf.index.md", "extracted text") // no gone.pdf beside it
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if _, found := groupHolding(res, "docs/report.pdf.index.md"); found {
		t.Error("a subsidiary sitting beside its main file was offered as a duplicate")
	}
	for _, f := range res.Largest {
		if f.Path == "docs/report.pdf.index.md" {
			t.Error("a subsidiary sitting beside its main file was listed among the biggest")
		}
	}
	orphanListed := false
	for _, f := range res.Largest {
		if f.Path == "archive/gone.pdf.index.md" {
			orphanListed = true
		}
	}
	if !orphanListed {
		t.Errorf("largest = %+v, want the orphaned index among them", res.Largest)
	}
}

// The scan is the search walk, so what the store declares is not content is out of bounds here for
// the same reason: nobody pointed this at their dependency tree, and its duplicates are not theirs
// to remove.
func TestFileOptimizationsStaysOutOfWhatTheStoreDeclares(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, ".kiao-files", "node_modules\n")
	writeAt(t, root, "src/app.js", "console.log(1)")
	writeAt(t, root, "node_modules/pkg/app.js", "console.log(1)")
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Duplicates) != 0 {
		t.Errorf("duplicates = %+v, want none: the copy is in a declared folder", res.Duplicates)
	}
}

// The biggest files, biggest first — the other half of the same walk.
func TestFileOptimizationsListsTheBiggestFilesFirst(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "tiny.txt", "x")
	writeAt(t, root, "medium.txt", strings.Repeat("x", 100))
	writeAt(t, root, "huge.bin", strings.Repeat("x", 10000))
	svc := newTestService(root)

	res, err := svc.fileOptimizations("")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Largest) != 3 {
		t.Fatalf("largest = %d entries, want 3", len(res.Largest))
	}
	if res.Largest[0].Path != "huge.bin" || res.Largest[2].Path != "tiny.txt" {
		t.Errorf("largest = %v, want huge.bin … tiny.txt", []string{res.Largest[0].Path, res.Largest[2].Path})
	}
	if res.Scanned != 3 {
		t.Errorf("scanned = %d, want 3", res.Scanned)
	}
}

// A path that is not a folder is a caller mistake, not an empty answer.
func TestFileOptimizationsRefusesAFile(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a.txt", "x")
	if _, err := newTestService(root).fileOptimizations("a.txt"); err == nil {
		t.Fatal("scanning a file was accepted")
	}
}

// ── the consolidation ─────────────────────────────────────────────────────────

// Keeping one copy under a name taken from one place and a folder taken from another: the file ends
// up at the chosen path, every other copy is gone, and the whole point of expressing it as a move —
// a document that linked to a copy now links to the survivor rather than into nothing.
func TestDeduplicateKeepsOneAndRepairsTheLinksToTheOthers(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	writeAt(t, root, "b/brand.png", "PNGDATA")
	writeAt(t, root, "notes.md", "see ![](/b/brand.png) and ![](/a/logo.png)\n")
	svc := newTestService(root)

	res, err := svc.deduplicate([]string{"a/logo.png", "b/brand.png"}, "a/brand.png")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kept != "a/brand.png" {
		t.Errorf("kept = %q, want a/brand.png", res.Kept)
	}
	if len(res.Removed) != 2 {
		t.Errorf("removed = %v, want both copies (neither was already at the target)", res.Removed)
	}
	if !fileExists(filepath.Join(root, "a", "brand.png")) {
		t.Error("the kept file is not at the chosen path")
	}
	for _, gone := range []string{"a/logo.png", "b/brand.png"} {
		if fileExists(filepath.Join(root, filepath.FromSlash(gone))) {
			t.Errorf("%s survived the consolidation", gone)
		}
	}
	notes := string(mustReadBytes(t, filepath.Join(root, "notes.md")))
	if strings.Contains(notes, "b/brand.png") || strings.Contains(notes, "a/logo.png") {
		t.Errorf("notes.md = %q, want both references repointed at the survivor", notes)
	}
	if strings.Count(notes, "/a/brand.png") != 2 {
		t.Errorf("notes.md = %q, want two references to the survivor", notes)
	}
}

// A copy already at the target is kept where it is rather than moved onto itself.
func TestDeduplicateLeavesTheCopyAlreadyAtTheTarget(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	writeAt(t, root, "b/logo.png", "PNGDATA")
	svc := newTestService(root)

	res, err := svc.deduplicate([]string{"a/logo.png", "b/logo.png"}, "a/logo.png")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Removed) != 1 || res.Removed[0] != "b/logo.png" {
		t.Errorf("removed = %v, want only b/logo.png", res.Removed)
	}
	if !fileExists(filepath.Join(root, "a", "logo.png")) {
		t.Error("the kept file is gone")
	}
}

// The store is edited under the reader's feet: a scan minutes old is not licence to destroy. Both
// refusals are 409, and both leave every file where it was.
func TestDeduplicateRefusesWhatTheStoreHasChanged(t *testing.T) {
	t.Run("no longer identical", func(t *testing.T) {
		root := t.TempDir()
		writeAt(t, root, "a/logo.png", "PNGDATA")
		writeAt(t, root, "b/logo.png", "SOMETHING ELSE")
		if _, err := newTestService(root).deduplicate([]string{"a/logo.png", "b/logo.png"}, "a/logo.png"); err != errNotIdentical {
			t.Fatalf("err = %v, want errNotIdentical", err)
		}
		if !fileExists(filepath.Join(root, "b", "logo.png")) {
			t.Error("a refused consolidation removed a file anyway")
		}
	})

	t.Run("the target name is taken by a stranger", func(t *testing.T) {
		root := t.TempDir()
		writeAt(t, root, "a/logo.png", "PNGDATA")
		writeAt(t, root, "b/brand.png", "PNGDATA")
		writeAt(t, root, "a/brand.png", "A DIFFERENT FILE ENTIRELY")
		if _, err := newTestService(root).deduplicate([]string{"a/logo.png", "b/brand.png"}, "a/brand.png"); err != errTargetTaken {
			t.Fatalf("err = %v, want errTargetTaken", err)
		}
		if got := string(mustReadBytes(t, filepath.Join(root, "a", "brand.png"))); got != "A DIFFERENT FILE ENTIRELY" {
			t.Errorf("the stranger at the target was overwritten: %q", got)
		}
	})
}

// One file is not a set, and a set with no destination is not a request.
func TestDeduplicateRefusesAnIncompleteRequest(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	svc := newTestService(root)

	if _, err := svc.deduplicate([]string{"a/logo.png"}, "a/logo.png"); err != errNothingToKeep {
		t.Errorf("one path: err = %v, want errNothingToKeep", err)
	}
	if _, err := svc.deduplicate([]string{"a/logo.png", "b/logo.png"}, ""); err != errNothingToKeep {
		t.Errorf("no target: err = %v, want errNothingToKeep", err)
	}
	// The same path twice is one copy. Counted as two it would pass this guard and then fail
	// halfway through the moves, having already made the first one.
	if _, err := svc.deduplicate([]string{"a/logo.png", "a/logo.png"}, "a/logo.png"); err != errNothingToKeep {
		t.Errorf("one path named twice: err = %v, want errNothingToKeep", err)
	}
}

// A folder is not a copy of anything.
func TestDeduplicateRefusesADirectory(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	mustMkdir(t, root, "b")
	if _, err := newTestService(root).deduplicate([]string{"a/logo.png", "b"}, "a/logo.png"); err != errNotARegularFile {
		t.Fatalf("err = %v, want errNotARegularFile", err)
	}
}

// ── over the wire ─────────────────────────────────────────────────────────────

func TestHandleFileOptimizations(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	writeAt(t, root, "b/logo.png", "PNGDATA")
	s := &Service{files: newTestService(root)}

	rec := do(s, httptest.NewRequest(http.MethodGet, "/fileOptimizations?path=", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got FileOptimizationsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Duplicates) != 1 || len(got.Largest) != 2 {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestHandleFileOptimizationsMapsErrors(t *testing.T) {
	root := t.TempDir()
	s := &Service{files: newTestService(root)}

	for name, tc := range map[string]struct{ query, want string }{
		"a traversal":      {"path=../..", "400"},
		"a missing folder": {"path=nowhere", "400"},
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(s, httptest.NewRequest(http.MethodGet, "/fileOptimizations?"+tc.query, nil))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %s: %s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestHandleDeduplicate(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	writeAt(t, root, "b/brand.png", "PNGDATA")
	s := &Service{files: newTestService(root)}

	body, _ := json.Marshal(DeduplicateRequestDto{Paths: []string{"a/logo.png", "b/brand.png"}, Target: "a/brand.png"})
	rec := do(s, httptest.NewRequest(http.MethodPost, "/deduplicate", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got DeduplicateResultDto
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Kept != "a/brand.png" || len(got.Removed) != 2 {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "b", "brand.png")); err == nil {
		t.Error("a copy survived the consolidation")
	}
}

// A store that moved on answers 409, not 400 and not 500: the request was well formed and was true
// when the scan produced it.
func TestHandleDeduplicateAnswers409WhenTheStoreHasMovedOn(t *testing.T) {
	root := t.TempDir()
	writeAt(t, root, "a/logo.png", "PNGDATA")
	writeAt(t, root, "b/brand.png", "EDITED SINCE THE SCAN")
	s := &Service{files: newTestService(root)}

	body, _ := json.Marshal(DeduplicateRequestDto{Paths: []string{"a/logo.png", "b/brand.png"}, Target: "a/logo.png"})
	rec := do(s, httptest.NewRequest(http.MethodPost, "/deduplicate", bytes.NewReader(body)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleDeduplicateRejectsABadBody(t *testing.T) {
	s := &Service{files: newTestService(t.TempDir())}
	rec := do(s, httptest.NewRequest(http.MethodPost, "/deduplicate", strings.NewReader("{not json")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
