package content

import (
	"archive/zip"
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	pkgFilesystem "kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	"net/http"
	"os"
	pkgPath "path"
	"path/filepath"
	"strings"
)

// An archive may expand to this many times the upload cap: a hundred megabytes of zipped text
// is a plausible upload, and what it unfolds into has to land somewhere.
const UnzipExpansion = 10

// An archive holding more entries than this is refused unread: no listing in the store shows
// more than a fraction of it, and extracting it would bury the folder it lands in.
const maxUnzipEntries = 20000

// unzipTarget is one archive entry after validation: where it goes, in both path forms.
type UnzipTarget struct {
	Entry *zip.File
	Rel   string
	Abs   string
	isDir bool
}

// unzip extracts the archive at rel into its own folder, preserving the structure inside it and
// overwriting what is already there. With deleteArchive the archive itself is removed afterwards,
// through the same link-fixed removal DELETE /delete performs.
//
// Everything foreseeable is rejected before a byte is written: a path that is not a zip, an entry
// that would land outside the folder or over the archive itself, a folder where a file stands or
// the reverse, and an archive past the entry or size caps. Only an I/O failure mid-write — a full
// disk — leaves a partial extraction behind.
func (svc *FileService) Unzip(rel string, deleteArchive bool, maxBytes int64) (UnzipResultDto, error) {
	result := UnzipResultDto{Extracted: []string{}}
	abs, err := svc.storage.Resolve(rel)
	if err != nil {
		return result, err
	}
	if info, err := os.Stat(abs); err != nil {
		return result, err
	} else if info.IsDir() {
		return result, fmt.Errorf("%w: %s", ErrNotZip, rel)
	}
	zr, err := zip.OpenReader(abs)
	if err != nil {
		return result, fmt.Errorf("%w: %s", ErrNotZip, rel)
	}
	defer zr.Close()

	if len(zr.File) > maxUnzipEntries {
		return result, unzipTooLarge(fmt.Sprintf("the archive holds more than %d files", maxUnzipEntries))
	}
	var declared int64
	for _, entry := range zr.File {
		if entry.UncompressedSize64 > uint64(maxBytes-declared) {
			return result, unzipTooLarge("the archive's contents exceed the " + filesystem.HumanBytes(maxBytes) + " limit")
		}
		declared += int64(entry.UncompressedSize64)
	}

	targets, err := planUnzip(svc.storage, rel, abs, zr.File)
	if err != nil {
		return result, err
	}

	var written int64
	var files []string
	for _, target := range targets {
		if target.isDir {
			if err := os.MkdirAll(target.Abs, 0o755); err != nil {
				return result, err
			}
			continue
		}
		n, err := WriteUnzipped(target, maxBytes-written, maxBytes)
		written += n
		if err != nil {
			removeUnzipped(files)
			return result, err
		}
		files = append(files, target.Abs)
		result.Extracted = append(result.Extracted, target.Rel)
	}

	if deleteArchive {
		if _, err := svc.Delete(rel); err != nil {
			return result, err
		}
	}
	return result, nil
}

func unzipTooLarge(msg string) error {
	return &httpkit.HTTPError{Status: http.StatusRequestEntityTooLarge, Msg: msg}
}

// planUnzip resolves every entry to its destination and rejects the archive when any of them
// cannot land: outside the folder, over the archive itself, of a kind that is not a file or a
// folder, or clashing with the wrong kind of entry already there.
func planUnzip(storage *pkgFilesystem.Storage, rel, abs string, entries []*zip.File) ([]UnzipTarget, error) {
	dirRel := pkgPath.Dir(pkgFilesystem.NormaliseVirtual(rel))
	if dirRel == "." {
		dirRel = ""
	}
	targets := make([]UnzipTarget, 0, len(entries))
	for _, entry := range entries {
		segs, ok := splitZipName(entry.Name)
		if !ok {
			return nil, fmt.Errorf("%w: %q would land outside its folder", ErrZipEntry, entry.Name)
		}
		if !isExtractable(entry) {
			return nil, fmt.Errorf("%w: %q is not a file or a folder", ErrZipEntry, entry.Name)
		}
		destRel := pkgPath.Join(append([]string{dirRel}, segs...)...)
		destAbs, err := storage.Resolve(destRel)
		if err != nil {
			return nil, err
		}
		if sameFile(destAbs, abs) {
			return nil, fmt.Errorf("%w: %q would overwrite the archive itself", ErrZipEntry, entry.Name)
		}
		isDir := strings.HasSuffix(entry.Name, "/") || entry.FileInfo().Mode().IsDir()
		if err := checkUnzipClash(destAbs, isDir); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrZipEntry, err)
		}
		targets = append(targets, UnzipTarget{Entry: entry, Rel: destRel, Abs: destAbs, isDir: isDir})
	}
	return targets, nil
}

