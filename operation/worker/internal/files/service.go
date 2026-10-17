package files

import (
	"archive/zip"
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// FileService coordinates storage, subsidiaries, indexes and link updates.
type FileService struct {
	storage *core.Storage
	linkFix *LinkFixer
}

func newFileService(storage *core.Storage, linkFix *LinkFixer) *FileService {
	return &FileService{storage: storage, linkFix: linkFix}
}

func (svc *FileService) upload(parentDir, filename string, r io.Reader) (string, error) {
	rel := path.Join(parentDir, filename)
	return svc.storage.SaveFile(rel, r)
}

// update overwrites rel, first invalidating any search index so it is regenerated on next search.
func (svc *FileService) update(rel string, r io.Reader) (string, error) {
	if abs, err := svc.storage.Resolve(rel); err == nil {
		removeIndexes(abs)
	}
	return svc.storage.SaveFile(rel, r)
}

// delete removes the entry, subsidiaries and settings sidecars, then repairs links.
func (svc *FileService) delete(rel string) (LinkFixReport, error) {
	if err := svc.removeOne(rel); err != nil {
		return LinkFixReport{}, err
	}
	return svc.linkFix.fixAfterDelete(filepath.ToSlash(rel))
}

// removeOne is delete without the link fix: the entry, its subsidiaries and its sidecars.
func (svc *FileService) removeOne(rel string) error {
	if abs, err := svc.storage.Resolve(rel); err == nil {
		deleteSubsidiaries(abs)
		deleteSidecars(abs)
	}
	return svc.storage.DeleteFile(rel)
}

// deleteBatch removes entries before repairing links in one pass. On failure, links
// to entries already removed are still repaired.
// Descendants covered by a requested ancestor are skipped. Their reports are empty;
// the ancestor's report carries their link changes. Reports retain request order.
func (svc *FileService) deleteBatch(paths []string) ([]LinkFixReport, error) {
	started := time.Now()
	covered := pathsCoveredByAnAncestor(paths)
	skipped := 0
	ops := make([]linkFixOp, 0, len(paths))
	owner := make([]int, len(paths)) // index into ops, or -1 for a path an ancestor covers
	for i, rel := range paths {
		if covered[i] {
			skipped++
			owner[i] = -1
			continue
		}
		if err := svc.removeOne(rel); err != nil {
			_, _ = svc.linkFix.fixBatch(ops)
			return nil, err
		}
		owner[i] = len(ops)
		ops = append(ops, deleteOp(filepath.ToSlash(rel)))
	}
	// Time filesystem work separately from link repair to identify slow phases.
	logBatchPhase("delete", len(paths), skipped, started)
	reports, err := svc.linkFix.fixBatch(ops)
	if err != nil {
		return nil, err
	}
	out := make([]LinkFixReport, len(paths))
	for i, rel := range paths {
		if owner[i] < 0 {
			out[i] = LinkFixReport{Operation: "DELETE", OriginalPath: rel, FileChanges: []LinkFixFileChange{}}
			continue
		}
		out[i] = reports[owner[i]]
	}
	return out, nil
}

// logBatchPhase records how long the removal/move half of a batch took, before the link-fixer runs.
func logBatchPhase(op string, paths, skipped int, started time.Time) {
	elapsed := time.Since(started)
	args := []any{"op", op, "paths", paths, "skipped_covered", skipped, "ms", elapsed.Milliseconds()}
	if elapsed >= linkFixSlowPass {
		logLinkFix.Warn("slow batch filesystem phase", args...)
		return
	}
	logLinkFix.Info("batch filesystem phase", args...)
}

// pathsCoveredByAnAncestor marks paths covered by another path in the batch.
// Duplicate paths do not cover one another; both deletions are attempted.
func pathsCoveredByAnAncestor(paths []string) []bool {
	present := make(map[string]bool, len(paths))
	for _, p := range paths {
		if n := core.NormaliseVirtual(p); n != "" {
			present[n] = true
		}
	}
	covered := make([]bool, len(paths))
	for i, p := range paths {
		n := core.NormaliseVirtual(p)
		for n != "" {
			parent := path.Dir(n)
			if parent == "." || parent == "/" || parent == n {
				break
			}
			if present[parent] {
				covered[i] = true
				break
			}
			n = parent
		}
	}
	return covered
}

// list returns the directory's entries, hiding subsidiaries whose main file is present and
// flagging entries that have a search index. Paths are relative to the storage root.
func (svc *FileService) list(dirPath string) ([]FileDto, error) {
	entries, err := svc.storage.ListFiles(dirPath)
	if err != nil {
		return nil, err
	}
	core.SortEntriesByName(entries)

	present := make(map[string]bool, len(entries))
	for _, e := range entries {
		present[path.Base(e.Path)] = true
	}

	out := make([]FileDto, 0, len(entries))
	for _, e := range entries {
		name := path.Base(e.Path)
		if main, ok := mainFileName(name); ok && present[main] {
			continue // hide subsidiary whose main exists in the same directory
		}
		indexed := false
		if abs, err := svc.storage.Resolve(e.Path); err == nil {
			indexed = existingIndexPath(abs) != ""
		}
		out = append(out, FileDto{
			Path:          e.Path,
			IsDirectory:   e.IsDirectory,
			Size:          e.Size,
			LastModified:  e.LastModified,
			ChildrenCount: e.ChildrenCount,
			Indexed:       indexed,
			Companions:    []FileCompanionDto{},
		})
	}
	return out, nil
}

// Bound deletion previews; Truncated tells clients the list is incomplete.
const maxScopeEntries = 500

// listRecursive previews deletion scope depth-first in name order, capped at maxScopeEntries.
// Missing paths are ignored. Subsidiaries are hidden as in list; index and companion
// metadata are omitted to avoid per-entry stat calls.
// Explicitly requested paths are walked; excluded [search] subfolders are listed
// without traversal and mark the result truncated.
func (svc *FileService) listRecursive(paths []string) ([]FileDto, bool, error) {
	out := make([]FileDto, 0, len(paths))
	seen := make(map[string]bool)
	truncated := false
	for _, p := range paths {
		abs, err := svc.storage.Resolve(p)
		if err != nil {
			return nil, false, err
		}
		info, statErr := os.Stat(abs)
		if statErr != nil {
			if os.IsNotExist(statErr) {
				continue
			}
			return nil, false, statErr
		}
		if svc.storage.IsStatePath(abs) || svc.storage.IsGitDir(abs) {
			continue
		}
		if !svc.addScopeEntry(&out, seen, abs, info) {
			truncated = true
			break
		}
		if info.IsDir() && !svc.walkScope(abs, kiaoScopeAt(svc.storage.Root, abs), &out, seen, &truncated) {
			truncated = true
			break
		}
	}
	return out, truncated, nil
}

// walkScope returns false when an entry exceeds the cap. Nested declarations extend scope;
// excluded subfolders are listed without traversal and set partial.
func (svc *FileService) walkScope(dir string, scope kiaoScope, out *[]FileDto, seen map[string]bool, partial *bool) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return true // unreadable directory: nothing to describe, not a reason to fail the answer
	}
	if d, ok := declAmong(entries, dir); ok {
		scope = scope.with(d)
	}
	present := make(map[string]bool, len(entries))
	for _, e := range entries {
		present[e.Name()] = true
	}
	for _, e := range entries {
		if main, ok := mainFileName(e.Name()); ok && present[main] {
			continue // a subsidiary goes with its main file, and is not shown beside it
		}
		abs := filepath.Join(dir, e.Name())
		if svc.storage.IsStatePath(abs) || svc.storage.IsGitDir(abs) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() && !info.IsDir() {
			continue
		}
		if !svc.addScopeEntry(out, seen, abs, info) {
			return false
		}
		if !info.IsDir() {
			continue
		}
		// Do not probe excluded folders, even to check whether they are empty.
		if scope.excludes(abs, concernSearch) {
			*partial = true
			continue
		}
		if !svc.walkScope(abs, scope, out, seen, partial) {
			return false
		}
	}
	return true
}

