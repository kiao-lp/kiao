package search

import (
	"encoding/binary"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

// msgNode is one storage of the fixture: its streams, and the storages under it.
type msgNode struct {
	streams  map[string][]byte
	storages map[string]*msgNode
}

func newMsgNode() *msgNode {
	return &msgNode{streams: map[string][]byte{}, storages: map[string]*msgNode{}}
}

// unicodeProp adds a PT_UNICODE property stream, which is how Outlook stores text.
func (n *msgNode) unicodeProp(id uint16, value string) *msgNode {
	units := utf16.Encode([]rune(value))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	n.streams[propStreamName(id, ptypeUnicode)] = raw
	return n
}

// ansiProp adds a PT_STRING8 property stream — a message written before Outlook 2003.
func (n *msgNode) ansiProp(id uint16, value []byte) *msgNode {
	n.streams[propStreamName(id, ptypeString8)] = value
	return n
}

// binaryProp adds a PT_BINARY property stream, which is where an HTML body lives.
func (n *msgNode) binaryProp(id uint16, value []byte) *msgNode {
	n.streams[propStreamName(id, ptypeBinary)] = value
	return n
}

// systimeProps writes the fixed-size property stream holding the message's times.
func (n *msgNode) systimeProps(times map[uint16]time.Time) *msgNode {
	raw := make([]byte, msgFixedHeaderTopLevel)
	ids := make([]int, 0, len(times))
	for id := range times {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	for _, id := range ids {
		record := make([]byte, 16)
		binary.LittleEndian.PutUint32(record[0:4], uint32(id)<<16|ptypeSysTime)
		binary.LittleEndian.PutUint64(record[8:16], timeToFiletime(times[uint16(id)]))
		raw = append(raw, record...)
	}
	n.streams["__properties_version1.0"] = raw
	return n
}

func propStreamName(id, ptype uint16) string {
	return string([]byte("__substg1.0_")) + hex4(id) + hex4(ptype)
}

func hex4(v uint16) string {
	const digits = "0123456789ABCDEF"
	return string([]byte{digits[v>>12&0xF], digits[v>>8&0xF], digits[v>>4&0xF], digits[v&0xF]})
}

func timeToFiletime(t time.Time) uint64 {
	const epochDeltaSeconds = 11644473600
	return uint64(t.UTC().Unix()+epochDeltaSeconds) * 10_000_000
}

// mustWriteMsgDoc serialises a node tree as a v3 compound file (512-byte sectors) and writes it
// at path. Layout, in sector order: the FAT, the directory, the mini FAT, then the mini stream —
// every stream of a .msg fixture is short enough to live in the mini stream.
func mustWriteMsgDoc(t *testing.T, path string, root *msgNode) {
	t.Helper()
	const sectorSize = 512

	// The directory: entry 0 is the root storage, then a depth-first numbering of everything
	// under it. Siblings are chained through `right`, which is a degenerate but valid tree.
	entries := []cfbEntry{{name: "Root Entry", objectType: cfbTypeRoot, child: cfbNoStream, left: cfbNoStream, right: cfbNoStream}}
	var mini []byte
	var addNode func(n *msgNode, selfID uint32)
	addNode = func(n *msgNode, selfID uint32) {
		var childIDs []uint32
		for _, name := range sortedKeys(n.streams) {
			data := n.streams[name]
			id := uint32(len(entries))
			entries = append(entries, cfbEntry{
				name: name, objectType: cfbTypeStream, left: cfbNoStream, right: cfbNoStream, child: cfbNoStream,
				start: uint32(len(mini) / cfbMiniSectorSize), size: uint64(len(data)),
			})
			mini = append(mini, padTo(data, cfbMiniSectorSize)...)
			childIDs = append(childIDs, id)
		}
		var storageIDs []uint32
		var storageNodes []*msgNode
		for _, name := range sortedStorageKeys(n.storages) {
			id := uint32(len(entries))
			entries = append(entries, cfbEntry{
				name: name, objectType: cfbTypeStorage, left: cfbNoStream, right: cfbNoStream, child: cfbNoStream,
			})
			storageIDs = append(storageIDs, id)
			storageNodes = append(storageNodes, n.storages[name])
			childIDs = append(childIDs, id)
		}
		if len(childIDs) > 0 {
			entries[selfID].child = childIDs[0]
			for i := 0; i+1 < len(childIDs); i++ {
				entries[childIDs[i]].right = childIDs[i+1]
			}
		}
		for i, id := range storageIDs {
			addNode(storageNodes[i], id)
		}
	}
	addNode(root, 0)

	// The mini FAT chains 64-byte mini sectors; every stream's own sectors are consecutive.
	miniFat := make([]uint32, len(mini)/cfbMiniSectorSize)
	for i := range miniFat {
		miniFat[i] = uint32(i + 1)
	}
	for _, e := range entries {
		if e.objectType != cfbTypeStream || e.size == 0 {
			continue
		}
		last := int(e.start) + (int(e.size)+cfbMiniSectorSize-1)/cfbMiniSectorSize - 1
		miniFat[last] = cfbEndOfChain
	}

	dirBytes := padTo(encodeDirectory(entries), sectorSize)
	miniFatBytes := padTo(encodeUint32s(miniFat), sectorSize)
	miniBytes := padTo(mini, sectorSize)

	dirSectors := len(dirBytes) / sectorSize
	miniFatSectors := len(miniFatBytes) / sectorSize
	miniSectors := len(miniBytes) / sectorSize

	// Sector 0 is the FAT itself; the three chains follow it in order.
	dirStart := uint32(1)
	miniFatStart := dirStart + uint32(dirSectors)
	miniStart := miniFatStart + uint32(miniFatSectors)
	total := int(miniStart) + miniSectors

	fat := make([]uint32, sectorSize/4)
	for i := range fat {
		fat[i] = cfbFreeSector
	}
	fat[0] = 0xFFFFFFFD // FATSECT
	chainInto(fat, dirStart, dirSectors)
	chainInto(fat, miniFatStart, miniFatSectors)
	chainInto(fat, miniStart, miniSectors)
	if total > len(fat) {
		t.Fatalf("fixture needs %d sectors, more than one FAT sector describes", total)
	}

	// The root entry points at the mini stream, which is stored in the ordinary FAT.
	entries[0].start = miniStart
	entries[0].size = uint64(len(mini))
	dirBytes = padTo(encodeDirectory(entries), sectorSize)

	header := make([]byte, sectorSize)
	binary.LittleEndian.PutUint64(header[0:8], cfbSignature)
	binary.LittleEndian.PutUint16(header[26:28], 3)      // major version
	binary.LittleEndian.PutUint16(header[28:30], 0xFFFE) // byte order
	binary.LittleEndian.PutUint16(header[30:32], 9)      // 512-byte sectors
	binary.LittleEndian.PutUint16(header[32:34], 6)      // 64-byte mini sectors
	binary.LittleEndian.PutUint32(header[44:48], 1)      // one FAT sector
	binary.LittleEndian.PutUint32(header[48:52], dirStart)
	binary.LittleEndian.PutUint32(header[56:60], 4096) // mini stream cutoff
	binary.LittleEndian.PutUint32(header[60:64], miniFatStart)
	binary.LittleEndian.PutUint32(header[64:68], uint32(miniFatSectors))
	binary.LittleEndian.PutUint32(header[68:72], cfbEndOfChain) // no DIFAT sectors
	for i := 0; i < 109; i++ {
		binary.LittleEndian.PutUint32(header[76+i*4:], cfbFreeSector)
	}
	binary.LittleEndian.PutUint32(header[76:80], 0) // the FAT is in sector 0

	out := append([]byte{}, header...)
	out = append(out, encodeUint32s(fat)...)
	out = append(out, dirBytes...)
	out = append(out, miniFatBytes...)
	out = append(out, miniBytes...)
	mustWriteBytes(t, path, out)
}

func chainInto(fat []uint32, start uint32, count int) {
	for i := 0; i < count; i++ {
		if i == count-1 {
			fat[int(start)+i] = cfbEndOfChain
		} else {
			fat[int(start)+i] = start + uint32(i) + 1
		}
	}
}

func encodeDirectory(entries []cfbEntry) []byte {
	out := make([]byte, len(entries)*cfbDirEntrySize)
	for i, e := range entries {
		b := out[i*cfbDirEntrySize:]
		units := utf16.Encode([]rune(e.name))
		for j, u := range units {
			binary.LittleEndian.PutUint16(b[j*2:], u)
		}
		binary.LittleEndian.PutUint16(b[64:66], uint16(len(units)*2+2))
		b[66] = e.objectType
		binary.LittleEndian.PutUint32(b[68:72], e.left)
		binary.LittleEndian.PutUint32(b[72:76], e.right)
		binary.LittleEndian.PutUint32(b[76:80], e.child)
		binary.LittleEndian.PutUint32(b[116:120], e.start)
		binary.LittleEndian.PutUint64(b[120:128], e.size)
	}
	return out
}

func encodeUint32s(values []uint32) []byte {
	out := make([]byte, len(values)*4)
	for i, v := range values {
		binary.LittleEndian.PutUint32(out[i*4:], v)
	}
	return out
}

func padTo(data []byte, block int) []byte {
	if len(data)%block == 0 {
		return data
	}
	return append(data, make([]byte, block-len(data)%block)...)
}

func sortedKeys(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedStorageKeys(m map[string]*msgNode) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestExtractMsgText(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "message.msg")

	msg := newMsgNode()
	msg.unicodeProp(pidSubject, "Rapport trimestriel établi")
	msg.unicodeProp(pidSenderName, "Claire Dubois")
	// The Exchange spelling of the sender: an X.500 directory name, which is not an address.
	msg.unicodeProp(pidSenderEmailAddress, "/O=EXCHANGE/OU=FIRST/CN=RECIPIENTS/CN=CLAIRE")
	msg.unicodeProp(pidSenderSmtpAddress, "claire@example.org")
	msg.unicodeProp(pidDisplayTo, "Alex")
	msg.unicodeProp(pidDisplayCc, "equipe@example.org")
	msg.unicodeProp(pidBody, "Bonjour Alex,\r\n\r\nLe rapport est prêt.\r\n")
	msg.systimeProps(map[uint16]time.Time{
		pidClientSubmitTime: time.Date(2026, 3, 3, 8, 15, 0, 0, time.UTC),
	})

	attach := newMsgNode()
	attach.unicodeProp(pidAttachLongFilename, "rapport.pdf")
	attach.unicodeProp(pidAttachMimeTag, "application/pdf")
	msg.storages["__attach_version1.0_#00000000"] = attach

	mustWriteMsgDoc(t, src, msg)

	got, err := extractMsgText(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"# Rapport trimestriel établi",
		"**From:** Claire Dubois <claire@example.org>",
		"**To:** Alex",
		"**Cc:** equipe@example.org",
		"**Date:** 2026-03-03T08:15:00Z",
		"## Message",
		"Le rapport est prêt.",
		"## Attachments",
		"- rapport.pdf (application/pdf)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("index is missing %q:\n%s", want, got)
		}
	}
	// An X.500 directory name is not something anybody searches for, and putting it where an
	// address goes would make the From line a lie.
	if strings.Contains(got, "/O=EXCHANGE") {
		t.Errorf("the Exchange directory name reached the index as an address:\n%s", got)
	}
	// A .msg indexes to the same Markdown as an .eml, so both are searched and read alike.
	if !strings.HasPrefix(got, "# ") {
		t.Errorf("a message index opens on its subject:\n%s", got)
	}
}

// TestExtractMsgAnsiAndHtmlBody covers a message written by an older Outlook: single-byte
// properties in a legacy code page, and a body that exists only as HTML.
func TestExtractMsgAnsiAndHtmlBody(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "legacy.msg")

	msg := newMsgNode()
	msg.ansiProp(pidSubject, []byte{'R', 0xE9, 'u', 'n', 'i', 'o', 'n'}) // "Réunion" in Latin-1
	msg.ansiProp(pidSenderName, []byte("Bureau"))
	msg.binaryProp(pidBodyHTML, []byte("<html><body><p>Salle B, 14h.</p></body></html>"))
	mustWriteMsgDoc(t, src, msg)

	got, err := extractMsgText(src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "# Réunion") {
		t.Errorf("legacy single-byte subject was not decoded:\n%s", got)
	}
	if !strings.Contains(got, "Salle B, 14h.") {
		t.Errorf("HTML-only body was not reduced to text:\n%s", got)
	}
	if strings.Contains(got, "<p>") {
		t.Errorf("HTML markup reached the index:\n%s", got)
	}
}

