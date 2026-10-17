package files

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"unicode/utf16"
)

// A reader for the Compound File Binary format (OLE2 / "structured storage"), which is the
// container an Outlook `.msg` is: a whole FAT filesystem inside one file, with storages for
// directories and streams for files.
//
// Written here rather than taken from a library for the same reason the OOXML engine is: the
// service ships as one static binary with nothing to install beside it, and what a search index
// needs from the format is the part that is stable and well specified — the sector chains and the
// directory tree. Nothing here interprets what a stream *means*; that is fileindex_msg.go.
//
// Reference: [MS-CFB], the Compound File Binary File Format.

const (
	cfbSignature      = 0xE11AB1A1E011CFD0 // "D0 CF 11 E0 A1 B1 1A E1", little-endian
	cfbEndOfChain     = 0xFFFFFFFE
	cfbFreeSector     = 0xFFFFFFFF
	cfbMaxRegSector   = 0xFFFFFFFA
	cfbNoStream       = 0xFFFFFFFF
	cfbDirEntrySize   = 128
	cfbMiniSectorSize = 64
	cfbTypeStorage    = 1
	cfbTypeStream     = 2
	cfbTypeRoot       = 5
)

// cfbFile is an opened compound file: its sector geometry, its two allocation tables, and its
// directory.
type cfbFile struct {
	data       []byte
	sectorSize int
	miniCutoff uint32
	fat        []uint32
	miniFat    []uint32
	entries    []cfbEntry
	miniStream []byte
}

// cfbEntry is one directory entry — a storage, a stream, or the root.
type cfbEntry struct {
	name       string
	objectType byte
	left       uint32
	right      uint32
	child      uint32
	start      uint32
	size       uint64
}

var errNotCompoundFile = errors.New("not a compound file (OLE2) container")

// openCFB reads absFile into memory and parses its allocation tables and directory.
//
// Read whole rather than streamed: the sector chains of a compound file are random access by
// construction — the FAT is scattered through the file and a stream's sectors are in no
// particular order — so seeking would buy nothing, and createIndex already refuses a source over
// maxIndexSourceBytes before getting here.
func openCFB(absFile string) (*cfbFile, error) {
	data, err := os.ReadFile(absFile)
	if err != nil {
		return nil, err
	}
	if len(data) < 512 || binary.LittleEndian.Uint64(data[0:8]) != cfbSignature {
		return nil, errNotCompoundFile
	}

	shift := binary.LittleEndian.Uint16(data[30:32])
	if shift != 9 && shift != 12 {
		return nil, fmt.Errorf("unsupported sector shift %d", shift)
	}
	f := &cfbFile{
		data:       data,
		sectorSize: 1 << shift,
		miniCutoff: binary.LittleEndian.Uint32(data[56:60]),
	}
	if f.miniCutoff == 0 {
		f.miniCutoff = 4096
	}

	if err := f.readFAT(); err != nil {
		return nil, err
	}
	if err := f.readDirectory(); err != nil {
		return nil, err
	}
	f.readMiniFAT()
	return f, nil
}

// sector returns the bytes of one sector, or nil when it is out of the file.
func (f *cfbFile) sector(n uint32) []byte {
	start := (int(n) + 1) * f.sectorSize
	end := start + f.sectorSize
	if n > cfbMaxRegSector || start < 0 || end > len(f.data) {
		return nil
	}
	return f.data[start:end]
}

// readFAT assembles the file allocation table from the DIFAT: 109 entries in the header, then a
// chain of DIFAT sectors for anything larger.
func (f *cfbFile) readFAT() error {
	fatSectors := make([]uint32, 0, 109)
	for i := 0; i < 109; i++ {
		off := 76 + i*4
		s := binary.LittleEndian.Uint32(f.data[off : off+4])
		if s > cfbMaxRegSector {
			continue
		}
		fatSectors = append(fatSectors, s)
	}

	next := binary.LittleEndian.Uint32(f.data[68:72])
	perSector := f.sectorSize/4 - 1
	maxSectors := len(f.data)/f.sectorSize + 1
	for guard := 0; next <= cfbMaxRegSector && guard < maxSectors; guard++ {
		sec := f.sector(next)
		if sec == nil {
			break
		}
		for i := 0; i < perSector; i++ {
			s := binary.LittleEndian.Uint32(sec[i*4 : i*4+4])
			if s > cfbMaxRegSector {
				continue
			}
			fatSectors = append(fatSectors, s)
		}
		next = binary.LittleEndian.Uint32(sec[perSector*4 : perSector*4+4])
	}

	f.fat = make([]uint32, 0, len(fatSectors)*f.sectorSize/4)
	for _, s := range fatSectors {
		sec := f.sector(s)
		if sec == nil {
			continue
		}
		for i := 0; i < f.sectorSize/4; i++ {
			f.fat = append(f.fat, binary.LittleEndian.Uint32(sec[i*4:i*4+4]))
		}
	}
	if len(f.fat) == 0 {
		return errors.New("compound file has no allocation table")
	}
	return nil
}