// addScopeEntry deduplicates overlapping selections and returns false if a new entry exceeds the cap.
func (svc *FileService) addScopeEntry(out *[]FileDto, seen map[string]bool, abs string, info os.FileInfo) bool {
	rel, err := filepath.Rel(svc.storage.Root, abs)
	if err != nil {
		rel = abs
	}
	rel = filepath.ToSlash(rel)
	if seen[rel] {
		return true
	}
	if len(*out) >= maxScopeEntries {
		return false
	}
	seen[rel] = true
	dto := FileDto{
		Path:         rel,
		IsDirectory:  info.IsDir(),
		LastModified: info.ModTime().UnixMilli(),
		Companions:   []FileCompanionDto{},
	}
	if !info.IsDir() {
		dto.Size = info.Size()
	}
	*out = append(*out, dto)
	// Check the cap on the next entry so an exact-cap result is not reported as truncated.
	return true
}

// getFileInfo returns metadata for a single path (with its companion family for files), or
// nil when the path does not exist.
func (svc *FileService) getFileInfo(p string) (*FileDto, error) {
	e, ok, err := svc.storage.GetFileInfo(p)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	companions := []FileCompanionDto{}
	if !e.IsDirectory {
		if abs, err := svc.storage.Resolve(p); err == nil {
			companions = companionsFor(abs)
		}
	}
	return &FileDto{
		Path:          e.Path,
		IsDirectory:   e.IsDirectory,
		Size:          e.Size,
		LastModified:  e.LastModified,
		ChildrenCount: e.ChildrenCount,
		Companions:    companions,
	}, nil
}

