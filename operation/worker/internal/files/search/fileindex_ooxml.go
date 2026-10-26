package search

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// lineKind is the Markdown role of the line currently being accumulated. Zero value: body text.
type lineKind struct {
	heading int // 1..6 when the line is a heading
	bullet  int // 1..n when the line is a list item at that depth
}

// xmlTextRules describes how to turn one XML vocabulary into Markdown. Elements are matched on
// their local name, so namespace prefixes (w:, a:, text:, table:) are irrelevant.
type xmlTextRules struct {
	// textElems, when non-nil, restricts document text to char data inside these elements.
	// Nil means "all char data is text" (the OpenDocument shape).
	textElems map[string]bool
	// skipElems are subtrees ignored entirely, char data included.
	skipElems map[string]bool
	// breakElems end the current line when closed (or when self-closing).
	breakElems map[string]bool
	// tabElems emit a tab when closed (or when self-closing).
	tabElems map[string]bool
	// spaceElems emit a space. OpenDocument encodes runs of spaces as an empty element rather
	// than char data, so without this the surrounding words would be glued together.
	spaceElems map[string]bool

	// classify, when set, is called on every start element and is what lets a vocabulary say
	// that the line being accumulated is a heading or a list item. It is called on the *paragraph*
	// element and on the property elements inside it alike, because that is where the two formats
	// put the answer: Word states a paragraph's style in a child of the paragraph, OpenDocument
	// states a heading's level on the heading element itself. A vocabulary resets the kind at the
	// start of each paragraph; the engine never does, so a mid-paragraph line break keeps it.
	classify func(xml.StartElement, *lineKind)

	// tableElems / rowElems / cellElems name the elements of a table. Set all three and the
	// engine collects cells instead of emitting them, and writes each row as a pipe row.
	tableElems map[string]bool
	rowElems   map[string]bool
	cellElems  map[string]bool
}

// openZipDoc opens absFile as a zip container.
func openZipDoc(absFile string) (*zip.ReadCloser, error) {
	r, err := zip.OpenReader(absFile)
	if err != nil {
		return nil, fmt.Errorf("not a readable zip container: %w", err)
	}
	return r, nil
}

// zipEntry returns the entry with exactly this name, or nil.
func zipEntry(r *zip.Reader, name string) *zip.File {
	for _, f := range r.File {
		if f.Name == name {
			return f
		}
	}
	return nil
}

// zipEntriesMatching returns the entries whose name has the given prefix and suffix, ordered
// naturally so that "slide2.xml" comes before "slide10.xml".
func zipEntriesMatching(r *zip.Reader, prefix, suffix string) []*zip.File {
	var out []*zip.File
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, prefix) && strings.HasSuffix(f.Name, suffix) {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return naturalLess(out[i].Name, out[j].Name) })
	return out
}