// splitZipName breaks an entry name into segments, refusing what no cleaning could make safe:
// an absolute path, an empty or dot segment, and any parent reference. Cleaning alone would
// silently remap "a/../../evil" onto "evil" instead of refusing it.
func splitZipName(name string) ([]string, bool) {
	name = strings.ReplaceAll(name, "\\", "/")
	if name == "" || strings.HasPrefix(name, "/") {
		return nil, false
	}
	segs := strings.Split(name, "/")
	out := make([]string, 0, len(segs))
	for i, seg := range segs {
		if seg == "" {
			if i != len(segs)-1 {
				return nil, false
			}
			continue // the trailing slash of a directory entry
		}
		if seg == "." || seg == ".." {
			return nil, false
		}
		out = append(out, seg)
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// Only files and folders come out: a symlink, device or socket entry is refused with the archive
// rather than recreated. Entries carrying no mode at all — mode 0, neither regular nor directory —
// are ordinary files; only a mode that positively says otherwise refuses them.
func isExtractable(entry *zip.File) bool {
	mode := entry.FileInfo().Mode()
	const special = os.ModeSymlink | os.ModeDevice | os.ModeNamedPipe | os.ModeSocket | os.ModeCharDevice | os.ModeIrregular
	return mode&special == 0
}

// A file lands on a file and a folder on a folder; anything else is refused upfront rather than
// failing halfway through the extraction.
func checkUnzipClash(destAbs string, isDir bool) error {
	info, err := os.Lstat(destAbs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if isDir && !info.IsDir() {
		return fmt.Errorf("%q would replace a file", filepath.Base(destAbs))
	}
	if !isDir && info.IsDir() {
		return fmt.Errorf("%q would replace a folder", filepath.Base(destAbs))
	}
	return nil
}

func sameFile(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
}

// writeUnzipped streams one entry onto the disk, capped at the bytes still allowed: the declared
// sizes were only checked against the headers, and a header can lie. Past the cap the extraction
// stops and what it already wrote is taken back, so a zip bomb leaves an error and not a full disk.
func WriteUnzipped(target UnzipTarget, remaining, maxBytes int64) (int64, error) {
	in, err := target.Entry.Open()
	if err != nil {
		return 0, err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(target.Abs), 0o755); err != nil {
		return 0, err
	}
	out, err := os.OpenFile(target.Abs, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	written, copyErr := io.Copy(out, io.LimitReader(in, remaining+1))
	closeErr := out.Close()
	if copyErr != nil {
		return written, copyErr
	}
	if closeErr != nil {
		return written, closeErr
	}
	if written > remaining {
		return written, unzipTooLarge("the archive's contents exceed the " + filesystem.HumanBytes(maxBytes) + " limit")
	}
	return written, nil
}

// removeUnzipped takes back the files an extraction wrote before it was stopped. The folders go
// with them only when the extraction emptied them: Remove refuses a folder that still holds
// anything, which is exactly the ones that were already there.
func removeUnzipped(files []string) {
	dirs := map[string]bool{}
	for _, file := range files {
		_ = os.Remove(file)
		dirs[filepath.Dir(file)] = true
	}
	for dir := range dirs {
		_ = os.Remove(dir)
	}
}