func (svc *FileService) createFolder(p string) error {
	return svc.storage.CreateFolder(p)
}

// renameFile moves a file (with its subsidiaries) and runs the link-fixer.
func (svc *FileService) renameFile(oldPath, newPath string) (LinkFixReport, error) {
	if err := svc.moveOne(oldPath, newPath); err != nil {
		return LinkFixReport{}, err
	}
	return svc.linkFix.fixAfterRename(filepath.ToSlash(oldPath), filepath.ToSlash(newPath))
}

// moveOne is renameFile without the link fix: the entry and its subsidiaries.
func (svc *FileService) moveOne(oldPath, newPath string) error {
	oldAbs, err := svc.storage.Resolve(oldPath)
	if err != nil {
		return err
	}
	newAbs, err := svc.storage.Resolve(newPath)
	if err != nil {
		return err
	}
	moveSubsidiaries(oldAbs, newAbs)
	return svc.storage.RenameFile(oldPath, newPath)
}

// batchItems uses explicit pairs, or places each path under targetFolder with its own name.
func batchItems(items []MoveItemDto, paths []string, targetFolder string) []MoveItemDto {
	if len(items) > 0 {
		return items
	}
	targetDir := strings.TrimSuffix(targetFolder, "/")
	out := make([]MoveItemDto, 0, len(paths))
	for _, p := range paths {
		dest := path.Base(p)
		if targetDir != "" {
			dest = targetDir + "/" + dest
		}
		out = append(out, MoveItemDto{From: p, To: dest})
	}
	return out
}

// moveBatch skips unchanged paths and repairs links once after moving entries and subsidiaries.
// Links to entries already moved are still repaired if a later move fails.
func (svc *FileService) moveBatch(req MoveBatchRequestDto) ([]LinkFixReport, error) {
	started := time.Now()
	items := batchItems(req.Items, req.Paths, req.TargetFolder)
	skipped := 0
	ops := make([]linkFixOp, 0, len(items))
	for _, item := range items {
		if item.From == item.To {
			skipped++
			continue
		}
		if err := svc.moveOne(item.From, item.To); err != nil {
			_, _ = svc.linkFix.fixBatch(ops)
			return nil, err
		}
		ops = append(ops, renameOp(filepath.ToSlash(item.From), filepath.ToSlash(item.To)))
	}
	logBatchPhase("move", len(items), skipped, started)
	return svc.linkFix.fixBatch(ops)
}

// copyBatch copies entries and subsidiaries, resolving collisions with " (copy)" / " (copy N)" names.
// References remain unchanged; results report the actual destinations.
func (svc *FileService) copyBatch(req CopyBatchRequestDto) ([]CopyResultDto, error) {
	items := batchItems(req.Items, req.Paths, req.TargetFolder)
	results := make([]CopyResultDto, 0, len(items))
	for _, item := range items {
		dest, err := svc.freeDestination(item.To)
		if err != nil {
			return nil, err
		}
		if copyWouldRecurse(item.From, dest) {
			return nil, fmt.Errorf("%w: %s into %s", errCopyIntoSelf, item.From, dest)
		}
		if err := svc.copyOne(item.From, dest); err != nil {
			return nil, err
		}
		results = append(results, CopyResultDto{From: item.From, To: dest})
	}
	return results, nil
}