func TestExtractMsgRejectsNonCompoundFile(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "bogus.msg")
	mustWrite(t, src, "just some text, not a compound file\n")
	if _, err := extractMsgText(src); err == nil {
		t.Errorf("expected an error for a .msg that is not a compound file")
	}
}

// TestExtractMsgRejectsAMessageWithNoProperties pins that an empty container is a failure and
// not an empty index: an index that says nothing would be counted as up to date forever.
func TestExtractMsgRejectsAMessageWithNoProperties(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "empty.msg")
	mustWriteMsgDoc(t, src, newMsgNode())
	if _, err := extractMsgText(src); err == nil {
		t.Errorf("expected an error for a compound file with no MAPI properties")
	}
}

func TestCreateIndexMsg(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "note.msg")
	msg := newMsgNode()
	msg.unicodeProp(pidSubject, "Deployment window")
	msg.unicodeProp(pidBody, "Saturday 02:00-04:00 UTC.")
	mustWriteMsgDoc(t, src, msg)

	written, err := createIndex(src)
	if err != nil || written == "" {
		t.Fatalf("createIndex = (%q, %v)", written, err)
	}
	if got := mustRead(t, src+FormatMarkdown); !strings.Contains(got, "Deployment window") {
		t.Errorf(".msg index = %q", got)
	}
}
