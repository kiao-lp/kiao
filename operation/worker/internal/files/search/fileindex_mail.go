package search

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxMailParts = 200 // a MIME tree wider than this is a bomb, not a message
	maxMailDepth = 8   // ...and one deeper than this is the same thing
)

// mailDocument is what both `.eml` and `.msg` are read into, so the two formats produce the same
// index and only one renderer has to be right.
type mailDocument struct {
	subject     string
	from        string
	to          string
	cc          string
	bcc         string
	replyTo     string
	date        string
	body        string // plain text; already converted from HTML when that was all there was
	attachments []mailAttachment
}

// mailAttachment is one attached part, named but not opened.
type mailAttachment struct {
	name string
	mime string
}

// render writes the message as Markdown.
func (m *mailDocument) render() string {
	var out textBudget
	subject := strings.TrimSpace(m.subject)
	if subject == "" {
		subject = "(no subject)"
	}
	out.heading(1, subject)

	out.field("From", m.from)
	out.field("To", m.to)
	out.field("Cc", m.cc)
	out.field("Bcc", m.bcc)
	out.field("Reply-To", m.replyTo)
	out.field("Date", m.date)
	out.blankLine()

	if body := strings.TrimSpace(m.body); body != "" {
		out.heading(2, "Message")
		// Verbatim, and deliberately not escaped as Markdown: a mail body is where quoting with
		// ">" and dashed separators mean what they look like, and its blank lines are what keep
		// its paragraphs apart.
		out.verbatim(body)
		out.blankLine()
	}

	if len(m.attachments) > 0 {
		out.heading(2, "Attachments")
		for _, a := range m.attachments {
			label := a.name
			if a.mime != "" {
				label += " (" + a.mime + ")"
			}
			out.bullet(1, label)
		}
		out.blankLine()
	}
	return out.String()
}

// extractEmlText converts an RFC 5322 message file to Markdown.
func extractEmlText(absFile string) (string, error) {
	f, err := os.Open(absFile)
	if err != nil {
		return "", err
	}
	defer f.Close()

	msg, err := mail.ReadMessage(io.LimitReader(f, maxIndexSourceBytes))
	if err != nil {
		return "", fmt.Errorf("not a readable RFC 5322 message: %w", err)
	}

	doc := &mailDocument{
		subject: decodeMailHeader(msg.Header.Get("Subject")),
		from:    decodeMailHeader(msg.Header.Get("From")),
		to:      decodeMailHeader(msg.Header.Get("To")),
		cc:      decodeMailHeader(msg.Header.Get("Cc")),
		bcc:     decodeMailHeader(msg.Header.Get("Bcc")),
		replyTo: decodeMailHeader(msg.Header.Get("Reply-To")),
		date:    formatMailDate(msg.Header.Get("Date")),
	}

	budget := &mailPartBudget{}
	plain, html := readMailBody(msg.Header.Get("Content-Type"),
		msg.Header.Get("Content-Transfer-Encoding"), msg.Body, doc, budget, 0)
	doc.body = preferPlainBody(plain, html)
	return doc.render(), nil
}

// mailPartBudget bounds a MIME walk. Carried through the recursion rather than counted per level,
// because it is the total that has to be bounded.
type mailPartBudget struct{ parts int }

func (b *mailPartBudget) spent() bool {
	b.parts++
	return b.parts > maxMailParts
}

// preferPlainBody picks the body to index: the text alternative when the message carries one,
// the HTML one reduced to text when it does not. Never both — multipart/alternative means the
// same message twice, and indexing it twice would double every hit in it.
func preferPlainBody(plain, html string) string {
	if strings.TrimSpace(plain) != "" {
		return plain
	}
	return htmlToText(html)
}

// readMailBody walks one MIME entity, returning the plain-text and HTML bodies it found and
// appending every attachment it names to doc. Multipart entities recurse; leaves are decoded
// according to their transfer encoding and charset.
func readMailBody(contentType, encoding string, body io.Reader, doc *mailDocument, budget *mailPartBudget, depth int) (plain, html string) {
	if depth > maxMailDepth || budget.spent() {
		return "", ""
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		mediaType = "text/plain" // a message with no Content-Type is US-ASCII text, per RFC 2045
		params = map[string]string{}
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return "", ""
		}
		mr := multipart.NewReader(body, boundary)
		for {
			part, err := mr.NextPart()
			if err != nil {
				break // io.EOF, or a truncated message: keep what was read
			}
			if name := attachmentName(part.Header.Get("Content-Disposition"), part.Header.Get("Content-Type")); name != "" {
				doc.attachments = append(doc.attachments, mailAttachment{
					name: name,
					mime: mediaTypeOnly(part.Header.Get("Content-Type")),
				})
				part.Close()
				continue
			}
			p, h := readMailBody(part.Header.Get("Content-Type"),
				part.Header.Get("Content-Transfer-Encoding"), part, doc, budget, depth+1)
			part.Close()
			// The first alternative of each kind wins; later ones are the same text again.
			if plain == "" {
				plain = p
			}
			if html == "" {
				html = h
			}
		}
		return plain, html
	}

	if mediaType == "message/rfc822" {
		inner, err := mail.ReadMessage(io.LimitReader(body, maxZipEntryBytes))
		if err != nil {
			return "", ""
		}
		return readMailBody(inner.Header.Get("Content-Type"),
			inner.Header.Get("Content-Transfer-Encoding"), inner.Body, doc, budget, depth+1)
	}

	if !strings.HasPrefix(mediaType, "text/") {
		return "", "" // an image or a PDF with no filename: nothing to index, nothing to name
	}

	text := decodeCharset(decodeTransferEncoding(body, encoding), params["charset"])
	if mediaType == "text/html" {
		return "", text
	}
	return text, ""
}