// chain reads a whole sector chain, stopping at the end marker, at a sector that is not there, or
// after as many sectors as the file physically holds.
//
// That last bound is the one that matters: a FAT pointing a chain back at itself is two words in a
// crafted file, and without a ceiling it would assemble an unbounded stream out of a small one.
// No honest chain can be longer than the file it lives in.
func (f *cfbFile) chain(start uint32) []byte {
	var out []byte
	for s, seen := start, 0; s <= cfbMaxRegSector && seen <= len(f.data)/f.sectorSize; seen++ {
		sec := f.sector(s)
		if sec == nil {
			break
		}
		out = append(out, sec...)
		if int(s) >= len(f.fat) {
			break
		}
		s = f.fat[s]
	}
	return out
}

// readDirectory walks the directory chain into a flat slice indexed by directory id, which is how
// [MS-CFB] addresses entries.
func (f *cfbFile) readDirectory() error {
	dirStart := binary.LittleEndian.Uint32(f.data[48:52])
	raw := f.chain(dirStart)
	if len(raw) < cfbDirEntrySize {
		return errors.New("compound file has no directory")
	}
	for off := 0; off+cfbDirEntrySize <= len(raw); off += cfbDirEntrySize {
		e := raw[off : off+cfbDirEntrySize]
		nameLen := int(binary.LittleEndian.Uint16(e[64:66]))
		if nameLen > 64 {
			nameLen = 64
		}
		f.entries = append(f.entries, cfbEntry{
			name:       utf16LEString(e[:max(0, nameLen-2)]), // the length counts the NUL
			objectType: e[66],
			left:       binary.LittleEndian.Uint32(e[68:72]),
			right:      binary.LittleEndian.Uint32(e[72:76]),
			child:      binary.LittleEndian.Uint32(e[76:80]),
			start:      binary.LittleEndian.Uint32(e[116:120]),
			size:       binary.LittleEndian.Uint64(e[120:128]),
		})
	}
	if len(f.entries) == 0 || f.entries[0].objectType != cfbTypeRoot {
		return errors.New("compound file has no root storage")
	}
	return nil
}

// readMiniFAT loads the mini allocation table and the mini stream, which together hold every
// stream shorter than the cutoff — in a .msg that is most of the interesting ones.
func (f *cfbFile) readMiniFAT() {
	miniFatStart := binary.LittleEndian.Uint32(f.data[60:64])
	raw := f.chain(miniFatStart)
	f.miniFat = make([]uint32, 0, len(raw)/4)
	for i := 0; i+4 <= len(raw); i += 4 {
		f.miniFat = append(f.miniFat, binary.LittleEndian.Uint32(raw[i:i+4]))
	}

	root := f.entries[0]
	f.miniStream = f.chain(root.start)
	if uint64(len(f.miniStream)) > root.size {
		f.miniStream = f.miniStream[:root.size]
	}
}

// stream returns the whole content of the entry with this directory id.
func (f *cfbFile) stream(id uint32) []byte {
	if int(id) >= len(f.entries) {
		return nil
	}
	e := f.entries[id]
	if e.objectType != cfbTypeStream || e.size == 0 {
		return nil
	}
	if e.size > maxZipEntryBytes {
		return nil // the same per-part ceiling the zip formats get, for the same reason
	}

	var raw []byte
	if e.size < uint64(f.miniCutoff) {
		raw = f.miniChain(e.start, int(e.size))
	} else {
		raw = f.chain(e.start)
	}
	if uint64(len(raw)) > e.size {
		raw = raw[:e.size]
	}
	return raw
}

// miniChain reads a chain of 64-byte mini sectors out of the mini stream.
func (f *cfbFile) miniChain(start uint32, size int) []byte {
	out := make([]byte, 0, size)
	for s := start; s <= cfbMaxRegSector && len(out) < size; {
		off := int(s) * cfbMiniSectorSize
		if off+cfbMiniSectorSize > len(f.miniStream) {
			break
		}
		out = append(out, f.miniStream[off:off+cfbMiniSectorSize]...)
		if int(s) >= len(f.miniFat) {
			break
		}
		s = f.miniFat[s]
	}
	return out
}

// children returns the entries directly inside a storage, in no particular order.
//
// The siblings of a storage form a red-black tree, so reaching them all is a traversal and not a
// walk down a list. A malformed file can point that tree at itself, hence the visited set: an
// index must not be a way to hang the service.
func (f *cfbFile) children(storageID uint32) []uint32 {
	if int(storageID) >= len(f.entries) {
		return nil
	}
	var out []uint32
	visited := make(map[uint32]bool, len(f.entries))
	// An explicit stack rather than recursion: the sibling tree of a crafted file can be a single
	// chain as long as the directory, and the order children come back in does not matter here.
	stack := []uint32{f.entries[storageID].child}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if id == cfbNoStream || int(id) >= len(f.entries) || visited[id] {
			continue
		}
		visited[id] = true
		out = append(out, id)
		stack = append(stack, f.entries[id].left, f.entries[id].right)
	}
	return out
}

// utf16LEString decodes a UTF-16LE run, stopping at the first NUL.
func utf16LEString(b []byte) string {
	units := make([]uint16, 0, len(b)/2)
	for i := 0; i+2 <= len(b); i += 2 {
		u := binary.LittleEndian.Uint16(b[i : i+2])
		if u == 0 {
			break
		}
		units = append(units, u)
	}
	return string(utf16.Decode(units))
}
