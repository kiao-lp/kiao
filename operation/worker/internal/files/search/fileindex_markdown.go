package search

import (
	"strings"
)

// textBudget caps untrusted extraction at maxIndexTextBytes. A partial index remains
// searchable; failing would leave it unsearchable and retried on every search.
type textBudget struct {
	sb    strings.Builder
	full  bool
	blank bool // ends on a blank line, or is empty
}

func (b *textBudget) writeString(s string) {
	if b.full || s == "" {
		return
	}
	if remaining := maxIndexTextBytes - b.sb.Len(); len(s) > remaining {
		b.sb.WriteString(s[:remaining])
		b.full = true
		return
	}
	b.sb.WriteString(s)
}

// line drops whitespace-only lines (including XML indentation) so search line numbers
// refer to content. Intentional separators use blankLine.
func (b *textBudget) line(s string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}
	b.rawLine(s)
}

// rawLine preserves caller indentation but drops whitespace-only lines.
func (b *textBudget) rawLine(s string) {
	if strings.TrimSpace(s) == "" {
		return
	}
	b.writeString(s)
	b.writeString("\n")
	b.blank = false
}

// blankLine is idempotent and emits nothing at the start of a document.
func (b *textBudget) blankLine() {
	if b.blank || b.sb.Len() == 0 {
		return
	}
	b.writeString("\n")
	b.blank = true
}

func (b *textBudget) heading(level int, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	b.blankLine()
	b.line(strings.Repeat("#", clampLevel(level)) + " " + escapeMarkdownLine(text))
	b.blankLine()
}

// bullet uses depth 1 for the top level.
func (b *textBudget) bullet(depth int, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if depth < 1 {
		depth = 1
	}
	if depth > 6 {
		depth = 6
	}
	b.rawLine(strings.Repeat("  ", depth-1) + "- " + escapeMarkdownLine(text))
}

func (b *textBudget) paragraph(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	b.line(escapeMarkdownLine(text))
	b.blankLine()
}

// verbatim preserves message layout, trimming trailing whitespace on each line.
func (b *textBudget) verbatim(text string) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	for _, line := range strings.Split(strings.Trim(text, "\n"), "\n") {
		line = strings.TrimRight(line, " \t")
		if line == "" {
			b.blankLine()
			continue
		}
		b.writeString(line)
		b.writeString("\n")
		b.blank = false
	}
}

// field uses a list item so consecutive header fields do not render as one paragraph.
func (b *textBudget) field(name, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	b.rawLine("- **" + name + ":** " + escapeMarkdownLine(value))
}

// textLine keeps wrapped prose (e.g. PDF lines) in the same paragraph.
func (b *textBudget) textLine(s string) {
	b.line(escapeMarkdownLine(s))
}

func (b *textBudget) tableRow(cells []string, header bool) {
	if len(cells) == 0 {
		return
	}
	if header {
		b.blankLine()
	}
	escaped := make([]string, len(cells))
	for i, c := range cells {
		escaped[i] = escapeTableCell(c)
	}
	b.line("| " + strings.Join(escaped, " | ") + " |")
	if header {
		b.line("|" + strings.Repeat(" --- |", len(cells)))
	}
}

func (b *textBudget) String() string {
	text := b.sb.String()
	if trimmed := strings.TrimRight(text, "\n"); len(trimmed) < len(text) {
		return trimmed + "\n"
	}
	return text
}

func clampLevel(level int) int {
	if level < 1 {
		return 1
	}
	if level > 6 {
		return 6
	}
	return level
}

// Escape only openings that could invent headings, tables or code blocks. Keep list
// markers and other punctuation literal: extra escapes break exact-phrase searches.
func escapeMarkdownLine(s string) string {
	trimmed := strings.TrimLeft(s, " \t")
	if trimmed == "" {
		return s
	}
	switch {
	case strings.HasPrefix(trimmed, "#"), strings.HasPrefix(trimmed, "|"), strings.HasPrefix(trimmed, "```"):
		return "\\" + trimmed
	default:
		return trimmed
	}
}

func escapeTableCell(s string) string {
	s = strings.ReplaceAll(s, "|", `\|`)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\n", "<br>")
	return strings.TrimSpace(s)
}

// csvRow quotes per RFC 4180 without csv.Writer buffering beyond the text budget.
func (b *textBudget) csvRow(cells []string) {
	if len(cells) == 0 {
		return
	}
	var row strings.Builder
	for i, c := range cells {
		if i > 0 {
			row.WriteByte(',')
		}
		row.WriteString(csvField(c))
	}
	// Preserve empty fields and records; the caller decides whether to omit blank rows.
	b.writeString(row.String())
	b.writeString("\n")
	b.blank = false
}

func csvField(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.ContainsAny(s, ",\"\n\r") {
		return s
	}
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// CSV has no comments: sheet separators are one-field records spelled as Markdown headings.
func (b *textBudget) csvComment(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	b.csvRow([]string{"# " + text})
}
