package search

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type termKind uint8

const (
	termWord   termKind = iota // case-insensitive substring
	termPhrase                 // exact-case substring
	termRegex                  // RE2
)

type searchTerm struct {
	kind    termKind
	negated bool
	text    string         // word: lowercased; phrase: as typed; unused for a regex
	re      *regexp.Regexp // regex terms only
}

// Word terms require lowerS = strings.ToLower(s), computed once per line by the caller.
func (t *searchTerm) matches(s, lowerS string) bool {
	switch t.kind {
	case termWord:
		return strings.Contains(lowerS, t.text)
	case termPhrase:
		return strings.Contains(s, t.text)
	default:
		return t.re.MatchString(s)
	}
}

type searchQuery struct {
	terms     []searchTerm
	needLower bool // at least one word term, so each line has to be lowercased
	positives int
}

func (sq *searchQuery) empty() bool { return len(sq.terms) == 0 }

// parseSearchQuery returns errBadPattern for invalid regexes and queries containing only negations.
func parseSearchQuery(q string) (*searchQuery, error) {
	sq := &searchQuery{}
	for i := 0; i < len(q); {
		if w := spaceWidth(q, i); w > 0 {
			i += w
			continue
		}
		// A lone '-' stays literal; quote "-x" to search for a leading hyphen.
		negated := false
		if q[i] == '-' && i+1 < len(q) && spaceWidth(q, i+1) == 0 {
			negated = true
			i++
		}

		var term searchTerm
		switch {
		case q[i] == '"':
			text, end := scanPhrase(q, i)
			i = end
			if text == "" {
				continue // an empty phrase matches every line; drop it rather than return the tree
			}
			term = searchTerm{kind: termPhrase, negated: negated, text: text}

		default:
			if body, ci, end, ok := scanRegex(q, i); ok {
				re, err := compileSearchRegex(body, ci)
				if err != nil {
					return nil, err
				}
				i = end
				term = searchTerm{kind: termRegex, negated: negated, re: re}
			} else {
				text, end := scanWord(q, i)
				i = end
				term = searchTerm{kind: termWord, negated: negated, text: strings.ToLower(text)}
				sq.needLower = true
			}
		}

		if !negated {
			sq.positives++
		}
		sq.terms = append(sq.terms, term)
	}

	if len(sq.terms) > 0 && sq.positives == 0 {
		return nil, fmt.Errorf("%w: a search needs at least one word, phrase or /regex/ that is not negated", ErrBadPattern)
	}
	return sq, nil
}

// matchDocument uses the source's base name, not its index filename.
// Keep matching satisfied terms so every line containing a positive hit is reported.
func (sq *searchQuery) matchDocument(name string, lines []string) ([]SearchMatch, bool) {
	satisfied := make([]bool, len(sq.terms))
	lowerName := strings.ToLower(name)
	for i := range sq.terms {
		if !sq.terms[i].matches(name, lowerName) {
			continue
		}
		if sq.terms[i].negated {
			return nil, false
		}
		satisfied[i] = true
	}

	// Name-only hits must serialize as [] rather than null for clients.
	matches := []SearchMatch{}
	for n, line := range lines {
		lower := line
		if sq.needLower {
			lower = strings.ToLower(line)
		}
		hit := false
		for i := range sq.terms {
			t := &sq.terms[i]
			if !t.matches(line, lower) {
				continue
			}
			if t.negated {
				return nil, false
			}
			satisfied[i] = true
			hit = true
		}
		if !hit {
			continue
		}
		content := strings.TrimSpace(line)
		matches = append(matches, SearchMatch{Line: n + 1, Content: content, Ranges: sq.highlight(content)})
	}

	// Negated matches already reject the document; only positive terms need to be satisfied.
	for i := range sq.terms {
		if !satisfied[i] && !sq.terms[i].negated {
			return nil, false
		}
	}
	return matches, true
}

// highlight merges positive hits into UTF-16 ranges so clients need not reimplement the grammar.
func (sq *searchQuery) highlight(s string) [][2]int {
	var found [][2]int
	for i := range sq.terms {
		if !sq.terms[i].negated {
			found = sq.terms[i].appendRanges(found, s)
		}
	}
	if len(found) == 0 {
		return nil
	}
	sort.Slice(found, func(a, b int) bool {
		if found[a][0] != found[b][0] {
			return found[a][0] < found[b][0]
		}
		return found[a][1] < found[b][1]
	})
	merged := found[:1]
	for _, r := range found[1:] {
		last := &merged[len(merged)-1]
		if r[0] <= last[1] {
			if r[1] > last[1] {
				last[1] = r[1]
			}
			continue
		}
		merged = append(merged, r)
	}
	return toUTF16Ranges(s, merged)
}