// decodeTransferEncoding undoes the Content-Transfer-Encoding of a leaf part, capped at the
// per-part ceiling.
func decodeTransferEncoding(body io.Reader, encoding string) []byte {
	var r io.Reader = io.LimitReader(body, maxZipEntryBytes)
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "base64":
		r = base64.NewDecoder(base64.StdEncoding, newlineStripper{r})
	case "quoted-printable":
		r = quotedprintable.NewReader(r)
	}
	// Best-effort: a part that fails halfway through still contributes what decoded, which is
	// what an index of a damaged message should be.
	data, _ := io.ReadAll(r)
	return data
}

// newlineStripper drops the line breaks base64 bodies are wrapped at. encoding/base64 refuses
// them outright, so without this a perfectly ordinary MIME part decodes to nothing.
type newlineStripper struct{ r io.Reader }

// Read keeps going until it has at least one byte or the source is done. A read that returns
// nothing without an error is a shape callers are entitled not to expect, and a run of line
// breaks longer than the caller's buffer would produce exactly that.
func (s newlineStripper) Read(p []byte) (int, error) {
	for {
		n, err := s.r.Read(p)
		out := p[:0]
		for _, b := range p[:n] {
			if b != '\r' && b != '\n' {
				out = append(out, b)
			}
		}
		if len(out) > 0 || err != nil {
			return len(out), err
		}
	}
}

// attachmentName returns the file name of an attached part, or "" when the part is body text.
// A part is an attachment when it says so, or when it carries a file name — which is how the
// inline images of an HTML mail get named without being read.
func attachmentName(disposition, contentType string) string {
	if disposition != "" {
		if disp, params, err := mime.ParseMediaType(disposition); err == nil {
			if name := decodeMailHeader(params["filename"]); name != "" {
				return name
			}
			if disp == "attachment" {
				return "(unnamed attachment)"
			}
		}
	}
	if _, params, err := mime.ParseMediaType(contentType); err == nil {
		if name := decodeMailHeader(params["name"]); name != "" {
			return name
		}
	}
	return ""
}

func mediaTypeOnly(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return ""
	}
	return mediaType
}

// mailWordDecoder decodes RFC 2047 encoded words, including the legacy charsets Outlook and
// Thunderbird still emit — without a CharsetReader, mime refuses them and the subject line of a
// French mail comes back unreadable.
var mailWordDecoder = mime.WordDecoder{
	CharsetReader: func(charset string, input io.Reader) (io.Reader, error) {
		data, err := io.ReadAll(io.LimitReader(input, maxZipEntryBytes))
		if err != nil {
			return nil, err
		}
		return strings.NewReader(decodeCharset(data, charset)), nil
	},
}

// decodeMailHeader turns a raw header value into text: encoded words decoded, folding removed.
func decodeMailHeader(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if decoded, err := mailWordDecoder.DecodeHeader(value); err == nil {
		value = decoded
	}
	return strings.Join(strings.Fields(value), " ")
}

// formatMailDate normalises a Date header to RFC 3339, and keeps the original wording when it is
// not a date this can parse — an unreadable date is still evidence.
func formatMailDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if t, err := mail.ParseDate(value); err == nil {
		return t.Format(time.RFC3339)
	}
	return value
}

// decodeCharset turns the bytes of a part into a Go string.
//
// Only the charsets that actually turn up in mail are handled, and the fallback is what matters:
// bytes that are not valid UTF-8 are read as Windows-1252, which is the one guess that never
// produces replacement characters and is right far more often than not for European mail.
func decodeCharset(data []byte, charset string) string {
	switch normaliseCharset(charset) {
	case "utf8", "usascii", "":
		if utf8.Valid(data) {
			return string(data)
		}
	case "utf16le":
		return utf16LEString(data)
	}
	if utf8.Valid(data) {
		return string(data)
	}
	return decodeWindows1252(data)
}

func normaliseCharset(charset string) string {
	letters, digits := splitLettersDigits(strings.ToLower(strings.TrimSpace(charset)))
	switch letters + digits {
	case "utf8", "utf8bom":
		return "utf8"
	case "usascii", "ascii", "ansix341968", "iso646us":
		return "usascii"
	case "utf16le", "utf16", "unicode":
		return "utf16le"
	}
	return letters + digits
}

// windows1252High maps the bytes 0x80-0x9F, the range where Windows-1252 differs from
// ISO-8859-1 — and the range that holds the curly quotes, dashes and ellipsis every mail written
// in Word is full of. U+FFFD stands for the five bytes the encoding leaves undefined.
var windows1252High = [32]rune{
	'€', '�', '‚', 'ƒ', '„', '…', '†', '‡',
	'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�',
	'�', '‘', '’', '“', '”', '•', '–', '—',
	'˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ',
}

// decodeWindows1252 maps single-byte text to runes. ISO-8859-1 is the same map with the
// 0x80-0x9F block left as control characters, so this covers both: a control character there is
// never what a mail meant.
func decodeWindows1252(data []byte) string {
	var sb strings.Builder
	sb.Grow(len(data))
	for _, b := range data {
		switch {
		case b < 0x80:
			sb.WriteByte(b)
		case b < 0xA0:
			sb.WriteRune(windows1252High[b-0x80])
		default:
			sb.WriteRune(rune(b))
		}
	}
	return sb.String()
}
