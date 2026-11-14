package search

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestExtractEmlText covers a message of the shape a mail client actually sends: a
// multipart/alternative body with both a text and an HTML rendering, an attachment, an RFC 2047
// subject and a quoted-printable part.
func TestExtractEmlText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "message.eml")
	mustWrite(t, src, strings.ReplaceAll(`From: Claire Dubois <claire@example.org>
To: Alex <alex@example.com>
Cc: equipe@example.org
Date: Tue, 03 Mar 2026 09:15:00 +0100
Subject: =?utf-8?Q?Rapport_trimestriel_=C3=A9tabli?=
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="OUTER"

--OUTER
Content-Type: multipart/alternative; boundary="INNER"

--INNER
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Bonjour Alex,

Le rapport est pr=C3=AAt. La migration est pr=C3=A9vue le 14 mars.

--INNER
Content-Type: text/html; charset="utf-8"

<html><body><p>Bonjour Alex,</p></body></html>
--INNER--

--OUTER
Content-Type: application/pdf; name="rapport.pdf"
Content-Disposition: attachment; filename="rapport.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--OUTER--
`, "\n", "\r\n"))

	got, err := extractEmlText(src)
	if err != nil {
		t.Fatal(err)
	}

	// The subject is the document's title, decoded out of its encoded word.
	if !strings.HasPrefix(got, "# Rapport trimestriel établi\n") {
		t.Errorf("subject heading missing or not decoded:\n%q", got)
	}
	for _, want := range []string{
		"**From:** Claire Dubois <claire@example.org>",
		"**To:** Alex <alex@example.com>",
		"**Cc:** equipe@example.org",
		"**Date:** 2026-03-03T09:15:00+01:00", // normalised, so dates sort and compare
		"## Message",
		"Le rapport est prêt.", // quoted-printable decoded
		"## Attachments",
		"- rapport.pdf (application/pdf)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("index is missing %q:\n%s", want, got)
		}
	}

	// multipart/alternative is the same message twice. Indexing both would double every hit in
	// it, so the text alternative wins and the HTML one is dropped.
	if strings.Count(got, "Bonjour Alex") != 1 {
		t.Errorf("the HTML alternative was indexed alongside the text one:\n%s", got)
	}
	// The attachment is named, not opened: its bytes are not text of this document.
	if strings.Contains(got, "JVBERi") {
		t.Errorf("attachment payload leaked into the index:\n%s", got)
	}
}

// TestExtractEmlHtmlOnly pins the fallback: a message with no text alternative is indexed through
// its HTML, reduced to what it displays.
func TestExtractEmlHtmlOnly(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "html.eml")
	mustWrite(t, src, strings.ReplaceAll(`Subject: Release notes
From: build@example.org
Content-Type: text/html; charset="iso-8859-1"

<html><head><style>p{color:red}</style></head><body>
<h1>Release 2.4</h1><p>D&eacute;ploy&eacute; en pr&eacute;-production.</p>
<ul><li>Recherche plein texte</li><li>Index Markdown</li></ul>
</body></html>
`, "\n", "\r\n"))

	got, err := extractEmlText(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Release 2.4", "Déployé en pré-production.", "- Recherche plein texte"} {
		if !strings.Contains(got, want) {
			t.Errorf("index is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "color:red") {
		t.Errorf("a stylesheet is not document text:\n%s", got)
	}
}

// TestExtractEmlBareMessage covers the minimum: no MIME at all, which is still a valid message.
func TestExtractEmlBareMessage(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "bare.eml")
	mustWrite(t, src, "Subject: Ping\r\n\r\nAre we still on for Thursday?\r\n")

	got, err := extractEmlText(src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "# Ping") || !strings.Contains(got, "Are we still on for Thursday?") {
		t.Errorf("bare message index = %q", got)
	}
}

func TestExtractEmlRejectsNonMessage(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "notmail.eml")
	// No header block at all: net/mail cannot read it, and a document that is not a message must
	// fail rather than be indexed as an empty one.
	mustWriteBytes(t, src, []byte{0x00, 0x01, 0x02, 0x03})
	if _, err := extractEmlText(src); err == nil {
		t.Errorf("expected an error for a file that is not a message")
	}
}

func TestHtmlToText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"blocks separate paragraphs", "<p>One</p><p>Two</p>", "One\n\nTwo"},
		{"br breaks a line", "First<br>Second", "First\nSecond"},
		{"list items become bullets", "<ul><li>A</li><li>B</li></ul>", "- A\n- B"},
		{"scripts are not text", "<script>alert(1)</script>Visible", "Visible"},
		{"entities are decoded", "caf&eacute; &amp; th&eacute;", "café & thé"},
		{"comments are dropped", "before<!-- hidden -->after", "beforeafter"},
		// A '>' inside an attribute must not end the tag early, or the rest of the attribute
		// would be read as text.
		{"quoted attributes", `<a href="x?a=1&gt;2" title="a > b">link</a>`, "link"},
		{"cells are separated", "<table><tr><td>a</td><td>b</td></tr></table>", "a\tb"},
		{"whitespace collapses", "<p>  lots   of\n\n   space  </p>", "lots of space"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := htmlToText(c.in); got != c.want {
				t.Errorf("htmlToText(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestDecodeCharset(t *testing.T) {
	// Windows-1252 is the fallback for bytes that are not UTF-8: it is the one guess that never
	// produces replacement characters for European mail.
	if got := decodeCharset([]byte{'c', 'a', 'f', 0xE9}, "iso-8859-1"); got != "café" {
		t.Errorf("iso-8859-1 = %q, want %q", got, "café")
	}
	if got := decodeCharset([]byte{0x93, 'h', 'i', 0x94}, "windows-1252"); got != "“hi”" {
		t.Errorf("windows-1252 curly quotes = %q", got)
	}
	if got := decodeCharset([]byte("déjà"), "utf-8"); got != "déjà" {
		t.Errorf("utf-8 = %q", got)
	}
	// An unlabelled part that happens to be valid UTF-8 is UTF-8.
	if got := decodeCharset([]byte("déjà"), ""); got != "déjà" {
		t.Errorf("unlabelled utf-8 = %q", got)
	}
}
