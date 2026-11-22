package search

import (
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// MAPI property ids this reader knows. Names are the PidTag names, which is what makes the
// numbers checkable against the specification.
const (
	pidSubject             = 0x0037
	pidBody                = 0x1000
	pidBodyHTML            = 0x1013
	pidSenderName          = 0x0C1A
	pidSenderEmailAddress  = 0x0C1F
	pidSenderSmtpAddress   = 0x5D01
	pidSentRepresentingSMT = 0x5D02
	pidDisplayTo           = 0x0E04
	pidDisplayCc           = 0x0E03
	pidDisplayBcc          = 0x0E02
	pidTransportHeaders    = 0x007D
	pidMessageDeliveryTime = 0x0E06
	pidClientSubmitTime    = 0x0039
	pidAttachLongFilename  = 0x3707
	pidAttachFilename      = 0x3704
	pidAttachMimeTag       = 0x370E
)

// MAPI property types, the low word of a property tag.
const (
	ptypeString8 = 0x001E // single-byte text, in the message's code page
	ptypeUnicode = 0x001F // UTF-16LE
	ptypeBinary  = 0x0102
	ptypeSysTime = 0x0040
)

// msgFixedHeaderTopLevel is the size of the header of a top-level message's property stream. The
// sub-storages use shorter ones, but nothing here reads a sub-storage's fixed properties.
const msgFixedHeaderTopLevel = 32

// msgStorage is one storage of the compound file, with its children resolved by name — which is
// all the addressing the format needs, since every property is a stream whose name is its tag.
type msgStorage struct {
	f        *cfbFile
	streams  map[string]uint32
	storages map[string]uint32
}

func newMsgStorage(f *cfbFile, id uint32) *msgStorage {
	s := &msgStorage{f: f, streams: map[string]uint32{}, storages: map[string]uint32{}}
	for _, child := range f.children(id) {
		e := f.entries[child]
		switch e.objectType {
		case cfbTypeStream:
			s.streams[e.name] = child
		case cfbTypeStorage:
			s.storages[e.name] = child
		}
	}
	return s
}

// property returns the raw bytes of a property stream, or nil.
func (s *msgStorage) property(id uint16, ptype uint16) []byte {
	name := fmt.Sprintf("__substg1.0_%04X%04X", id, ptype)
	streamID, ok := s.streams[name]
	if !ok {
		return nil
	}
	return s.f.stream(streamID)
}

// text returns a string property, preferring the Unicode spelling and falling back to the
// single-byte one — which is what every .msg written before Outlook 2003 has.
func (s *msgStorage) text(id uint16) string {
	if raw := s.property(id, ptypeUnicode); raw != nil {
		return strings.TrimRight(utf16LEString(raw), "\x00")
	}
	if raw := s.property(id, ptypeString8); raw != nil {
		return strings.TrimRight(decodeCharset(raw, ""), "\x00")
	}
	return ""
}

// binary returns a PT_BINARY property, which is how Outlook stores an HTML body.
func (s *msgStorage) binary(id uint16) []byte {
	return s.property(id, ptypeBinary)
}

// systime reads a PT_SYSTIME property out of the fixed-size property stream.
//
// Times are the one thing not stored as a named stream: they are 8-byte values inside
// `__properties_version1.0`, a flat table of 16-byte records after a header whose size depends on
// what kind of storage this is.
func (s *msgStorage) systime(id uint16) (time.Time, bool) {
	streamID, ok := s.streams["__properties_version1.0"]
	if !ok {
		return time.Time{}, false
	}
	raw := s.f.stream(streamID)
	for off := msgFixedHeaderTopLevel; off+16 <= len(raw); off += 16 {
		tag := binary.LittleEndian.Uint32(raw[off : off+4])
		if uint16(tag>>16) != id || uint16(tag) != ptypeSysTime {
			continue
		}
		filetime := binary.LittleEndian.Uint64(raw[off+8 : off+16])
		if filetime == 0 {
			return time.Time{}, false
		}
		return filetimeToTime(filetime), true
	}
	return time.Time{}, false
}

// filetimeToTime converts a Windows FILETIME — 100-nanosecond ticks since 1601-01-01 UTC — to a
// Go time.
func filetimeToTime(ticks uint64) time.Time {
	const ticksPerSecond = 10_000_000
	const epochDeltaSeconds = 11644473600 // 1601-01-01 to 1970-01-01
	seconds := int64(ticks/ticksPerSecond) - epochDeltaSeconds
	nanos := int64(ticks%ticksPerSecond) * 100
	return time.Unix(seconds, nanos).UTC()
}

// extractMsgText converts an Outlook message to Markdown.
func extractMsgText(absFile string) (string, error) {
	f, err := openCFB(absFile)
	if err != nil {
		return "", err
	}
	root := newMsgStorage(f, 0)

	doc := &mailDocument{
		subject: root.text(pidSubject),
		from:    msgSender(root),
		to:      root.text(pidDisplayTo),
		cc:      root.text(pidDisplayCc),
		bcc:     root.text(pidDisplayBcc),
		date:    msgDate(root),
		body:    msgBody(root),
	}
	if doc.subject == "" && doc.from == "" && doc.body == "" {
		return "", fmt.Errorf("no MAPI message properties in %s", absFile)
	}
	doc.attachments = msgAttachments(f, root)
	return doc.render(), nil
}

// msgSender assembles the From line. The display name and the address are separate properties,
// and the address worth showing is the SMTP one: PidTagSenderEmailAddress holds an X.500
// directory name for anything sent inside an Exchange organisation, which is not an address
// anybody would search for.
func msgSender(root *msgStorage) string {
	name := root.text(pidSenderName)
	address := firstNonEmpty(
		root.text(pidSenderSmtpAddress),
		root.text(pidSentRepresentingSMT),
		smtpOnly(root.text(pidSenderEmailAddress)),
	)
	switch {
	case name != "" && address != "":
		return name + " <" + address + ">"
	case name != "":
		return name
	default:
		return address
	}
}

// smtpOnly keeps an address only when it looks like one, so an Exchange X.500 name
// ("/O=EXCHANGE/OU=.../CN=RECIPIENTS/CN=CLAIRE") never reaches the index as an address.
func smtpOnly(address string) string {
	if strings.Contains(address, "@") && !strings.HasPrefix(address, "/") {
		return address
	}
	return ""
}

// msgBody returns the message text: the plain body when there is one, the HTML body reduced to
// text when there is not. A message carrying only a compressed-RTF body yields neither — reading
// that would mean implementing the LZFu decompressor, and Outlook writes a plain body beside it
// in every case this has to answer.
func msgBody(root *msgStorage) string {
	if body := root.text(pidBody); strings.TrimSpace(body) != "" {
		return body
	}
	if raw := root.binary(pidBodyHTML); len(raw) > 0 {
		return htmlToText(decodeCharset(raw, ""))
	}
	return htmlToText(root.text(pidBodyHTML))
}

// msgDate returns when the message was sent or delivered, in RFC 3339. Falls back to the Date of
// the transport headers, which a message received over the internet carries verbatim.
func msgDate(root *msgStorage) string {
	for _, id := range []uint16{pidClientSubmitTime, pidMessageDeliveryTime} {
		if t, ok := root.systime(id); ok {
			return t.Format(time.RFC3339)
		}
	}
	return formatMailDate(headerValue(root.text(pidTransportHeaders), "Date"))
}

// headerValue picks one header out of a raw RFC 5322 header block, unfolding it.
func headerValue(headers, name string) string {
	prefix := strings.ToLower(name) + ":"
	lines := strings.Split(strings.ReplaceAll(headers, "\r\n", "\n"), "\n")
	for i, line := range lines {
		if !strings.HasPrefix(strings.ToLower(line), prefix) {
			continue
		}
		value := strings.TrimSpace(line[len(prefix):])
		for _, cont := range lines[i+1:] {
			if cont == "" || (cont[0] != ' ' && cont[0] != '\t') {
				break
			}
			value += " " + strings.TrimSpace(cont)
		}
		return value
	}
	return ""
}

// msgAttachments names the attached files. Each attachment is a sub-storage of the message, and
// its long file name is a property of that storage.
func msgAttachments(f *cfbFile, root *msgStorage) []mailAttachment {
	var out []mailAttachment
	for name, id := range root.storages {
		if !strings.HasPrefix(name, "__attach_version1.0") {
			continue
		}
		attach := newMsgStorage(f, id)
		filename := firstNonEmpty(attach.text(pidAttachLongFilename), attach.text(pidAttachFilename))
		if filename == "" {
			filename = "(unnamed attachment)"
		}
		out = append(out, mailAttachment{name: filename, mime: attach.text(pidAttachMimeTag)})
	}
	// The storages come off a red-black tree, so their order is the tree's rather than the
	// message's; name order at least makes the index stable between two runs on the same file.
	sortAttachments(out)
	return out
}

func sortAttachments(list []mailAttachment) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j].name < list[j-1].name; j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