// appendRanges adds the byte ranges of every occurrence of the term in s.
func (t *searchTerm) appendRanges(dst [][2]int, s string) [][2]int {
	switch t.kind {
	case termWord:
		for i := 0; i < len(s); {
			start, end := indexFold(s, t.text, i)
			if start < 0 || end == start {
				break
			}
			dst = append(dst, [2]int{start, end})
			i = end
		}
	case termPhrase:
		for i := 0; i+len(t.text) <= len(s); {
			k := strings.Index(s[i:], t.text)
			if k < 0 {
				break
			}
			dst = append(dst, [2]int{i + k, i + k + len(t.text)})
			i += k + len(t.text)
		}
	default:
		for _, m := range t.re.FindAllStringIndex(s, -1) {
			if m[1] > m[0] {
				dst = append(dst, [2]int{m[0], m[1]})
			}
		}
	}
	return dst
}

// toUTF16Ranges converts ascending, non-overlapping byte ranges to JavaScript string offsets.
// Scan s once to keep long lines affordable.
func toUTF16Ranges(s string, byteRanges [][2]int) [][2]int {
	out := make([][2]int, 0, len(byteRanges))
	unit, at := 0, 0
	advance := func(target int) int {
		for at < target && at < len(s) {
			r, size := utf8.DecodeRuneInString(s[at:])
			at += size
			unit++
			if r > 0xFFFF {
				unit++
			}
		}
		return unit
	}
	for _, r := range byteRanges {
		start := advance(r[0])
		out = append(out, [2]int{start, advance(r[1])})
	}
	return out
}

// indexFold returns byte bounds of the first case-insensitive hit at or after from.
// Walk original runes: lowercasing can change byte lengths (e.g. İ) and invalidate offsets.
func indexFold(s, lowerNeedle string, from int) (int, int) {
	if lowerNeedle == "" {
		return -1, -1
	}
	for i := from; i < len(s); {
		if n := matchFoldAt(s[i:], lowerNeedle); n >= 0 {
			return i, i + n
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return -1, -1
}

// matchFoldAt returns the byte length of lowerNeedle matched at the start of s, or -1.
func matchFoldAt(s, lowerNeedle string) int {
	consumed := 0
	for _, want := range lowerNeedle {
		if consumed >= len(s) {
			return -1
		}
		r, size := utf8.DecodeRuneInString(s[consumed:])
		if unicode.ToLower(r) != want {
			return -1
		}
		consumed += size
	}
	return consumed
}

// scanPhrase reads from the quote q[i], unescaping only \" and \\.
// Other backslashes stay literal; an unterminated quote consumes the remaining input.
func scanPhrase(q string, i int) (string, int) {
	var b strings.Builder
	for i++; i < len(q); {
		switch {
		case q[i] == '"':
			return b.String(), i + 1
		case q[i] == '\\' && i+1 < len(q) && (q[i+1] == '"' || q[i+1] == '\\'):
			b.WriteByte(q[i+1])
			i += 2
		default:
			b.WriteByte(q[i])
			i++
		}
	}
	return b.String(), i
}

// scanRegex accepts a non-empty /regex/ or /regex/i token ending at whitespace or EOF.
// Malformed tokens fall back to words, preserving paths such as /units/foo and /units/is.
func scanRegex(q string, i int) (body string, ci bool, end int, ok bool) {
	if q[i] != '/' {
		return "", false, 0, false
	}
	j := i + 1
	for j < len(q) {
		if spaceWidth(q, j) > 0 {
			return "", false, 0, false // a regex is one token; write \s or \  for a space
		}
		if q[j] == '\\' {
			j += 2
			continue
		}
		if q[j] == '/' {
			break
		}
		j++
	}
	if j >= len(q) || q[j] != '/' {
		return "", false, 0, false
	}
	if body = q[i+1 : j]; body == "" {
		return "", false, 0, false
	}
	end = j + 1
	if end < len(q) && q[end] == 'i' {
		ci = true
		end++
	}
	if end < len(q) && spaceWidth(q, end) == 0 {
		return "", false, 0, false
	}
	return body, ci, end, true
}

func scanWord(q string, i int) (string, int) {
	j := i
	for j < len(q) {
		w := spaceWidth(q, j)
		if w > 0 {
			break
		}
		_, size := utf8.DecodeRuneInString(q[j:])
		j += size
	}
	return q[i:j], j
}

// spaceWidth returns the whitespace rune's byte width, or 0; include NBSPs from pasted French text.
func spaceWidth(q string, i int) int {
	if c := q[i]; c < utf8.RuneSelf {
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f' {
			return 1
		}
		return 0
	}
	r, size := utf8.DecodeRuneInString(q[i:])
	if unicode.IsSpace(r) {
		return size
	}
	return 0
}

// Case-insensitivity is opt-in to preserve the meaning of explicit character classes.
func compileSearchRegex(body string, ci bool) (*regexp.Regexp, error) {
	expr := body
	if ci {
		expr = "(?i)" + expr
	}
	re, err := regexp.Compile(expr)
	if err != nil {
		return nil, fmt.Errorf("%w /%s/: %v", ErrBadPattern, body, err)
	}
	return re, nil
}
