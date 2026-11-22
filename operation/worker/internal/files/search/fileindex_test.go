package search

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIndexPathDerivation(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "doc.pdf")

	if got := src + FormatText; got != src+".index.txt" {
		t.Errorf("txtIndexPath = %q", got)
	}
	if got := src + FormatMarkdown; got != src+".index.md" {
		t.Errorf("mdIndexPath = %q", got)
	}
	// A PDF converts to Markdown, so that is where an index would be written…
	if got := indexTargetPath(src); got != src+".index.md" {
		t.Errorf("indexTargetPath(pdf) = %q, want .index.md", got)
	}
	// …and a workbook converts to CSV.
	if got := indexTargetPath(filepath.Join(root, "book.xlsx")); got != filepath.Join(root, "book.xlsx.index.csv") {
		t.Errorf("indexTargetPath(xlsx) = %q, want .index.csv", got)
	}
	// A file this service cannot convert has no target at all.
	if got := indexTargetPath(filepath.Join(root, "note.txt")); got != "" {
		t.Errorf("indexTargetPath(txt) = %q, want \"\"", got)
	}

	// With no index on disk, nothing is reported: that is what makes the `indexed` flag a stat.
	if got := ExistingIndexPath(src); got != "" {
		t.Errorf("existingIndexPath (none present) = %q, want \"\"", got)
	}
	// An index that IS present answers, whatever format it is in.
	mustWrite(t, src+".index.txt", "legacy\n")
	if got := ExistingIndexPath(src); got != src+".index.txt" {
		t.Errorf("existingIndexPath (txt present) = %q, want .index.txt", got)
	}
	// And when a document somehow carries two, the preferred one answers — search must read one
	// index per document or it reports the document twice.
	mustWrite(t, src+".index.md", "md\n")
	if got := ExistingIndexPath(src); got != src+".index.md" {
		t.Errorf("existingIndexPath (both present) = %q, want .index.md", got)
	}
}

func TestStateOfIndex(t *testing.T) {
	root := t.TempDir()

	// Missing source file.
	if state, err := stateOfIndex(filepath.Join(root, "absent.pdf")); err != nil || state != indexAbsent {
		t.Errorf("missing source: state=%v err=%v, want indexAbsent,nil", state, err)
	}

	src := filepath.Join(root, "doc.pdf")
	mustWrite(t, src, "%PDF fake\n")
	if state, _ := stateOfIndex(src); state != indexMissing {
		t.Errorf("no index: state=%v, want indexMissing", state)
	}

	srcInfo, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}

	// An index carrying the source's own mtime, in the format written today: up to date.
	idx := src + FormatMarkdown
	mustWrite(t, idx, "# text\n")
	sameMtime(t, idx, srcInfo.ModTime())
	if state, _ := stateOfIndex(src); state != indexUpToDate {
		t.Errorf("fresh index: state=%v, want indexUpToDate", state)
	}

	// Older than the source: the document changed after it was written.
	sameMtime(t, idx, srcInfo.ModTime().Add(-time.Hour))
	if state, _ := stateOfIndex(src); state != indexStale {
		t.Errorf("index older than source: state=%v, want indexStale", state)
	}

	// Newer than the source: somebody wrote it. A generated index is stamped with the source's
	// mtime, so this can only be a person — and nothing automatic may overwrite it.
	sameMtime(t, idx, srcInfo.ModTime().Add(time.Hour))
	if state, _ := stateOfIndex(src); state != indexManual {
		t.Errorf("index newer than source: state=%v, want indexManual", state)
	}

	// Current, but in the format an older version of this service wrote.
	os.Remove(idx)
	legacy := src + FormatText
	mustWrite(t, legacy, "flat text\n")
	sameMtime(t, legacy, srcInfo.ModTime())
	if state, _ := stateOfIndex(src); state != indexLegacy {
		t.Errorf("legacy-format index: state=%v, want indexLegacy", state)
	}
}