// naturalLess compares two names treating digit runs as numbers, so "sheet2" sorts before
// "sheet10". Plain lexical order would interleave the parts of a document out of sequence.
func naturalLess(a, b string) bool {
	for len(a) > 0 && len(b) > 0 {
		ad, bd := isDigit(a[0]), isDigit(b[0])
		if ad != bd {
			return a[0] < b[0]
		}
		if !ad {
			if a[0] != b[0] {
				return a[0] < b[0]
			}
			a, b = a[1:], b[1:]
			continue
		}
		ai, bi := digitRun(a), digitRun(b)
		an, _ := strconv.Atoi(a[:ai])
		bn, _ := strconv.Atoi(b[:bi])
		if an != bn {
			return an < bn
		}
		a, b = a[ai:], b[bi:]
	}
	return len(a) < len(b)
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func digitRun(s string) int {
	i := 0
	for i < len(s) && isDigit(s[i]) {
		i++
	}
	return i
}

// openZipEntry opens a zip entry for reading, refusing entries that declare more than
// maxZipEntryBytes and capping the actual read at the same bound (a declared size is attacker
// controlled, so both checks are needed).
func openZipEntry(f *zip.File) (io.ReadCloser, error) {
	if f.UncompressedSize64 > maxZipEntryBytes {
		return nil, fmt.Errorf("zip entry %s too large (%d bytes)", f.Name, f.UncompressedSize64)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{io.LimitReader(rc, maxZipEntryBytes), rc}, nil
}

// xmlTextStream is the state of one part being decoded. Its whole job is deciding where a
// finished line goes: into the document, or into the table cell being built.
type xmlTextStream struct {
	rules xmlTextRules
	out   *textBudget

	line strings.Builder
	kind lineKind

	skipDepth  int // enclosing skipped subtrees
	textDepth  int // enclosing text elements
	tableDepth int // enclosing tables

	cell     []string // lines flushed inside the current cell
	inCell   bool
	row      []string // cells closed in the current row
	headDone bool     // the current table has emitted its header row
}

// flush ends the current line. Inside a table cell it feeds the cell instead of the document,
// which is what turns a cell holding three paragraphs into one cell rather than three rows.
func (s *xmlTextStream) flush() {
	text := strings.TrimSpace(s.line.String())
	s.line.Reset()
	if text == "" {
		return
	}
	if s.inCell {
		s.cell = append(s.cell, text)
		return
	}
	switch {
	case s.kind.heading > 0:
		s.out.heading(s.kind.heading, text)
	case s.kind.bullet > 0:
		s.out.bullet(s.kind.bullet, text)
	default:
		s.out.paragraph(text)
	}
}

// hasTables reports whether the vocabulary declared a complete table triple. All three or none:
// half a declaration would collect cells nothing ever emits.
func (r xmlTextRules) hasTables() bool {
	return len(r.tableElems) > 0 && len(r.rowElems) > 0 && len(r.cellElems) > 0
}

// streamXMLText decodes one XML entry against the given rules, appending its Markdown to out.
// The decoder is streaming, so a large part never lands in memory whole.
func streamXMLText(f *zip.File, rules xmlTextRules, out *textBudget) error {
	rc, err := openZipEntry(f)
	if err != nil {
		return err
	}
	defer rc.Close()
	return decodeXMLText(rc, rules, out)
}

func decodeXMLText(r io.Reader, rules xmlTextRules, out *textBudget) error {
	s := &xmlTextStream{rules: rules, out: out}
	dec := xml.NewDecoder(r)
	// Word and PowerPoint parts declare entities only through the standard XML set; an unknown
	// one is a malformed document, not something to resolve from the file's own DTD.
	dec.Strict = false

	tables := rules.hasTables()

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			// Best-effort: keep whatever was decoded before the malformed part.
			break
		}
		if out.full {
			break
		}

		switch t := tok.(type) {
		case xml.StartElement:
			local := t.Name.Local
			if rules.skipElems[local] {
				s.skipDepth++
				continue
			}
			if s.skipDepth > 0 {
				continue
			}
			if rules.classify != nil {
				rules.classify(t, &s.kind)
			}
			if rules.textElems != nil && rules.textElems[local] {
				s.textDepth++
			}
			if rules.tabElems[local] {
				s.line.WriteString("\t")
			}
			if rules.spaceElems[local] {
				s.line.WriteString(" ")
			}
			if tables {
				s.startTableElement(local)
			}
		case xml.EndElement:
			local := t.Name.Local
			if rules.skipElems[local] {
				if s.skipDepth > 0 {
					s.skipDepth--
				}
				continue
			}
			if s.skipDepth > 0 {
				continue
			}
			if rules.textElems != nil && rules.textElems[local] && s.textDepth > 0 {
				s.textDepth--
			}
			if rules.breakElems[local] {
				s.flush()
			}
			if tables {
				s.endTableElement(local)
			}
		case xml.CharData:
			if s.skipDepth > 0 {
				continue
			}
			if rules.textElems != nil && s.textDepth == 0 {
				continue // char data outside a text element (field codes, ids, whitespace)
			}
			s.line.WriteString(string(t))
		}
	}
	s.flush()
	return nil
}

