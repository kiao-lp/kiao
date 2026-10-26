package search

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"os"
	"path/filepath"
	"strings"
)

// Bound untrusted input and output independently of upload limits: files can arrive on disk
// through git or sync without passing through /upload.
const (
	maxIndexSourceBytes = 64 << 20 // refuse to extract from documents larger than this
	maxIndexTextBytes   = 8 << 20  // cap on generated index text (truncate, don't fail)
	maxZipEntryBytes    = 32 << 20 // per-entry decompression cap (zip-bomb defence)
)

// indexFormat is the index file suffix, also used by clients to select an editor.
type indexFormat = string

const (
	FormatMarkdown indexFormat = ".index.md"
	formatCSV      indexFormat = ".index.csv"
	FormatText     indexFormat = ".index.txt"
)

// Preference order ensures search scans only one index per document.
var IndexSuffixes = []indexFormat{FormatMarkdown, formatCSV, FormatText}

type extractorFn func(absFile string) (string, error)

type documentExtractor struct {
	format  indexFormat
	extract extractorFn
}

// Shared by index creation, /reindex and search refresh; document supported types in PROTOCOL.md.
var extractors = map[string]documentExtractor{
	".pdf":  {FormatMarkdown, extractPDFText},
	".docx": {FormatMarkdown, extractDocxText},
	".xlsx": {formatCSV, extractSpreadsheetText},
	".xlsm": {formatCSV, extractSpreadsheetText},
	".pptx": {FormatMarkdown, extractPptxText},
	".odt":  {FormatMarkdown, extractOdtText},
	".ods":  {formatCSV, extractOdsText},
	".eml":  {FormatMarkdown, extractEmlText},
	".msg":  {FormatMarkdown, extractMsgText},
	// Legacy .doc needs a piece-table parser; the .msg OLE2 parser cannot read its body.
}

func extractorFor(fileName string) (documentExtractor, bool) {
	e, ok := extractors[strings.ToLower(filepath.Ext(fileName))]
	return e, ok
}

func isIndexable(fileName string) bool {
	_, ok := extractorFor(fileName)
	return ok
}

// originalForIndexName strips an index suffix ("report.xlsx.index.csv" -> "report.xlsx").
// Unlike mainFileName, it excludes .blog.md companions.
func originalForIndexName(fileName string) (string, bool) {
	for _, suffix := range IndexSuffixes {
		if strings.HasSuffix(fileName, suffix) {
			return fileName[:len(fileName)-len(suffix)], true
		}
	}
	return "", false
}

// indexTargetPath returns "" for unsupported file types.
func indexTargetPath(absFile string) string {
	e, ok := extractorFor(filepath.Base(absFile))
	if !ok {
		return ""
	}
	return absFile + e.format
}

// existingIndexPath returns the preferred existing index, or "" if none exists.
func ExistingIndexPath(absFile string) string {
	for _, suffix := range IndexSuffixes {
		if p := absFile + suffix; filesystem.Exists(p) {
			return p
		}
	}
	return ""
}

// Replacing a source document invalidates all its indexes.
func RemoveIndexes(absFile string) {
	for _, suffix := range IndexSuffixes {
		removeIfExists(absFile + suffix)
	}
}

type indexState int

const (
	indexUpToDate indexState = iota // an index exists, current, in the format written today
	indexMissing                    // no index at all
	indexStale                      // an index exists but predates the source
	indexLegacy                     // an index exists and is current, but in a superseded format
	indexManual                     // an index exists and POSTDATES the source — somebody wrote it
	indexAbsent                     // the source itself is gone
)

// Generated indexes share the source mtime. A newer index is considered manually edited
// and must never be overwritten automatically.
func stateOfIndex(absFile string) (indexState, error) {
	fi, err := os.Stat(absFile)
	if err != nil {
		if os.IsNotExist(err) {
			return indexAbsent, nil
		}
		return indexAbsent, err
	}
	idx := ExistingIndexPath(absFile)
	if idx == "" {
		return indexMissing, nil
	}
	idxStat, err := os.Stat(idx)
	if err != nil {
		return indexMissing, nil
	}
	switch {
	case idxStat.ModTime().Before(fi.ModTime()):
		return indexStale, nil
	case idxStat.ModTime().After(fi.ModTime()):
		return indexManual, nil
	case idx != indexTargetPath(absFile):
		return indexLegacy, nil
	default:
		return indexUpToDate, nil
	}
}

// Search refreshes missing or stale indexes only. Format upgrades belong to /reindex
// to avoid rewriting all existing indexes on the first search after deployment.
func NeedsIndexing(absFile string) (bool, error) {
	state, err := stateOfIndex(absFile)
	if err != nil {
		return false, err
	}
	return state == indexMissing || state == indexStale, nil
}

// createIndex preserves manual indexes and stamps generated ones with the source mtime.
// It removes other index formats and returns the written path, or "" if nothing was needed.
func createIndex(absFile string) (string, error) {
	converter, ok := extractorFor(filepath.Base(absFile))
	if !ok {
		return "", fmt.Errorf("unsupported file type for indexing: %s", absFile)
	}

	state, err := stateOfIndex(absFile)
	if err != nil {
		return "", err
	}
	switch state {
	case indexAbsent:
		return "", fmt.Errorf("file does not exist: %s", absFile)
	case indexManual:
		return "", nil
	}

	fi, err := os.Stat(absFile)
	if err != nil {
		return "", err
	}
	if fi.Size() > maxIndexSourceBytes {
		return "", fmt.Errorf("file too large to index (%d bytes): %s", fi.Size(), absFile)
	}

	text, err := converter.extract(absFile)
	if err != nil {
		return "", fmt.Errorf("failed to extract text from file %s: %w", absFile, err)
	}

	target := absFile + converter.format
	if err := os.WriteFile(target, []byte(text), 0o644); err != nil {
		return "", err
	}
	// Remove other formats so search cannot prefer an obsolete index.
	for _, suffix := range IndexSuffixes {
		if other := absFile + suffix; other != target {
			removeIfExists(other)
		}
	}
	_ = os.Chtimes(target, fi.ModTime(), fi.ModTime())
	return target, nil
}
