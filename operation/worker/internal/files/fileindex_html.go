package files

import (
	"html"
	"strings"
)

// HTML reduced to text, for the mail formats: an HTML-only message has to become something a
// grep can answer, and something a person can read in the companion tab.
//
// A scanner rather than a parser. What an index needs from HTML is where the line breaks go and
// which subtrees are not text at all; recovering a document tree from the malformed markup mail
// clients produce would be a great deal of work for an answer nothing here asks.

// htmlBlockTags end a line when they open or close: their content is a block, so running it into
// the line before it would join two sentences that were never one.
var htmlBlockTags = map[string]bool{
	"p": true, "div": true, "br": true, "tr": true, "table": true, "ul": true, "ol": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"blockquote": true, "pre": true, "section": true, "article": true, "header": true,
	"footer": true, "nav": true, "aside": true, "hr": true, "form": true, "fieldset": true,
	"figure": true, "figcaption": true, "dl": true, "dt": true, "dd": true, "address": true,
}

// htmlDroppedTags are subtrees whose text is not document text.
var htmlDroppedTags = map[string]bool{
	"script": true, "style": true, "head": true, "title": true, "noscript": true,
	"template": true, "svg": true,
}

// htmlToText reduces an HTML document to the text it displays.
func htmlToText(source string) string {
	if strings.TrimSpace(source) == "" {
		return ""
	}

	var sb strings.Builder
	sb.Grow(len(source) / 2)
	dropDepth := 0
	i := 0

	for i < len(source) {
		c := source[i]
		if c != '<' {
			if dropDepth == 0 {
				// A newline in the source is whitespace, not a line break: HTML says where the
				// lines are with tags. Only the breaks this scanner writes itself survive.
				if c == '\n' || c == '\r' {
					c = ' '
				}
				sb.WriteByte(c)
			}
			i++
			continue
		}
		if strings.HasPrefix(source[i:], "<!--") {
			if end := strings.Index(source[i+4:], "-->"); end >= 0 {
				i += 4 + end + 3
			} else {
				i = len(source)
			}
			continue
		}

		name, closing, next := scanHTMLTag(source, i)
		i = next
		if name == "" {
			continue
		}
		switch {
		case htmlDroppedTags[name]:
			if closing {
				if dropDepth > 0 {
					dropDepth--
				}
			} else {
				dropDepth++
			}
		case dropDepth > 0:
			// inside a dropped subtree: structure there is not the document's either
		case name == "li":
			if !closing {
				sb.WriteString("\n- ")
			}
		case name == "td" || name == "th":
			if closing {
				sb.WriteString("\t")
			}
		case htmlBlockTags[name]:
			sb.WriteString("\n")
		}
	}

	return tidyHTMLText(html.UnescapeString(sb.String()))
}

// scanHTMLTag reads the tag starting at source[i] (which is '<'), returning its lowercased name,
// whether it is a closing tag, and the index just past it. Quoted attribute values are honoured,
// so a '>' inside one does not end the tag early.
func scanHTMLTag(source string, i int) (name string, closing bool, next int) {
	j := i + 1
	if j < len(source) && source[j] == '/' {
		closing = true
		j++
	}
	start := j
	for j < len(source) && isTagNameByte(source[j]) {
		j++
	}
	name = strings.ToLower(source[start:j])

	quote := byte(0)
	for j < len(source) {
		c := source[j]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '>':
			return name, closing, j + 1
		}
		j++
	}
	return name, closing, len(source)
}

func isTagNameByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_'
}

// tidyHTMLText collapses the whitespace HTML is written with: runs of spaces become one, runs of
// blank lines become one, and every line comes back trimmed. Without it the text of a mail
// composed in Outlook arrives with more indentation than words.
//
// Tabs are left alone, because this scanner writes them itself to separate table cells — they are
// structure it decided on, not whitespace the source happened to contain.
func tidyHTMLText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\u00a0", " ") // non-breaking space: a space, for a search

	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	blank := true // suppress leading blank lines
	for _, line := range lines {
		line = strings.Trim(collapseSpaces(line), " \t")
		if line == "" {
			if blank {
				continue
			}
			blank = true
		} else {
			blank = false
		}
		out = append(out, line)
	}
	return strings.TrimRight(strings.Join(out, "\n"), "\n")
}

// collapseSpaces reduces every run of spaces to one, leaving tabs untouched.
func collapseSpaces(line string) string {
	var sb strings.Builder
	sb.Grow(len(line))
	space := false
	for _, r := range line {
		if r == ' ' {
			space = true
			continue
		}
		if space && sb.Len() > 0 {
			sb.WriteByte(' ')
		}
		space = false
		sb.WriteRune(r)
	}
	if space && sb.Len() > 0 {
		sb.WriteByte(' ')
	}
	return sb.String()
}
