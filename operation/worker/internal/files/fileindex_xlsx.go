package files

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// Spreadsheet text extraction (.xlsx/.xlsm and .ods). Spreadsheets get their own parser rather
// than the generic engine in fileindex_ooxml.go: OOXML hides most cell text behind the
// shared-strings table, and OpenDocument inflates empty runs with repeat counts.
//
// Both convert to CSV, ONE RECORD PER ROW. A spreadsheet is already a table, so the index that
// preserves what it is happens to be the one search wants: a hit reports a line number and the
// line as SearchMatch.Content, and a line here is a whole record — the meaningful unit in a
// spreadsheet — instead of a bare cell. It is also a file anything can open, which a text dump of
// tab-joined cells was not.
//
// Sheet names go in as a `# name` record. CSV has no way to say "a new sheet starts here" and a
// workbook has to say it somewhere; see textBudget.csvComment.

// maxCellRepeat bounds how far an OpenDocument repeat count is expanded. Real files routinely
// declare tens of thousands of repeated trailing cells, which would inflate a small document
// into a multi-megabyte index.
const maxCellRepeat = 64

// extractSpreadsheetText converts an OOXML workbook (.xlsx, .xlsm) to CSV.
func extractSpreadsheetText(absFile string) (string, error) {
	r, err := openZipDoc(absFile)
	if err != nil {
		return "", err
	}
	defer r.Close()

	shared, err := readSharedStrings(&r.Reader)
	if err != nil {
		return "", err
	}

	var out textBudget
	for _, sheet := range workbookSheets(&r.Reader) {
		out.csvComment(sheet.name)
		if err := writeSheetRows(sheet.file, shared, &out); err != nil {
			continue // best-effort: a malformed sheet must not lose the rest of the workbook
		}
		if out.full {
			break
		}
	}
	return out.String(), nil
}

// readSharedStrings parses xl/sharedStrings.xml into the indexed table that cells refer to.
// One <si> may be split across several <r> runs, whose <t> parts concatenate into a single entry.
func readSharedStrings(r *zip.Reader) ([]string, error) {
	f := zipEntry(r, "xl/sharedStrings.xml")
	if f == nil {
		return nil, nil // a workbook of pure numbers has no shared strings
	}
	rc, err := openZipEntry(f)
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	var (
		strs   []string
		cur    strings.Builder
		inSi   bool
		inText bool
		dec    = xml.NewDecoder(rc)
	)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break // best-effort
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				inSi, cur = true, strings.Builder{}
			case "t":
				inText = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "si":
				if inSi {
					strs = append(strs, cur.String())
					inSi = false
				}
			case "t":
				inText = false
			}
		case xml.CharData:
			if inSi && inText {
				cur.Write(t)
			}
		}
	}
	return strs, nil
}

// sheetRef pairs a worksheet part with its user-visible name.
type sheetRef struct {
	name string
	file *zip.File
}

// workbookSheets returns the worksheets in workbook order with their names, resolving the
// r:id -> part mapping through xl/_rels/workbook.xml.rels. Falls back to the naturally-sorted
// xl/worksheets/sheet*.xml parts when the relationships are missing or unmappable.
func workbookSheets(r *zip.Reader) []sheetRef {
	names, rels := readWorkbookSheetNames(r), readWorkbookRels(r)

	var out []sheetRef
	for _, n := range names {
		target := rels[n.rid]
		if target == "" {
			continue
		}
		if f := zipEntry(r, "xl/"+strings.TrimPrefix(target, "/")); f != nil {
			out = append(out, sheetRef{name: n.name, file: f})
		}
	}
	if len(out) > 0 {
		return out
	}

	for i, f := range zipEntriesMatching(r, "xl/worksheets/sheet", ".xml") {
		name := fmt.Sprintf("sheet %d", i+1)
		if i < len(names) {
			name = names[i].name
		}
		out = append(out, sheetRef{name: name, file: f})
	}
	return out
}

type sheetName struct {
	name string
	rid  string
}

// readWorkbookSheetNames reads the <sheet name=".." r:id=".."/> list from xl/workbook.xml,
// preserving document order.
func readWorkbookSheetNames(r *zip.Reader) []sheetName {
	f := zipEntry(r, "xl/workbook.xml")
	if f == nil {
		return nil
	}
	rc, err := openZipEntry(f)
	if err != nil {
		return nil
	}
	defer rc.Close()

	var out []sheetName
	dec := xml.NewDecoder(rc)
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "sheet" {
			continue
		}
		var s sheetName
		for _, a := range start.Attr {
			switch a.Name.Local {
			case "name":
				s.name = a.Value
			case "id": // r:id, matched on the local part
				s.rid = a.Value
			}
		}
		if s.name != "" {
			out = append(out, s)
		}
	}
	return out
}

// readWorkbookRels maps relationship ids to their targets from xl/_rels/workbook.xml.rels.
func readWorkbookRels(r *zip.Reader) map[string]string {
	f := zipEntry(r, "xl/_rels/workbook.xml.rels")
	if f == nil {
		return nil
	}
	rc, err := openZipEntry(f)
	if err != nil {
		return nil
	}
	defer rc.Close()

	out := map[string]string{}
	dec := xml.NewDecoder(rc)
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "Relationship" {
			continue
		}
		var id, target string
		for _, a := range start.Attr {
			switch a.Name.Local {
			case "Id":
				id = a.Value
			case "Target":
				target = a.Value
			}
		}
		if id != "" && target != "" {
			out[id] = target
		}
	}
	return out
}