// TestNeedsIndexing pins what the automatic pass reacts to. A legacy format deliberately does not
// qualify: converting a whole store is what /reindex is for, not what the next search does.
func TestNeedsIndexing(t *testing.T) {
	root := t.TempDir()

	if need, err := NeedsIndexing(filepath.Join(root, "absent.pdf")); err != nil || need {
		t.Errorf("missing source: need=%v err=%v, want false,nil", need, err)
	}

	src := filepath.Join(root, "doc.pdf")
	mustWrite(t, src, "%PDF fake\n")
	if need, err := NeedsIndexing(src); err != nil || !need {
		t.Errorf("no index: need=%v err=%v, want true,nil", need, err)
	}

	srcInfo, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}

	idx := src + FormatText
	mustWrite(t, idx, "text\n")
	sameMtime(t, idx, srcInfo.ModTime())
	if need, err := NeedsIndexing(src); err != nil || need {
		t.Errorf("current index in a legacy format: need=%v err=%v, want false,nil", need, err)
	}

	sameMtime(t, idx, srcInfo.ModTime().Add(-time.Hour))
	if need, err := NeedsIndexing(src); err != nil || !need {
		t.Errorf("stale index: need=%v err=%v, want true,nil", need, err)
	}

	sameMtime(t, idx, srcInfo.ModTime().Add(time.Hour))
	if need, err := NeedsIndexing(src); err != nil || need {
		t.Errorf("hand-written index: need=%v err=%v, want false,nil", need, err)
	}
}

// TestExtractorForExtension pins the indexable file types and the extension matching itself.
func TestExtractorForExtension(t *testing.T) {
	indexable := map[string]indexFormat{
		"a.pdf":  FormatMarkdown,
		"a.docx": FormatMarkdown,
		"a.pptx": FormatMarkdown,
		"a.odt":  FormatMarkdown,
		"a.eml":  FormatMarkdown,
		"a.msg":  FormatMarkdown,
		"a.xlsx": formatCSV,
		"a.xlsm": formatCSV,
		"a.ods":  formatCSV,
	}
	for name, format := range indexable {
		e, ok := extractorFor(name)
		if !ok {
			t.Errorf("extractorFor(%q): not indexable, want an extractor", name)
			continue
		}
		if e.format != format {
			t.Errorf("extractorFor(%q).format = %q, want %q", name, e.format, format)
		}
		// Matching is case-insensitive: uploads arrive with any spelling.
		if _, ok := extractorFor(strings.ToUpper(name)); !ok {
			t.Errorf("extractorFor(%q): not indexable, want case-insensitive matching", strings.ToUpper(name))
		}
	}

	// Legacy .doc is an OLE2 container whose body is a piece table, not named property streams
	// like a .msg, and is deliberately not indexable. Matching on the extension rather than a
	// suffix is what keeps ".docx" from being read as ".doc".
	for _, name := range []string{"a.doc", "a.txt", "a.md", "a", "archive.zip"} {
		if isIndexable(name) {
			t.Errorf("isIndexable(%q) = true, want false", name)
		}
	}
	if !isIndexable("a.docx") {
		t.Errorf(".docx must stay indexable even though .doc is not")
	}
}

func TestOriginalForIndexName(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		isIndex bool
	}{
		{"report.xlsx.index.txt", "report.xlsx", true},
		{"report.pdf.index.md", "report.pdf", true},
		{"report.xlsx.index.csv", "report.xlsx", true},
		{"report.pdf", "", false},
		// Narrower than mainFileName: .blog.md is a companion, not an index.
		{"post.md.blog.md", "", false},
	}
	for _, c := range cases {
		got, isIndex := originalForIndexName(c.in)
		if got != c.want || isIndex != c.isIndex {
			t.Errorf("originalForIndexName(%q) = (%q, %v), want (%q, %v)", c.in, got, isIndex, c.want, c.isIndex)
		}
	}
}

