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
	"time"
)

// docxAt writes a one-paragraph Word document at path.
func docxAt(t *testing.T, path, text string) {
	t.Helper()
	mustWriteZipDoc(t, path, map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:body></w:document>`,
	})
}

func TestReindexAFolder(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	docxAt(t, filepath.Join(root, "docs", "runbook.docx"), "the runbook")
	docxAt(t, filepath.Join(root, "docs", "nested", "plan.docx"), "the plan")
	mustWriteZipDoc(t, filepath.Join(root, "docs", "budget.xlsx"), xlsxEntries())
	mustWrite(t, filepath.Join(root, "docs", "readme.md"), "not a document to convert\n")

	res, err := svc.reindex([]string{"docs"})
	if err != nil {
		t.Fatal(err)
	}
	// Three documents converted, each named by the index FILE that appeared — the path a client
	// refreshes and a user opens.
	want := map[string]bool{
		"docs/budget.xlsx.index.csv":     true,
		"docs/runbook.docx.index.md":     true,
		"docs/nested/plan.docx.index.md": true,
	}
	if len(res.Indexed) != len(want) {
		t.Fatalf("indexed = %v, want %d entries", res.Indexed, len(want))
	}
	for _, p := range res.Indexed {
		if !want[p] {
			t.Errorf("unexpected index file %q", p)
		}
		if !fileExists(filepath.Join(root, p)) {
			t.Errorf("%q was reported but not written", p)
		}
	}
	if len(res.Failed) != 0 || res.Truncated {
		t.Errorf("failed=%v truncated=%v, want none", res.Failed, res.Truncated)
	}

	// Running it again converts nothing: everything is up to date, and that is the answer.
	again, err := svc.reindex([]string{"docs"})
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Indexed) != 0 || again.UpToDate != 3 {
		t.Errorf("second run: indexed=%v upToDate=%d, want none and 3", again.Indexed, again.UpToDate)
	}
}

// TestReindexConvertsALegacyIndex is the migration this endpoint exists for: a store carrying
// `.index.txt` dumps from an older version is converted to the formats written today. The search
// pass deliberately leaves them alone, so asking is the only way it happens.
func TestReindexConvertsALegacyIndex(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	src := filepath.Join(root, "runbook.docx")
	docxAt(t, src, "the current text")
	legacy := src + formatText
	mustWrite(t, legacy, "text from a version ago\n")
	sameMtime(t, legacy, mustStat(t, src).ModTime())

	// The automatic pass considers this current…
	if need, _ := needsIndexing(src); need {
		t.Errorf("a current index in a legacy format must not trigger the search pass")
	}
	// …and asking converts it, leaving exactly one index behind.
	res, err := svc.reindex([]string{""})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Indexed) != 1 || res.Indexed[0] != "runbook.docx.index.md" {
		t.Fatalf("indexed = %v, want the .index.md", res.Indexed)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("the superseded .index.txt should have been removed")
	}
}

// TestReindexLeavesAHandWrittenIndexAlone: asking for a rebuild is not permission to destroy
// somebody's own index. Deleting it is how you ask for that.
func TestReindexLeavesAHandWrittenIndexAlone(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	src := filepath.Join(root, "runbook.docx")
	docxAt(t, src, "the current text")
	manual := src + formatMarkdown
	mustWrite(t, manual, "# What this document is really about\n")
	sameMtime(t, manual, mustStat(t, src).ModTime().Add(time.Hour))

	res, err := svc.reindex([]string{"runbook.docx"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Indexed) != 0 || res.UpToDate != 1 {
		t.Errorf("indexed=%v upToDate=%d, want none and 1", res.Indexed, res.UpToDate)
	}
	if got := mustRead(t, manual); got != "# What this document is really about\n" {
		t.Errorf("the hand-written index was overwritten: %q", got)
	}
}

// TestReindexReportsFailuresWithoutLosingTheRest: one corrupt document must not cost a folder its
// whole conversion.
func TestReindexReportsFailuresWithoutLosingTheRest(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	docxAt(t, filepath.Join(root, "good.docx"), "readable")
	mustWrite(t, filepath.Join(root, "broken.docx"), "this is not a zip container\n")

	res, err := svc.reindex([]string{""})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Indexed) != 1 || res.Indexed[0] != "good.docx.index.md" {
		t.Errorf("indexed = %v, want only the readable document", res.Indexed)
	}
	if len(res.Failed) != 1 || res.Failed[0].Path != "broken.docx" {
		t.Fatalf("failed = %+v, want one entry for broken.docx", res.Failed)
	}
	if res.Failed[0].Error == "" {
		t.Errorf("a failure must say why")
	}
}

// TestReindexSkipsWhatTheStoreExcludes: a folder was asked for, but the dependency tree inside it
// was not — and `.kiao-files` is where the store says so.
func TestReindexSkipsWhatTheStoreExcludes(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	mustWrite(t, filepath.Join(root, ".kiao-files"), "[search]\nvendor\n")
	docxAt(t, filepath.Join(root, "kept.docx"), "kept")
	docxAt(t, filepath.Join(root, "vendor", "ignored.docx"), "ignored")
	docxAt(t, filepath.Join(root, ".git", "hidden.docx"), "hidden")

	res, err := svc.reindex([]string{""})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Indexed) != 1 || res.Indexed[0] != "kept.docx.index.md" {
		t.Errorf("indexed = %v, want only kept.docx", res.Indexed)
	}
}

func TestReindexMissingPath(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	res, err := svc.reindex([]string{"nowhere/absent.docx"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Failed) != 1 || res.Failed[0].Path != "nowhere/absent.docx" {
		t.Errorf("failed = %+v, want the missing path reported", res.Failed)
	}
}

func TestReindexRefusesAPathOutsideTheStore(t *testing.T) {
	svc := newTestService(t.TempDir())
	if _, err := svc.reindex([]string{"../escape"}); err == nil {
		t.Errorf("a path outside the store must be refused")
	}
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

func TestHandleReindex(t *testing.T) {
	svc, root := newFileTestServer(t)
	docxAt(t, filepath.Join(root, "runbook.docx"), "the runbook")

	body, _ := json.Marshal(ReindexRequestDto{Paths: []string{"runbook.docx"}})
	rec := do(svc, httptest.NewRequest(http.MethodPost, "/reindex", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got ReindexResultDto
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Indexed) != 1 || got.Indexed[0] != "runbook.docx.index.md" {
		t.Errorf("indexed = %v", got.Indexed)
	}

	// Empty collections serialize as [] and not null: a client iterates the answer.
	if !strings.Contains(rec.Body.String(), `"failed":[]`) {
		t.Errorf("failed should serialize as [], got %s", rec.Body.String())
	}
}

func TestHandleReindexRejectsBadInput(t *testing.T) {
	svc, _ := newFileTestServer(t)

	rec := do(svc, httptest.NewRequest(http.MethodPost, "/reindex", strings.NewReader("not json")))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status = %d, want 400", rec.Code)
	}

	body, _ := json.Marshal(ReindexRequestDto{Paths: []string{"../escape"}})
	rec = do(svc, httptest.NewRequest(http.MethodPost, "/reindex", bytes.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("path outside the store: status = %d, want 400", rec.Code)
	}
}