// writeSheetRows streams one worksheet part, emitting a CSV record per non-empty <row>. A row
// with nothing in it is dropped rather than written as an empty record: Excel writes <row>
// elements for rows that merely carry formatting, and a workbook has thousands of them.
func writeSheetRows(f *zip.File, shared []string, out *textBudget) error {
	rc, err := openZipEntry(f)
	if err != nil {
		return err
	}
	defer rc.Close()

	var (
		dec       = xml.NewDecoder(rc)
		cells     []string
		cell      strings.Builder
		cellType  string
		inRow     bool
		inValue   bool // inside <v> or an inline-string <t>
		inFormula bool
	)

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break // best-effort
		}
		if out.full {
			break
		}

		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				inRow, cells = true, cells[:0]
			case "c":
				cell.Reset()
				cellType = ""
				for _, a := range t.Attr {
					if a.Name.Local == "t" {
						cellType = a.Value
					}
				}
			case "f":
				inFormula = true // formula source is not content
			case "v", "t":
				inValue = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "row":
				if inRow {
					writeCSVRecord(out, cells)
					inRow = false
				}
			case "c":
				cells = append(cells, resolveCell(cellType, cell.String(), shared))
			case "f":
				inFormula = false
			case "v", "t":
				inValue = false
			}
		case xml.CharData:
			if inRow && inValue && !inFormula {
				cell.Write(t)
			}
		}
	}
	return nil
}

// writeCSVRecord emits one row, trailing empty cells dropped and a row that is nothing but empty
// cells dropped entirely. A sheet's used range routinely reaches far past its last value, and
// carrying that into the index would be columns of commas on every line.
func writeCSVRecord(out *textBudget, cells []string) {
	last := -1
	for i, c := range cells {
		if strings.TrimSpace(c) != "" {
			last = i
		}
	}
	if last < 0 {
		return
	}
	out.csvRow(cells[:last+1])
}

// resolveCell turns a raw cell value into its display text. "s" is an index into the
// shared-strings table; "inlineStr" and "str" are already literal; "b" is a boolean; anything
// else (typically a number or date serial) is used verbatim.
func resolveCell(cellType, raw string, shared []string) string {
	switch cellType {
	case "s":
		i, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || i < 0 || i >= len(shared) {
			return ""
		}
		return shared[i]
	case "b":
		if strings.TrimSpace(raw) == "1" {
			return "TRUE"
		}
		return "FALSE"
	default:
		return raw
	}
}

// extractOdsText converts an OpenDocument spreadsheet to CSV, one record per table row with a
// `# name` record per table.
func extractOdsText(absFile string) (string, error) {
	r, err := openZipDoc(absFile)
	if err != nil {
		return "", err
	}
	defer r.Close()

	content := zipEntry(&r.Reader, "content.xml")
	if content == nil {
		return "", fmt.Errorf("no content.xml in %s", absFile)
	}
	rc, err := openZipEntry(content)
	if err != nil {
		return "", err
	}
	defer rc.Close()

	var (
		out        textBudget
		dec        = xml.NewDecoder(rc)
		cells      []string
		cell       strings.Builder
		rowRepeat  = 1
		cellRepeat = 1
		inCell     bool
		skipDepth  int
	)

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break // best-effort
		}
		if out.full {
			break
		}

		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tracked-changes", "annotation":
				skipDepth++
			case "table":
				if skipDepth == 0 {
					out.csvComment(odfAttr(t, "name"))
				}
			case "table-row":
				if skipDepth == 0 {
					cells, rowRepeat = cells[:0], odfRepeat(t, "number-rows-repeated")
				}
			case "table-cell", "covered-table-cell":
				if skipDepth == 0 {
					// The repeat count lives on the start tag; remember it for the end tag.
					inCell, cell = true, strings.Builder{}
					cellRepeat = odfRepeat(t, "number-columns-repeated")
				}
			case "s", "tab":
				// OpenDocument encodes runs of spaces and tabs as empty elements, so without
				// this the words either side would be glued together.
				if inCell && skipDepth == 0 {
					cell.WriteString(" ")
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "tracked-changes", "annotation":
				if skipDepth > 0 {
					skipDepth--
				}
			case "table-cell", "covered-table-cell":
				if skipDepth == 0 {
					// An empty cell never justifies expanding its repeat count — trailing runs
					// of thousands of blank cells are the norm in real spreadsheets.
					if text := strings.TrimSpace(cell.String()); text != "" {
						for i := 0; i < cellRepeat; i++ {
							cells = append(cells, text)
						}
					} else {
						cells = append(cells, "")
					}
					inCell, cellRepeat = false, 1
				}
			case "p":
				// A cell may hold several paragraphs; keep them from running together.
				if inCell && skipDepth == 0 {
					cell.WriteString(" ")
				}
			case "table-row":
				if skipDepth == 0 {
					// A repeated row is almost always a repeated BLANK row; emit content once.
					for i := 0; i < rowRepeat && i < maxCellRepeat; i++ {
						before := out.sb.Len()
						writeCSVRecord(&out, cells)
						if out.sb.Len() == before {
							break // the row was blank: repeating it would repeat nothing
						}
					}
				}
			}
		case xml.CharData:
			if inCell && skipDepth == 0 {
				cell.Write(t)
			}
		}
	}
	return out.String(), nil
}

// odfAttr returns the value of an attribute by local name, or "".
func odfAttr(e xml.StartElement, local string) string {
	for _, a := range e.Attr {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// odfRepeat reads a table:number-*-repeated attribute, clamped to maxCellRepeat.
func odfRepeat(e xml.StartElement, local string) int {
	n, err := strconv.Atoi(odfAttr(e, local))
	if err != nil || n < 1 {
		return 1
	}
	if n > maxCellRepeat {
		return maxCellRepeat
	}
	return n
}