// TestCreateIndexDocx exercises createIndex end-to-end on a synthesized Word document: the
// conversion lands in the sibling .index.md and the index carries the source's mtime, which is
// what marks it generated and up to date.
func TestCreateIndexDocx(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "report.docx")
	mustWriteZipDoc(t, src, map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>migration runbook</w:t></w:r></w:p></w:body></w:document>`,
	})

	written, err := createIndex(src)
	if err != nil {
		t.Fatal(err)
	}
	if written != src+FormatMarkdown {
		t.Fatalf("createIndex wrote %q, want the .index.md beside the document", written)
	}
	if got := mustRead(t, src+FormatMarkdown); got != "migration runbook\n" {
		t.Errorf("index content = %q", got)
	}
	if _, err := os.Stat(src + FormatText); !os.IsNotExist(err) {
		t.Errorf(".index.txt should not be written for a .docx")
	}

	srcInfo, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	idxInfo, err := os.Stat(src + FormatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	if !srcInfo.ModTime().Equal(idxInfo.ModTime()) {
		t.Errorf("index mtime %v != source mtime %v, so it would be re-indexed on every search",
			idxInfo.ModTime(), srcInfo.ModTime())
	}
	if need, err := NeedsIndexing(src); err != nil || need {
		t.Errorf("freshly written index: need=%v err=%v, want false,nil", need, err)
	}
}

// TestCreateIndexReplacesLegacyFormat pins that a document ends up with exactly ONE index. A
// leftover .index.txt beside the .index.md it was replaced by would be scanned by nobody and
// refreshed by nobody, and would keep answering with text from a version ago.
func TestCreateIndexReplacesLegacyFormat(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "report.docx")
	mustWriteZipDoc(t, src, map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>current text</w:t></w:r></w:p></w:body></w:document>`,
	})
	legacy := src + FormatText
	mustWrite(t, legacy, "text from a version ago\n")
	sameMtime(t, legacy, mustStat(t, src).ModTime().Add(-time.Hour))

	if _, err := createIndex(src); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("the superseded .index.txt should have been removed")
	}
	if got := mustRead(t, src+FormatMarkdown); got != "current text\n" {
		t.Errorf("index content = %q", got)
	}
}

// TestCreateIndexTooLarge pins the source-size guard, which fails on a stat instead of letting
// every search burn CPU on a pathological document.
func TestCreateIndexTooLarge(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "huge.docx")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	// Sparse file: declares a size past the cap without writing 64 MiB.
	if err := f.Truncate(maxIndexSourceBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	if _, err := createIndex(src); err == nil {
		t.Errorf("createIndex on an oversized source: expected an error")
	}
	if ExistingIndexPath(src) != "" {
		t.Errorf("no index should be written for an oversized source")
	}
}

// TestCreateIndexUnsupported pins the non-indexable error paths of createIndex without needing a
// real PDF fixture.
func TestCreateIndexUnsupported(t *testing.T) {
	root := t.TempDir()

	// Missing file.
	if _, err := createIndex(filepath.Join(root, "nope.pdf")); err == nil {
		t.Errorf("createIndex on missing file: expected error")
	}

	// A type with no converter.
	txt := filepath.Join(root, "note.txt")
	mustWrite(t, txt, "hello\n")
	if _, err := createIndex(txt); err == nil {
		t.Errorf("createIndex on .txt: expected unsupported-type error")
	}
}

// TestCreateIndexLeavesAHandWrittenIndexAlone is the promise that lets a person keep their own
// index of a document: written after the source, it is never overwritten and never deleted.
func TestCreateIndexLeavesAHandWrittenIndexAlone(t *testing.T) {
	root := t.TempDir()
	pdf := filepath.Join(root, "doc.pdf")
	mustWrite(t, pdf, "not really a pdf\n")
	mustWrite(t, pdf+FormatMarkdown, "manual md index\n")
	sameMtime(t, pdf+FormatMarkdown, mustStat(t, pdf).ModTime().Add(time.Hour))

	written, err := createIndex(pdf)
	if err != nil {
		t.Errorf("createIndex with a hand-written index: expected nil, got %v", err)
	}
	if written != "" {
		t.Errorf("createIndex wrote %q over a hand-written index", written)
	}
	if got := mustRead(t, pdf+FormatMarkdown); got != "manual md index\n" {
		t.Errorf("the hand-written index was modified: %q", got)
	}
	// The source is not even opened — this one is not a readable PDF, and no error came back.
	if _, err := os.Stat(pdf + FormatText); !os.IsNotExist(err) {
		t.Errorf("no other index should be created")
	}
}

func sameMtime(t *testing.T, path string, when time.Time) {
	t.Helper()
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

func mustStat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info
}
