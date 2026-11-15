package search

import (
	pkgPdf "github.com/ledongthuc/pdf"
	"strconv"
	"strings"
)

// extractPDFText converts a PDF into Markdown, one "## Page n" section per page.
//
// The page headings are the whole reason this is Markdown rather than a text dump: extracted PDF
// text has no structure of its own — no headings survive, paragraphs run together — so the page
// number is the only landmark a reader gets, and it is the one that lets somebody who found a hit
// go and look at the document.
func extractPDFText(absFile string) (string, error) {
	f, r, err := pkgPdf.Open(absFile)
	if err != nil {
		return "", err
	}
	defer f.Close()

	var out textBudget
	totalPages := r.NumPage()
	for i := 1; i <= totalPages; i++ {
		if out.full {
			break
		}
		page := r.Page(i)
		if page.V.IsNull() {
			continue
		}
		content, err := page.GetPlainText(nil)
		if err != nil {
			// Skip pages that fail to decode; best-effort, like PDFBox swallowing the page.
			continue
		}
		if strings.TrimSpace(content) == "" {
			continue // a scanned page with no text layer contributes nothing but a heading
		}
		out.heading(2, "Page "+strconv.Itoa(i))
		for _, line := range strings.Split(content, "\n") {
			out.textLine(line)
		}
	}
	return out.String(), nil
}
