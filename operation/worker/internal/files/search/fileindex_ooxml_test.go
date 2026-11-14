package search

import (
	"archive/zip"
	"bytes"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// mustWriteZipDoc writes a zip container at path holding the given entry name -> content. Every
// zip+XML format (.docx, .xlsx, .xlsm, .pptx, .odt, .ods) is built this way, so the suite needs
// no committed binary fixtures.
func mustWriteZipDoc(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// Deterministic entry order, so a test never depends on map iteration.
	names := make([]string, 0, len(entries))
	for n := range entries {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, entries[n]); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}

// wantLines asserts the exact line sequence of an extracted index.
func wantLines(t *testing.T, got string, want []string) {
	t.Helper()
	lines := strings.Split(strings.TrimSuffix(got, "\n"), "\n")
	if len(got) == 0 {
		lines = nil
	}
	if len(lines) != len(want) {
		t.Fatalf("line count = %d, want %d\ngot:\n%q", len(lines), len(want), got)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("line %d = %q, want %q", i+1, lines[i], want[i])
		}
	}
}

func TestExtractDocxText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "report.docx")
	mustWriteZipDoc(t, src, map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Quarterly review</w:t></w:r></w:p>
<w:p><w:r><w:t>Left</w:t><w:tab/><w:t>Right</w:t></w:r></w:p>
<w:p><w:r><w:t>Before break</w:t><w:br/><w:t>After break</w:t></w:r></w:p>
<w:p><w:r><w:instrText> PAGEREF _Toc4711 </w:instrText></w:r></w:p>
</w:body></w:document>`,
		"word/header1.xml": `<?xml version="1.0"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Confidential draft</w:t></w:r></w:p></w:hdr>`,
	})

	got, err := extractDocxText(src)
	if err != nil {
		t.Fatal(err)
	}
	wantLines(t, got, []string{
		"Quarterly review", // the w:tabs tab STOP must not indent this line
		"",                 // Markdown: paragraphs separate, or they run into one
		"Left\tRight",
		"",
		"Before break", // w:br ends a line
		"",
		"After break",
		"",
		"## Headers, footers and notes", // …which is where the apparatus goes, not into the body
		"",
		"Confidential draft",
	})
	// Field codes live in w:instrText, not w:t, and must not reach the index.
	if strings.Contains(got, "PAGEREF") {
		t.Errorf("field code leaked into the index:\n%q", got)
	}
}

// TestExtractDocxStructure is the point of converting rather than dumping: a Word document's
// headings, lists and tables come out as Markdown ones, so the index reads like the document and
// not like its text.
func TestExtractDocxStructure(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "structured.docx")
	mustWriteZipDoc(t, src, map[string]string{
		"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Migration plan</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Titre2"/><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Preparation</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Freeze the store</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Announce the window</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Step</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Backup</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Alex</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t># not a heading</w:t></w:r></w:p>
</w:body></w:document>`,
	})

	got, err := extractDocxText(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"# Migration plan",
		// A French Word writes "Titre2" where an English one writes "Heading2"; w:outlineLvl is
		// the number that says the same thing in every language.
		"## Preparation",
		"- Freeze the store",
		"  - Announce the window", // w:ilvl 1 is a nested item
		"| Step | Owner |",
		"| --- | --- |",
		"| Backup | Alex |",
		// Body text that happens to start with a marker is escaped, or the index invents
		// structure the document does not have.
		"\\# not a heading",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("index is missing %q:\n%s", want, got)
		}
	}
}

func TestHeadingLevelFromStyle(t *testing.T) {
	cases := map[string]int{
		"Heading1":        1,
		"Heading 3":       3,
		"heading-2":       2,
		"Titre4":          4,
		"berschrift2":     2, // German, with the umlaut dropped by the letters-only reduction
		"Title":           1,
		"Titre":           1,
		"Subtitle":        2,
		"Heading9":        6, // clamped: Markdown has six levels
		"BodyText":        0,
		"ListinParagraph": 0,
		"":                0,
	}
	for style, want := range cases {
		if got := headingLevelFromStyle(style); got != want {
			t.Errorf("headingLevelFromStyle(%q) = %d, want %d", style, got, want)
		}
	}
}

