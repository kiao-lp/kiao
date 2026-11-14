package search

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

// xlsxEntries builds a minimal but realistic workbook: two named sheets wired through
// workbook.xml.rels, and a shared-strings table one of whose entries is split across runs.
func xlsxEntries() map[string]string {
	return map[string]string{
		"xl/sharedStrings.xml": `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>Item</t></si>
<si><r><t>Total </t></r><r><t>cost</t></r></si>
<si><t>Widget</t></si>
</sst>`,
		"xl/workbook.xml": `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c><c r="C2" t="str"><f>A2&amp;B2</f><v>Widget42</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Inline note</t></is></c><c r="B3" t="b"><v>1</v></c></row>
<row r="4"/>
</sheetData></worksheet>`,
		"xl/worksheets/sheet2.xml": `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Follow up in Q3</t></is></c></row>
</sheetData></worksheet>`,
	}
}

func TestExtractSpreadsheetText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "budget.xlsx")
	mustWriteZipDoc(t, src, xlsxEntries())

	got, err := extractSpreadsheetText(src)
	if err != nil {
		t.Fatal(err)
	}
	wantLines(t, got, []string{
		"# Budget",           // a sheet name, as the only kind of comment CSV has
		"Item,Total cost",    // shared strings, incl. one split across <r> runs
		"Widget,42,Widget42", // shared string, bare number, formula RESULT
		"Inline note,TRUE",   // inlineStr and a boolean cell
		"# Notes",            // sheet order comes from workbook.xml, not the zip
		"Follow up in Q3",
	})
	// The formula source itself is not content and must stay out of the index.
	if strings.Contains(got, "A2&B2") {
		t.Errorf("formula source leaked into the index:\n%q", got)
	}
}

// TestExtractSpreadsheetXlsm pins that macro-enabled workbooks go through the same extractor.
func TestExtractSpreadsheetXlsm(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "budget.xlsm")
	mustWriteZipDoc(t, src, xlsxEntries())

	got, err := extractSpreadsheetText(src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "Widget,42") {
		t.Errorf(".xlsm extraction = %q, want the same rows as .xlsx", got)
	}
}

// TestExtractSpreadsheetWithoutRels covers the fallback used when the relationships part is
// missing or unmappable: sheets are taken in naturally-sorted part order.
func TestExtractSpreadsheetWithoutRels(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "norels.xlsx")
	entries := xlsxEntries()
	delete(entries, "xl/_rels/workbook.xml.rels")
	mustWriteZipDoc(t, src, entries)

	got, err := extractSpreadsheetText(src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "# Budget") || !strings.Contains(got, "# Notes") {
		t.Errorf("fallback lost the sheet names:\n%q", got)
	}
	if !strings.Contains(got, "Follow up in Q3") {
		t.Errorf("fallback lost sheet2 content:\n%q", got)
	}
}

func TestExtractOdsText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "budget.ods")
	mustWriteZipDoc(t, src, map[string]string{
		"content.xml": `<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="Budget">
<table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>Widget</text:p></table:table-cell><table:table-cell><text:p>42</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document-content>`,
	})

	got, err := extractOdsText(src)
	if err != nil {
		t.Fatal(err)
	}
	// The trailing empty cell/row runs declare six-figure repeat counts; expanding them would
	// inflate a two-row sheet into a multi-megabyte index.
	wantLines(t, got, []string{
		"# Budget",
		"Item,Cost",
		"Widget,42",
	})
}

// TestExtractOdsRepeatedCellsAreBounded pins the clamp on a NON-empty repeated cell, which is
// the only case where expansion actually happens.
func TestExtractOdsRepeatedCellsAreBounded(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "repeat.ods")
	mustWriteZipDoc(t, src, map[string]string{
		"content.xml": `<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet><table:table table:name="T">
<table:table-row><table:table-cell table:number-columns-repeated="9999"><text:p>dup</text:p></table:table-cell></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`,
	})

	got, err := extractOdsText(src)
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(got, "dup"); n != maxCellRepeat {
		t.Errorf("repeated cell expanded %d times, want the maxCellRepeat clamp (%d)", n, maxCellRepeat)
	}
}

func TestResolveCell(t *testing.T) {
	shared := []string{"zero", "one"}
	cases := []struct {
		cellType, raw, want string
	}{
		{"s", "1", "one"},
		{"s", "99", ""}, // out-of-range index must not panic
		{"s", "not-a-number", ""},
		{"b", "1", "TRUE"},
		{"b", "0", "FALSE"},
		{"inlineStr", "literal", "literal"},
		{"str", "formula result", "formula result"},
		{"", "3.14", "3.14"},
	}
	for _, c := range cases {
		if got := resolveCell(c.cellType, c.raw, shared); got != c.want {
			t.Errorf("resolveCell(%q, %q) = %q, want %q", c.cellType, c.raw, got, c.want)
		}
	}
}

// TestSpreadsheetIndexIsRowOriented documents why rows matter: search reports a line number and
// the whole trimmed line, so one line per row makes a hit show the entire record.
func TestSpreadsheetIndexIsRowOriented(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "rows.xlsx")
	mustWriteZipDoc(t, src, xlsxEntries())

	got, err := extractSpreadsheetText(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(got, "\n") {
		if strings.HasPrefix(line, "Widget") {
			if !strings.Contains(line, "42") {
				t.Errorf("row %q lost its sibling cells", line)
			}
			return
		}
	}
	t.Errorf("no row line found in:\n%s", fmt.Sprintf("%q", got))
}
