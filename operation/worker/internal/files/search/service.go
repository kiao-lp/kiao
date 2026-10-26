package search

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	pkgFilesystem "kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/files/scope"
	"os"
	pkgPath "path"
	"path/filepath"
	"strings"
)

// Skip content reads above this size, except for text indexes.
const MaxSearchFileBytes = 1024 * 1024

const MaxSearchResults = 500

// search refreshes document indexes, then scans content and names using searchquery.go's syntax.
// Indexed documents are searched through their index and reported under their source path.
// Both passes honour .kiao-files [search] exclusions, except for the explicitly requested root.
// The boolean result reports truncation.
func (svc *Searcher) Search(dirPath, query string) ([]SearchDto, bool, error) {
	rootAbs, err := svc.storage.Resolve(dirPath)
	if err != nil {
		return nil, false, err
	}
	if !pkgFilesystem.IsDir(rootAbs) {
		return nil, false, fmt.Errorf("%w: %s", pkgFilesystem.ErrNotDirectory, dirPath)
	}

	// Reject invalid queries before walking the tree or extracting document content.
	sq, err := parseSearchQuery(query)
	if err != nil {
		return nil, false, err
	}
	if sq.empty() {
		return nil, false, nil
	}

	// Pass 1: refresh the text indices of every indexable document type (see extractors).
	indexing := scope.NewKiaoWalk(svc.storage.Root, rootAbs, scope.ConcernSearch)
	_ = filepath.WalkDir(rootAbs, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != rootAbs && scope.SkipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if indexing.ExcludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if indexing.ExcludesFile(p) {
			return nil
		}
		if isIndexable(d.Name()) {
			if need, nerr := NeedsIndexing(p); nerr == nil && need {
				if _, cerr := createIndex(p); cerr != nil {
					logSearch.Warn("failed to index document", "path", p, "error", cerr)
				}
			}
		}
		return nil
	})

	var results []SearchDto
	truncated := false
	scanning := scope.NewKiaoWalk(svc.storage.Root, rootAbs, scope.ConcernSearch)
	_ = filepath.WalkDir(rootAbs, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != rootAbs && scope.SkipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if scanning.ExcludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if scanning.ExcludesFile(p) {
			return nil
		}
		name := d.Name()
		// Skip files that have an index — we search the index instead.
		if ExistingIndexPath(p) != "" {
			return nil
		}
		// Match and report the source name. Search only the preferred index to avoid duplicate hits.
		original, isIndex := originalForIndexName(name)
		if isIndex {
			if source := filepath.Join(filepath.Dir(p), original); ExistingIndexPath(source) != p {
				return nil
			}
			name = original
		}
		// Oversized files and non-UTF-8 content still match by name. Text indexes
		// bypass the size cap so long documents remain searchable.
		var lines []string
		if info, ierr := d.Info(); ierr == nil && (isIndex || info.Size() <= MaxSearchFileBytes) {
			lines, _ = filesystem.ReadLines(p)
		}
		matches, ok := sq.matchDocument(name, lines)
		if !ok {
			return nil
		}
		rel, _ := filepath.Rel(rootAbs, p)
		rel = filepath.ToSlash(filepath.Join(filepath.Dir(rel), name))
		results = append(results, SearchDto{File: pkgPath.Join(dirPath, rel), Matches: matches})
		if len(results) >= MaxSearchResults {
			truncated = true
			logSearch.Warn("search truncated", "path", dirPath, "limit", MaxSearchResults)
			return filepath.SkipAll
		}
		return nil
	})

	return results, truncated, nil
}

// Count writes, not inspected documents, so repeated requests keep making progress.
const maxReindexWrites = 2000

// reindex explicitly converts documents, including current indexes in legacy formats
// that automatic search leaves unchanged. Manual indexes are always preserved (see stateOfIndex).
func (svc *Searcher) Reindex(paths []string) (ReindexResultDto, error) {
	result := ReindexResultDto{Indexed: []string{}, Failed: []ReindexFailureDto{}}
	for _, p := range paths {
		abs, err := svc.storage.Resolve(p)
		if err != nil {
			return ReindexResultDto{}, err // outside the root: a 400, and the whole request stops
		}
		info, err := os.Stat(abs)
		if err != nil {
			result.Failed = append(result.Failed, ReindexFailureDto{Path: p, Error: "no such file or directory"})
			continue
		}
		if info.IsDir() {
			svc.reindexTree(p, abs, &result)
			continue
		}
		svc.reindexOne(p, abs, &result)
	}
	logIndex.Info("reindex", "paths", len(paths), "written", len(result.Indexed),
		"upToDate", result.UpToDate, "failed", len(result.Failed), "truncated", result.Truncated)
	return result, nil
}

// reindexTree honours [search] exclusions below the explicitly requested directory.
func (svc *Searcher) reindexTree(relRoot, absRoot string, result *ReindexResultDto) {
	walk := scope.NewKiaoWalk(svc.storage.Root, absRoot, scope.ConcernSearch)
	_ = filepath.WalkDir(absRoot, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != absRoot && scope.SkipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if walk.ExcludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if result.Truncated {
			return filepath.SkipAll
		}
		if walk.ExcludesFile(p) || !isIndexable(d.Name()) {
			return nil
		}
		rel, relErr := filepath.Rel(absRoot, p)
		if relErr != nil {
			return nil
		}
		svc.reindexOne(pkgPath.Join(relRoot, filepath.ToSlash(rel)), p, result)
		return nil
	})
}

// reindexOne counts conversion outcomes; unsupported file types are skipped without error.
func (svc *Searcher) reindexOne(rel, abs string, result *ReindexResultDto) {
	if !isIndexable(filepath.Base(abs)) {
		return
	}
	state, err := stateOfIndex(abs)
	if err != nil {
		result.Failed = append(result.Failed, ReindexFailureDto{Path: rel, Error: err.Error()})
		return
	}
	if state == indexUpToDate || state == indexManual {
		result.UpToDate++
		return
	}
	if len(result.Indexed) >= maxReindexWrites {
		result.Truncated = true
		return
	}
	written, err := createIndex(abs)
	switch {
	case err != nil:
		logIndex.Warn("failed to index document", "path", abs, "error", err)
		result.Failed = append(result.Failed, ReindexFailureDto{Path: rel, Error: err.Error()})
	case written != "":
		// Report the index path so clients refresh the file actually written.
		result.Indexed = append(result.Indexed, rel+strings.TrimPrefix(written, abs))
	default:
		result.UpToDate++
	}
}

func removeIfExists(p string) {
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		logIndex.Warn("failed to delete index file", "path", p, "error", err)
	}
}