func TestExtractDocxTextRejectsNonDocument(t *testing.T) {
	root := t.TempDir()

	// A zip without word/document.xml is not a Word document.
	empty := filepath.Join(root, "empty.docx")
	mustWriteZipDoc(t, empty, map[string]string{"mimetype": "nope"})
	if _, err := extractDocxText(empty); err == nil {
		t.Errorf("expected an error for a zip with no word/document.xml")
	}

	// A file that is not a zip at all.
	notZip := filepath.Join(root, "bogus.docx")
	mustWrite(t, notZip, "just some text\n")
	if _, err := extractDocxText(notZip); err == nil {
		t.Errorf("expected an error for a non-zip .docx")
	}
}

func TestExtractPptxText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "deck.pptx")
	slide := func(text string) string {
		return `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>` + text + `</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
	}
	mustWriteZipDoc(t, src, map[string]string{
		// slide10 must come after slide2, which lexical ordering would get wrong.
		"ppt/slides/slide1.xml":           slide("Opening"),
		"ppt/slides/slide2.xml":           slide("Second"),
		"ppt/slides/slide10.xml":          slide("Tenth"),
		"ppt/notesSlides/notesSlide1.xml": slide("Speaker note"),
	})

	got, err := extractPptxText(src)
	if err != nil {
		t.Fatal(err)
	}
	wantLines(t, got, []string{
		"## Slide 1", "", "- Opening", "",
		"## Slide 2", "", "- Second", "",
		"## Slide 3", "", "- Tenth", "",
		"## Notes 1", "", "- Speaker note",
	})
}

func TestExtractOdtText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "notes.odt")
	mustWriteZipDoc(t, src, map[string]string{
		"content.xml": `<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text>
<text:h text:outline-level="1">Meeting notes</text:h>
<text:p>Agreed on the migration date.</text:p>
<text:p>Owner<text:tab/>Alex</text:p>
<text:p>Mixed <text:span>span</text:span> content</text:p>
<text:p>Spaces<text:s text:c="3"/>separate words</text:p>
<text:p>Before a break<text:line-break/>after a break</text:p>
<text:tracked-changes><text:p>deleted paragraph</text:p></text:tracked-changes>
</office:text></office:body></office:document-content>`,
	})

	got, err := extractOdtText(src)
	if err != nil {
		t.Fatal(err)
	}
	wantLines(t, got, []string{
		"# Meeting notes", // text:outline-level 1 is a level-1 heading
		"",
		"Agreed on the migration date.",
		"",
		"Owner\tAlex",
		"",
		"Mixed span content",
		"",
		// text:s carries runs of spaces as an empty element; without it the words either side
		// would be glued into "Spacesseparate" and whole-word search would miss them.
		"Spaces separate words",
		"",
		"Before a break",
		"",
		"after a break",
	})
	if strings.Contains(got, "deleted paragraph") {
		t.Errorf("tracked changes leaked into the index:\n%q", got)
	}
	if strings.Contains(got, "Spacesseparate") {
		t.Errorf("text:s was dropped, gluing words together:\n%q", got)
	}
}

func TestTextBudgetTruncates(t *testing.T) {
	var b textBudget
	chunk := strings.Repeat("x", 1<<20)
	for i := 0; i < (maxIndexTextBytes/len(chunk))+4; i++ {
		b.writeString(chunk)
	}
	if !b.full {
		t.Errorf("budget should be marked full after exceeding maxIndexTextBytes")
	}
	if got := len(b.String()); got != maxIndexTextBytes {
		t.Errorf("extracted text = %d bytes, want exactly maxIndexTextBytes (%d)", got, maxIndexTextBytes)
	}
	// Truncation is silent by design: a partial index still answers most queries, while an
	// error would leave the document unsearchable and be retried on every later search.
	b.writeString("more")
	if got := len(b.String()); got != maxIndexTextBytes {
		t.Errorf("writes after the cap must be dropped, got %d bytes", got)
	}
}

func TestNaturalLess(t *testing.T) {
	got := []string{"sheet10.xml", "sheet2.xml", "sheet1.xml", "sheet20.xml"}
	sort.Slice(got, func(i, j int) bool { return naturalLess(got[i], got[j]) })
	want := []string{"sheet1.xml", "sheet2.xml", "sheet10.xml", "sheet20.xml"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("natural order = %v, want %v", got, want)
		}
	}
}