// copyOne copies subsidiaries explicitly for files; directory copies already include them.
func (svc *FileService) copyOne(from, to string) error {
	if err := svc.storage.CopyPath(from, to); err != nil {
		return err
	}
	srcAbs, err := svc.storage.Resolve(from)
	if err != nil {
		return err
	}
	dstAbs, err := svc.storage.Resolve(to)
	if err != nil {
		return err
	}
	if !core.IsDir(srcAbs) {
		copySubsidiaries(srcAbs, dstAbs)
	}
	return nil
}

// Bound collision retries in directories with many copies.
const copyNameAttempts = 999

// freeDestination returns wanted, or the first " (copy N)" variant of it that is not taken.
func (svc *FileService) freeDestination(wanted string) (string, error) {
	taken, err := svc.storage.Exists(wanted)
	if err != nil || !taken {
		return wanted, err
	}
	dir, name := path.Split(core.NormaliseVirtual(wanted))
	for n := 1; n <= copyNameAttempts; n++ {
		candidate := dir + insertCopySuffix(name, n)
		taken, err := svc.storage.Exists(candidate)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", &core.HTTPError{Status: http.StatusConflict, Msg: "no free name available for " + wanted}
}

// insertCopySuffix adds " (copy)" / " (copy N)" before the extension.
// A dotfile's leading dot is not an extension separator.
func insertCopySuffix(name string, n int) string {
	tag := " (copy)"
	if n > 1 {
		tag = fmt.Sprintf(" (copy %d)", n)
	}
	dot := strings.LastIndex(name, ".")
	if dot <= 0 {
		return name + tag
	}
	return name[:dot] + tag + name[dot:]
}

// A destination at or under the source would cause an unbounded recursive copy.
func copyWouldRecurse(from, to string) bool {
	src := core.NormaliseVirtual(from)
	dst := core.NormaliseVirtual(to)
	if src == "" {
		return true // the storage root contains everything, including any destination
	}
	return dst == src || strings.HasPrefix(dst, src+"/")
}

// readable holds a directory for ZIP streaming or an open file for http.ServeContent.
// Name supplies the ZIP filename; ModTime supports conditional requests.
// The caller must close File when non-nil.
type readable struct {
	File        *os.File
	ContentType string
	Name        string
	ModTime     time.Time
	IsDir       bool
}

// openForRead keeps filesystem access in the service. Invalid and missing paths return
// core.ErrOutsideRoot (HTTP 400) and os.ErrNotExist (HTTP 404), respectively.
func (svc *FileService) openForRead(rel string) (*readable, error) {
	abs, err := svc.storage.Resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return &readable{IsDir: true, Name: filepath.Base(abs)}, nil
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil, err
	}
	return &readable{
		File:        f,
		ContentType: svc.determineContentType(abs),
		Name:        filepath.Base(abs),
		ModTime:     info.ModTime(),
	}, nil
}

// Keep media playable when Go's MIME table has no entry and Alpine supplies no /etc/mime.types.
func (svc *FileService) determineContentType(absPath string) string {
	ext := strings.ToLower(filepath.Ext(absPath))
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	switch ext {
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mkv":
		return "video/x-matroska"
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	}
	return "application/octet-stream"
}

func (svc *FileService) zipFolder(dirPath string, w io.Writer) error {
	sourceAbs, err := svc.storage.Resolve(dirPath)
	if err != nil {
		return err
	}
	if !core.IsDir(sourceAbs) {
		return fmt.Errorf("%w: %s", core.ErrNotDirectory, dirPath)
	}
	zw := zip.NewWriter(w)
	defer zw.Close()
	return filepath.Walk(sourceAbs, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Exclude service state (including prompt transcripts) and git data from exports.
			if svc.storage.IsStatePath(p) || svc.storage.IsGitDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(sourceAbs, p)
		if err != nil {
			return err
		}
		entry, err := zw.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(entry, f)
		return err
	})
}