// startTableElement / endTableElement maintain the pipe-table state.
//
// Only the outermost table is drawn as a table. A nested one keeps its text — its paragraphs
// flush into the enclosing cell — but does not try to become a table inside a cell, which
// Markdown has no syntax for anyway.
func (s *xmlTextStream) startTableElement(local string) {
	switch {
	case s.rules.tableElems[local]:
		s.tableDepth++
		if s.tableDepth == 1 {
			s.headDone = false
			s.out.blankLine()
		}
	case s.tableDepth != 1:
		return
	case s.rules.rowElems[local]:
		s.row = s.row[:0]
	case s.rules.cellElems[local]:
		s.flush() // text sitting outside any cell belongs to the document, not to this one
		s.inCell, s.cell = true, nil
	}
}

func (s *xmlTextStream) endTableElement(local string) {
	switch {
	case s.rules.tableElems[local]:
		if s.tableDepth > 0 {
			s.tableDepth--
		}
		if s.tableDepth == 0 {
			s.inCell, s.cell, s.row = false, nil, nil
			s.out.blankLine()
		}
	case s.tableDepth != 1:
		return
	case s.rules.cellElems[local]:
		s.row = append(s.row, strings.Join(s.cell, "\n"))
		s.inCell, s.cell = false, nil
	case s.rules.rowElems[local]:
		if len(s.row) > 0 {
			s.out.tableRow(s.row, !s.headDone)
			s.headDone = true
		}
		s.row = s.row[:0]
	}
}

// xmlAttr returns the value of an attribute by local name, or "".
func xmlAttr(e xml.StartElement, local string) string {
	for _, a := range e.Attr {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// xmlAttrInt reads an integer attribute by local name, returning def when it is absent or not a
// number.
func xmlAttrInt(e xml.StartElement, local string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(xmlAttr(e, local)))
	if err != nil {
		return def
	}
	return n
}

// docxRules: text lives in w:t; w:p, w:br and w:cr end a line; w:tab is a tab. Restricting text
// to w:t also excludes w:instrText, which carries field codes rather than document content.
// w:tabs is skipped because it declares tab STOPS in the paragraph properties — counting those
// as tabs would prefix real paragraphs with stray indentation.
var docxRules = xmlTextRules{
	textElems:  map[string]bool{"t": true},
	skipElems:  map[string]bool{"tabs": true},
	breakElems: map[string]bool{"p": true, "br": true, "cr": true},
	tabElems:   map[string]bool{"tab": true},
	tableElems: map[string]bool{"tbl": true},
	rowElems:   map[string]bool{"tr": true},
	cellElems:  map[string]bool{"tc": true},
	classify:   classifyDocxLine,
}

// classifyDocxLine reads a Word paragraph's properties into the Markdown role of its line.
//
// The level comes from w:outlineLvl when Word wrote one, because it is a number and the style
// name is not: the built-in heading styles are named in the language of the Word that created the
// document ("Heading1", "Titre1", "berschrift1"), so matching the name alone would index a
// French document as a wall of body text.
func classifyDocxLine(e xml.StartElement, k *lineKind) {
	switch e.Name.Local {
	case "p":
		*k = lineKind{} // every paragraph starts as body text and its properties say otherwise
	case "outlineLvl":
		if lvl := xmlAttrInt(e, "val", -1); lvl >= 0 {
			k.heading = clampLevel(lvl + 1) // w:outlineLvl is 0-based
		}
	case "pStyle":
		if lvl := headingLevelFromStyle(xmlAttr(e, "val")); lvl > 0 && k.heading == 0 {
			k.heading = lvl
		}
	case "numPr":
		k.bullet = 1
	case "ilvl":
		if k.bullet > 0 {
			k.bullet = xmlAttrInt(e, "val", 0) + 1 // w:ilvl is 0-based
		}
	}
}

// headingStylePrefixes are the localised names Word gives its built-in heading styles, reduced
// to letters. The list is not a claim to be exhaustive — w:outlineLvl answers first and this only
// has to catch the documents that carry a style name and nothing else.
var headingStylePrefixes = []string{"heading", "titre", "berschrift", "kop", "rubrik", "titolo", "titulo", "ttulo"}

// headingLevelFromStyle maps a Word style id to a heading level, or 0 for body text. "Heading2"
// and "Titre 2" are level 2; "Title" and "Titre" — the document title, which carries no number —
// are level 1; "Subtitle" is level 2.
func headingLevelFromStyle(style string) int {
	letters, digits := splitLettersDigits(strings.ToLower(strings.TrimSpace(style)))
	if letters == "" {
		return 0
	}
	// The unnumbered styles, matched only when the id carries no number: "Titre" is the document
	// title and "Titre4" is a level-4 heading, and they differ by nothing else.
	if digits == "" {
		switch letters {
		case "title", "titre", "titel", "titolo", "titulo", "ttulo":
			return 1
		case "subtitle", "soustitre", "untertitel", "sottotitolo", "subttulo":
			return 2
		}
	}
	for _, prefix := range headingStylePrefixes {
		if strings.HasPrefix(letters, prefix) {
			if n, err := strconv.Atoi(digits); err == nil {
				return clampLevel(n)
			}
			return 1
		}
	}
	return 0
}

// splitLettersDigits reduces a style id to its letters and its digits, dropping spaces, hyphens
// and the rest — "Heading 2", "heading-2" and "Heading2" are the same style.
func splitLettersDigits(s string) (letters, digits string) {
	var l, d strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
			l.WriteRune(r)
		case r >= '0' && r <= '9':
			d.WriteRune(r)
		}
	}
	return l.String(), d.String()
}

