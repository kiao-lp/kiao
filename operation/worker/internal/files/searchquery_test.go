package files

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// describe renders a parsed term as "kind:payload", with a leading '-' for a negation, so a table
// can state an expectation in one readable string.
func describe(t searchTerm) string {
	var s string
	switch t.kind {
	case termWord:
		s = "word:" + t.text
	case termPhrase:
		s = "phrase:" + t.text
	default:
		s = "regex:" + t.re.String()
	}
	if t.negated {
		return "-" + s
	}
	return s
}

func parseTerms(t *testing.T, q string) []string {
	t.Helper()
	sq, err := parseSearchQuery(q)
	if err != nil {
		t.Fatalf("parse(%q): %v", q, err)
	}
	out := make([]string, 0, len(sq.terms))
	for _, term := range sq.terms {
		out = append(out, describe(term))
	}
	return out
}

// TestParseSearchQuery is the specification of the query language: every row is a documented
// behaviour, and the fallback rows are what keep path fragments and stray quotes searchable.
func TestParseSearchQuery(t *testing.T) {
	cases := []struct {
		query string
		want  []string
	}{
		// Words are lowercased at parse time; the AND between them is implicit.
		{"mot1 mot2 mot3", []string{"word:mot1", "word:mot2", "word:mot3"}},
		{"  Plan   Budget  ", []string{"word:plan", "word:budget"}},
		{"", nil},
		{"   ", nil},

		// Phrases keep their case, and only \" and \\ are escapes.
		{`"Mon Expression"`, []string{"phrase:Mon Expression"}},
		{`"a \" b"`, []string{`phrase:a " b`}},
		{`"a \\ b"`, []string{`phrase:a \ b`}},
		{`"C:\Users"`, []string{`phrase:C:\Users`}},
		{`"unterminated`, []string{"phrase:unterminated"}},
		{`"abc\`, []string{`phrase:abc\`}},
		{`""`, nil},
		{`"" mot`, []string{"word:mot"}},
		{`a"b`, []string{`word:a"b`}}, // a quote only opens a phrase at the start of a token

		// Regexes, and the fallbacks that keep slashes usable in ordinary words.
		{"/foo/", []string{"regex:foo"}},
		{"/foo/i", []string{"regex:(?i)foo"}},
		{"/foo/ bar", []string{"regex:foo", "word:bar"}},
		{"/foo/bar", []string{"word:/foo/bar"}},
		{"units/foo", []string{"word:units/foo"}},
		{"/units/foo", []string{"word:/units/foo"}},
		{"//", []string{"word://"}},
		{"/units/i", []string{"regex:(?i)units"}}, // documented false positive; quote it to force a word
		{`"/units/i"`, []string{"phrase:/units/i"}},
		{"/a b/", []string{"word:/a", "word:b/"}}, // a regex is one whitespace-free token
		{`/a\/b/`, []string{`regex:a\/b`}},
		{`/a\ b/`, []string{`regex:a\ b`}},

		// Combining the three forms is the whole point.
		{`mot "Mon Expression" /re/`, []string{"word:mot", "phrase:Mon Expression", "regex:re"}},

		// Negation, and the two shapes that are not one.
		{"plan -brouillon", []string{"word:plan", "-word:brouillon"}},
		{`plan -"Plan B"`, []string{"word:plan", `-phrase:Plan B`}},
		{`plan -/v\d+/`, []string{"word:plan", `-regex:v\d+`}},
		{"-", []string{"word:-"}},
		{"mot - x", []string{"word:mot", "word:-", "word:x"}},
		{"mot --x", []string{"word:mot", "-word:-x"}}, // only the first '-' negates

		// Unicode: lowercasing is rune-aware, and a non-breaking space still separates terms.
		{"Été", []string{"word:été"}},
		{"un\u00a0deux", []string{"word:un", "word:deux"}},
	}

	for _, c := range cases {
		got := parseTerms(t, c.query)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("parse(%q) = %v, want %v", c.query, got, c.want)
		}
	}
}

func TestParseSearchQueryRejectsBadRegex(t *testing.T) {
	for _, q := range []string{"/[/", "/(/", "/a{2,1}/", "ok /[/ also"} {
		err := func() error { _, err := parseSearchQuery(q); return err }()
		if err == nil {
			t.Errorf("parse(%q) should have failed", q)
			continue
		}
		if !errors.Is(err, errBadPattern) {
			t.Errorf("parse(%q) error = %v, want errBadPattern", q, err)
		}
		// The message reaches the search box, so it has to name the offending pattern.
		if !strings.Contains(err.Error(), "/[/") && !strings.Contains(err.Error(), "/(/") && !strings.Contains(err.Error(), "a{2,1}") {
			t.Errorf("parse(%q) error = %q, should quote the pattern", q, err)
		}
	}
}

func TestParseSearchQueryRejectsOnlyNegations(t *testing.T) {
	_, err := parseSearchQuery(`-draft -"Plan B"`)
	if !errors.Is(err, errBadPattern) {
		t.Errorf("a query of only negations should be refused, got %v", err)
	}
	if _, err := parseSearchQuery("plan -draft"); err != nil {
		t.Errorf("one positive term is enough: %v", err)
	}
}

func TestSearchTermMatches(t *testing.T) {
	cases := []struct {
		query string
		line  string
		want  bool
	}{
		{"motif", "Le MOTIF est clair", true},   // words ignore case…
		{"mot", "Le motif est clair", true},     // …and match inside a longer word
		{`"MOTIF"`, "Le MOTIF est clair", true}, // phrases keep case
		{`"motif"`, "Le MOTIF est clair", false},
		{"/M.TIF/", "Le MOTIF est clair", true}, // regexes are case-sensitive by default
		{"/m.tif/", "Le MOTIF est clair", false},
		{"/m.tif/i", "Le MOTIF est clair", true},
		{`/\bmot\b/`, "Le motif est clair", false}, // the replacement for the old whole-word toggle
		{`/\bmot\b/`, "Le mot est clair", true},
	}
	for _, c := range cases {
		sq, err := parseSearchQuery(c.query)
		if err != nil {
			t.Fatalf("parse(%q): %v", c.query, err)
		}
		got := sq.terms[0].matches(c.line, strings.ToLower(c.line))
		if got != c.want {
			t.Errorf("%q against %q = %v, want %v", c.query, c.line, got, c.want)
		}
	}
}

// TestMatchDocumentAndsAcrossLines is the headline behaviour: the AND holds at document level, so
// two words satisfy a file even when they never share a line.
func TestMatchDocumentAndsAcrossLines(t *testing.T) {
	sq, err := parseSearchQuery("alpha beta")
	if err != nil {
		t.Fatal(err)
	}

	matches, ok := sq.matchDocument("doc.md", []string{"alpha here", "nothing", "and beta"})
	if !ok {
		t.Fatal("both terms are present in the document, it should match")
	}
	if len(matches) != 2 || matches[0].Line != 1 || matches[1].Line != 3 {
		t.Errorf("matched lines = %+v, want lines 1 and 3", matches)
	}

	if _, ok := sq.matchDocument("doc.md", []string{"alpha here", "nothing"}); ok {
		t.Error("a document missing one term must not match")
	}

	// One line satisfying both terms yields exactly one match, not one per term.
	matches, ok = sq.matchDocument("doc.md", []string{"alpha and beta"})
	if !ok || len(matches) != 1 {
		t.Errorf("a line satisfying two terms should be reported once, got %+v", matches)
	}
}

func TestMatchDocumentUsesTheFileName(t *testing.T) {
	sq, _ := parseSearchQuery("glossaire")

	// A name-only hit is a match with no lines — that is how a binary or an oversized file is found.
	matches, ok := sq.matchDocument("glossaire.md", nil)
	if !ok || len(matches) != 0 {
		t.Errorf("name-only hit = (%v, %+v), want (true, no matches)", ok, matches)
	}
	if _, ok := sq.matchDocument("notes.md", nil); ok {
		t.Error("neither name nor content matched, the file should be rejected")
	}
	// The name satisfies one term, the content the other.
	sq, _ = parseSearchQuery("glossaire alpha")
	if _, ok := sq.matchDocument("glossaire.md", []string{"alpha"}); !ok {
		t.Error("a term satisfied by the name and one by the content should combine")
	}
}

func TestMatchDocumentNegation(t *testing.T) {
	sq, _ := parseSearchQuery("plan -draft")

	if _, ok := sq.matchDocument("a.md", []string{"the plan"}); !ok {
		t.Error("document without the excluded word should match")
	}
	if _, ok := sq.matchDocument("a.md", []string{"the plan", "a draft"}); ok {
		t.Error("a negated term present anywhere must reject the document")
	}
	// A negation applies to the file name too.
	if _, ok := sq.matchDocument("draft.md", []string{"the plan"}); ok {
		t.Error("a negated term matching the name must reject the document")
	}
}

// TestHighlightRangesAreUTF16 pins the offsets the browser slices Content with. Byte offsets would
// slide every highlight on an accented line, which is most French content.
func TestHighlightRangesAreUTF16(t *testing.T) {
	sq, _ := parseSearchQuery("élève")
	matches, ok := sq.matchDocument("x.md", []string{"un ÉLÈVE ici"})
	if !ok || len(matches) != 1 {
		t.Fatalf("expected one match, got %+v", matches)
	}
	// "un " is 3 UTF-16 units, "ÉLÈVE" is 5 — in bytes it would be 3 and 7.
	if want := [][2]int{{3, 8}}; !reflect.DeepEqual(matches[0].Ranges, want) {
		t.Errorf("ranges = %v, want %v", matches[0].Ranges, want)
	}

	// An emoji is two UTF-16 units, unlike its single rune.
	sq, _ = parseSearchQuery("fin")
	matches, _ = sq.matchDocument("x.md", []string{"🎉 fin"})
	if want := [][2]int{{3, 6}}; !reflect.DeepEqual(matches[0].Ranges, want) {
		t.Errorf("ranges after an emoji = %v, want %v", matches[0].Ranges, want)
	}
}

func TestHighlightMergesOverlappingRanges(t *testing.T) {
	// "plan" and the phrase "Plan B" overlap; the UI must get one span, not two.
	sq, _ := parseSearchQuery(`plan "Plan B"`)
	matches, ok := sq.matchDocument("x.md", []string{"see Plan B now"})
	if !ok || len(matches) != 1 {
		t.Fatalf("expected one match, got %+v", matches)
	}
	if want := [][2]int{{4, 10}}; !reflect.DeepEqual(matches[0].Ranges, want) {
		t.Errorf("ranges = %v, want %v (merged)", matches[0].Ranges, want)
	}

	// Every occurrence is reported, and a negated term never highlights.
	sq, _ = parseSearchQuery("plan -zzz")
	matches, _ = sq.matchDocument("x.md", []string{"plan and plan"})
	if want := [][2]int{{0, 4}, {9, 13}}; !reflect.DeepEqual(matches[0].Ranges, want) {
		t.Errorf("ranges = %v, want %v", matches[0].Ranges, want)
	}
}

// TestHighlightRangesTrackTrimmedContent guards the pairing that is easy to get wrong: matching runs
// on the raw line, but Ranges index Content, which is trimmed.
func TestHighlightRangesTrackTrimmedContent(t *testing.T) {
	sq, _ := parseSearchQuery("alpha")
	matches, ok := sq.matchDocument("x.md", []string{"      alpha"})
	if !ok || len(matches) != 1 {
		t.Fatalf("expected one match, got %+v", matches)
	}
	if matches[0].Content != "alpha" {
		t.Fatalf("content = %q, want the trimmed line", matches[0].Content)
	}
	if want := [][2]int{{0, 5}}; !reflect.DeepEqual(matches[0].Ranges, want) {
		t.Errorf("ranges = %v, want %v (offsets into the trimmed content)", matches[0].Ranges, want)
	}
}