func (svc *FileService) diskUsage() DiskUsageDto {
	total, free, usable := svc.storage.DiskUsage()
	return DiskUsageDto{TotalSpace: total, FreeSpace: free, UsableSpace: usable}
}

// Return an absolute root for use by external tools, falling back to the configured path.
func (svc *FileService) storeInfo() StoreInfoDto {
	root := svc.storage.Root
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	return StoreInfoDto{RootPath: root}
}

// Skip content reads above this size, except for text indexes.
const maxSearchFileBytes = 1024 * 1024

const maxSearchResults = 500

// Search excludes hidden directories (including git and service state) and node_modules
// even when .kiao-files declares no exclusions.
func skipMachineryDir(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules"
}

// search refreshes document indexes, then scans content and names using searchquery.go's syntax.
// Indexed documents are searched through their index and reported under their source path.
// Both passes honour .kiao-files [search] exclusions, except for the explicitly requested root.
// The boolean result reports truncation.
func (svc *FileService) search(dirPath, query string) ([]SearchDto, bool, error) {
	rootAbs, err := svc.storage.Resolve(dirPath)
	if err != nil {
		return nil, false, err
	}
	if !core.IsDir(rootAbs) {
		return nil, false, fmt.Errorf("%w: %s", core.ErrNotDirectory, dirPath)
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
	indexing := newKiaoWalk(svc.storage.Root, rootAbs, concernSearch)
	_ = filepath.WalkDir(rootAbs, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != rootAbs && skipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if indexing.excludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if indexing.excludesFile(p) {
			return nil
		}
		if isIndexable(d.Name()) {
			if need, nerr := needsIndexing(p); nerr == nil && need {
				if _, cerr := createIndex(p); cerr != nil {
					logSearch.Warn("failed to index document", "path", p, "error", cerr)
				}
			}
		}
		return nil
	})

	var results []SearchDto
	truncated := false
	scanning := newKiaoWalk(svc.storage.Root, rootAbs, concernSearch)
	_ = filepath.WalkDir(rootAbs, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != rootAbs && skipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if scanning.excludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if scanning.excludesFile(p) {
			return nil
		}
		name := d.Name()
		// Skip files that have an index — we search the index instead.
		if existingIndexPath(p) != "" {
			return nil
		}
		// Match and report the source name. Search only the preferred index to avoid duplicate hits.
		original, isIndex := originalForIndexName(name)
		if isIndex {
			if source := filepath.Join(filepath.Dir(p), original); existingIndexPath(source) != p {
				return nil
			}
			name = original
		}
		// Oversized files and non-UTF-8 content still match by name. Text indexes
		// bypass the size cap so long documents remain searchable.
		var lines []string
		if info, ierr := d.Info(); ierr == nil && (isIndex || info.Size() <= maxSearchFileBytes) {
			lines, _ = readLines(p)
		}
		matches, ok := sq.matchDocument(name, lines)
		if !ok {
			return nil
		}
		rel, _ := filepath.Rel(rootAbs, p)
		rel = filepath.ToSlash(filepath.Join(filepath.Dir(rel), name))
		results = append(results, SearchDto{File: path.Join(dirPath, rel), Matches: matches})
		if len(results) >= maxSearchResults {
			truncated = true
			logSearch.Warn("search truncated", "path", dirPath, "limit", maxSearchResults)
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
func (svc *FileService) reindex(paths []string) (ReindexResultDto, error) {
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
func (svc *FileService) reindexTree(relRoot, absRoot string, result *ReindexResultDto) {
	walk := newKiaoWalk(svc.storage.Root, absRoot, concernSearch)
	_ = filepath.WalkDir(absRoot, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != absRoot && skipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if walk.excludesDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if result.Truncated {
			return filepath.SkipAll
		}
		if walk.excludesFile(p) || !isIndexable(d.Name()) {
			return nil
		}
		rel, relErr := filepath.Rel(absRoot, p)
		if relErr != nil {
			return nil
		}
		svc.reindexOne(path.Join(relRoot, filepath.ToSlash(rel)), p, result)
		return nil
	})
}

// reindexOne counts conversion outcomes; unsupported file types are skipped without error.
func (svc *FileService) reindexOne(rel, abs string, result *ReindexResultDto) {
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