// extractDocxText converts a Word document to Markdown: the body first, then headers, footers,
// footnotes and endnotes — those carry titles and reference numbers people search for.
func extractDocxText(absFile string) (string, error) {
	r, err := openZipDoc(absFile)
	if err != nil {
		return "", err
	}
	defer r.Close()

	body := zipEntry(&r.Reader, "word/document.xml")
	if body == nil {
		return "", fmt.Errorf("no word/document.xml in %s", absFile)
	}

	var out textBudget
	if err := streamXMLText(body, docxRules, &out); err != nil {
		return "", err
	}

	// The apparatus, under a heading of its own: it is part of the document and worth finding,
	// but running it into the body would make the index read as if the text continued.
	var apparatus []*zip.File
	apparatus = append(apparatus, zipEntriesMatching(&r.Reader, "word/header", ".xml")...)
	apparatus = append(apparatus, zipEntriesMatching(&r.Reader, "word/footer", ".xml")...)
	if fn := zipEntry(&r.Reader, "word/footnotes.xml"); fn != nil {
		apparatus = append(apparatus, fn)
	}
	if en := zipEntry(&r.Reader, "word/endnotes.xml"); en != nil {
		apparatus = append(apparatus, en)
	}

	var notes textBudget
	for _, p := range apparatus {
		if err := streamXMLText(p, docxRules, &notes); err != nil {
			continue // best-effort, like a page that fails to decode in a PDF
		}
	}
	if text := strings.TrimSpace(notes.String()); text != "" {
		out.heading(2, "Headers, footers and notes")
		out.writeString(text)
		out.writeString("\n")
	}
	return out.String(), nil
}

// pptxRules: a:t holds the text of a run, a:p ends a paragraph. Every paragraph of a slide is a
// bullet, at the depth a:pPr declares, except the ones in the title placeholder — which is what
// gives each slide a heading a reader can navigate by.
func pptxRules() xmlTextRules {
	// The placeholder type is stated once per shape, several elements above the paragraphs it
	// applies to, so it is state of the part rather than of the line — which is exactly what a
	// closure over one decoding pass is for.
	titleShape := false
	return xmlTextRules{
		textElems:  map[string]bool{"t": true},
		breakElems: map[string]bool{"p": true, "br": true},
		tableElems: map[string]bool{"tbl": true},
		rowElems:   map[string]bool{"tr": true},
		cellElems:  map[string]bool{"tc": true},
		classify: func(e xml.StartElement, k *lineKind) {
			switch e.Name.Local {
			case "sp", "graphicFrame", "pic":
				titleShape = false // a new shape until its placeholder says otherwise
			case "ph":
				if t := xmlAttr(e, "type"); t == "title" || t == "ctrTitle" {
					titleShape = true
				}
			case "p":
				if titleShape {
					*k = lineKind{heading: 3}
				} else {
					*k = lineKind{bullet: 1}
				}
			case "pPr":
				if k.bullet > 0 {
					k.bullet = xmlAttrInt(e, "lvl", 0) + 1 // a:pPr@lvl is 0-based
				}
			}
		},
	}
}

// extractPptxText converts a presentation to Markdown, slide by slide, followed by the speaker
// notes. Each slide gets a heading so a hit carries its location.
func extractPptxText(absFile string) (string, error) {
	r, err := openZipDoc(absFile)
	if err != nil {
		return "", err
	}
	defer r.Close()

	slides := zipEntriesMatching(&r.Reader, "ppt/slides/slide", ".xml")
	notes := zipEntriesMatching(&r.Reader, "ppt/notesSlides/notesSlide", ".xml")
	if len(slides) == 0 && len(notes) == 0 {
		return "", fmt.Errorf("no slides in %s", absFile)
	}

	var out textBudget
	for i, s := range slides {
		out.heading(2, "Slide "+strconv.Itoa(i+1))
		if err := streamXMLText(s, pptxRules(), &out); err != nil {
			continue
		}
	}
	for i, n := range notes {
		out.heading(2, "Notes "+strconv.Itoa(i+1))
		if err := streamXMLText(n, pptxRules(), &out); err != nil {
			continue
		}
	}
	return out.String(), nil
}

// odtRules: OpenDocument stores text as char data directly inside text:p / text:h / text:span,
// so there is no useful text-element allowlist — collect everything outside the skipped subtrees.
// The style declarations at the head of content.xml are skipped for the same reason: they are not
// the document, and without an allowlist their stray char data would land in it.
var odtRules = xmlTextRules{
	skipElems: map[string]bool{
		"tracked-changes": true, "annotation": true,
		"automatic-styles": true, "font-face-decls": true, "scripts": true,
		"styles": true, "master-styles": true,
	},
	breakElems: map[string]bool{"p": true, "h": true, "line-break": true},
	tabElems:   map[string]bool{"tab": true},
	spaceElems: map[string]bool{"s": true},
	tableElems: map[string]bool{"table": true},
	rowElems:   map[string]bool{"table-row": true},
	cellElems:  map[string]bool{"table-cell": true, "covered-table-cell": true},
	classify:   classifyOdtLine,
}

// classifyOdtLine turns text:h into a heading at the level it declares and a list item into a
// bullet. Nesting depth is not read: OpenDocument states it by nesting text:list elements rather
// than by an attribute, and a flat bullet is close enough for an index.
func classifyOdtLine(e xml.StartElement, k *lineKind) {
	switch e.Name.Local {
	case "h":
		*k = lineKind{heading: clampLevel(xmlAttrInt(e, "outline-level", 1))}
	case "p":
		if k.bullet == 0 {
			*k = lineKind{}
		}
	case "list-item":
		k.bullet = 1
	case "list":
		// A list ends the paragraph before it; its items set their own kind.
	}
}

// extractOdtText converts an OpenDocument text document to Markdown.
func extractOdtText(absFile string) (string, error) {
	return extractOdfContent(absFile, odtRules)
}

func extractOdfContent(absFile string, rules xmlTextRules) (string, error) {
	r, err := openZipDoc(absFile)
	if err != nil {
		return "", err
	}
	defer r.Close()

	content := zipEntry(&r.Reader, "content.xml")
	if content == nil {
		return "", fmt.Errorf("no content.xml in %s", absFile)
	}
	var out textBudget
	if err := streamXMLText(content, rules, &out); err != nil {
		return "", err
	}
	return out.String(), nil
}
