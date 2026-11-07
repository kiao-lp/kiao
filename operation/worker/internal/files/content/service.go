package content

import (
	"archive/zip"
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/files/refactor"
	pkgScope "kiao/worker/internal/files/scope"
	"kiao/worker/internal/files/search"
	"mime"
	"net/http"
	"os"
	pkgPath "path"
	"path/filepath"
	"strings"
	"time"
)

// FileService coordinates storage, subsidiaries, indexes and link updates.
type FileService struct {
	*search.Searcher
	storage *filesystem.Storage
	linkFix *refactor.LinkFixer
}

func NewFileService(storage *filesystem.Storage, linkFix *refactor.LinkFixer) *FileService {
	return &FileService{storage: storage, linkFix: linkFix, Searcher: search.NewSearcher(storage)}
}

func (svc *FileService) Upload(parentDir, filename string, r io.Reader) (string, error) {
	rel := pkgPath.Join(parentDir, filename)
	return svc.storage.SaveFile(rel, r)
}

// update overwrites rel, first invalidating any search index so it is regenerated on next search.
func (svc *FileService) Update(rel string, r io.Reader) (string, error) {
	if abs, err := svc.storage.Resolve(rel); err == nil {
		search.RemoveIndexes(abs)
	}
	return svc.storage.SaveFile(rel, r)
}

// delete removes the entry, subsidiaries and settings sidecars, then repairs links.
func (svc *FileService) Delete(rel string) (refactor.LinkFixReport, error) {
	if err := svc.removeOne(rel); err != nil {
		return refactor.LinkFixReport{}, err
	}
	return svc.linkFix.FixAfterDelete(filepath.ToSlash(rel))
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
func (svc *FileService) DeleteBatch(paths []string) ([]refactor.LinkFixReport, error) {
	started := time.Now()
	covered := pathsCoveredByAnAncestor(paths)
	skipped := 0
	ops := make([]refactor.LinkFixOp, 0, len(paths))
	owner := make([]int, len(paths)) // index into ops, or -1 for a path an ancestor covers
	for i, rel := range paths {
		if covered[i] {
			skipped++
			owner[i] = -1
			continue
		}
		if err := svc.removeOne(rel); err != nil {
			_, _ = svc.linkFix.FixBatch(ops)
			return nil, err
		}
		owner[i] = len(ops)
		ops = append(ops, refactor.DeleteOp(filepath.ToSlash(rel)))
	}
	// Time filesystem work separately from link repair to identify slow phases.
	logBatchPhase("delete", len(paths), skipped, started)
	reports, err := svc.linkFix.FixBatch(ops)
	if err != nil {
		return nil, err
	}
	out := make([]refactor.LinkFixReport, len(paths))
	for i, rel := range paths {
		if owner[i] < 0 {
			out[i] = refactor.LinkFixReport{Operation: "DELETE", OriginalPath: rel, FileChanges: []refactor.LinkFixFileChange{}}
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
	if elapsed >= refactor.LinkFixSlowPass {
		refactor.LogLinkFix.Warn("slow batch filesystem phase", args...)
		return
	}
	refactor.LogLinkFix.Info("batch filesystem phase", args...)
}

// pathsCoveredByAnAncestor marks paths covered by another path in the batch.
// Duplicate paths do not cover one another; both deletions are attempted.
func pathsCoveredByAnAncestor(paths []string) []bool {
	present := make(map[string]bool, len(paths))
	for _, p := range paths {
		if n := filesystem.NormaliseVirtual(p); n != "" {
			present[n] = true
		}
	}
	covered := make([]bool, len(paths))
	for i, p := range paths {
		n := filesystem.NormaliseVirtual(p)
		for n != "" {
			parent := pkgPath.Dir(n)
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
func (svc *FileService) List(dirPath string) ([]FileDto, error) {
	entries, err := svc.storage.ListFiles(dirPath)
	if err != nil {
		return nil, err
	}
	filesystem.SortEntriesByName(entries)

	present := make(map[string]bool, len(entries))
	for _, e := range entries {
		present[pkgPath.Base(e.Path)] = true
	}

	out := make([]FileDto, 0, len(entries))
	for _, e := range entries {
		name := pkgPath.Base(e.Path)
		if main, ok := mainFileName(name); ok && present[main] {
			continue // hide subsidiary whose main exists in the same directory
		}
		indexed := false
		if abs, err := svc.storage.Resolve(e.Path); err == nil {
			indexed = search.ExistingIndexPath(abs) != ""
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
func (svc *FileService) ListRecursive(paths []string) ([]FileDto, bool, error) {
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
		if info.IsDir() && !svc.walkScope(abs, pkgScope.KiaoScopeAt(svc.storage.Root, abs), &out, seen, &truncated) {
			truncated = true
			break
		}
	}
	return out, truncated, nil
}

// walkScope returns false when an entry exceeds the cap. Nested declarations extend scope;
// excluded subfolders are listed without traversal and set partial.
func (svc *FileService) walkScope(dir string, scope pkgScope.KiaoScope, out *[]FileDto, seen map[string]bool, partial *bool) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return true // unreadable directory: nothing to describe, not a reason to fail the answer
	}
	if d, ok := refactor.DeclAmong(entries, dir); ok {
		scope = scope.With(d)
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
		if scope.Excludes(abs, pkgScope.ConcernSearch) {
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
func (svc *FileService) GetFileInfo(p string) (*FileDto, error) {
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

func (svc *FileService) CreateFolder(p string) error {
	return svc.storage.CreateFolder(p)
}

// renameFile moves a file (with its subsidiaries) and runs the link-fixer.
func (svc *FileService) RenameFile(oldPath, newPath string) (refactor.LinkFixReport, error) {
	if err := svc.moveOne(oldPath, newPath); err != nil {
		return refactor.LinkFixReport{}, err
	}
	return svc.linkFix.FixAfterRename(filepath.ToSlash(oldPath), filepath.ToSlash(newPath))
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
		dest := pkgPath.Base(p)
		if targetDir != "" {
			dest = targetDir + "/" + dest
		}
		out = append(out, MoveItemDto{From: p, To: dest})
	}
	return out
}

// moveBatch skips unchanged paths and repairs links once after moving entries and subsidiaries.
// Links to entries already moved are still repaired if a later move fails.
func (svc *FileService) MoveBatch(req MoveBatchRequestDto) ([]refactor.LinkFixReport, error) {
	started := time.Now()
	items := batchItems(req.Items, req.Paths, req.TargetFolder)
	skipped := 0
	ops := make([]refactor.LinkFixOp, 0, len(items))
	for _, item := range items {
		if item.From == item.To {
			skipped++
			continue
		}
		if err := svc.moveOne(item.From, item.To); err != nil {
			_, _ = svc.linkFix.FixBatch(ops)
			return nil, err
		}
		ops = append(ops, refactor.RenameOp(filepath.ToSlash(item.From), filepath.ToSlash(item.To)))
	}
	logBatchPhase("move", len(items), skipped, started)
	return svc.linkFix.FixBatch(ops)
}

// copyBatch copies entries and subsidiaries, resolving collisions with " (copy)" / " (copy N)" names.
// References remain unchanged; results report the actual destinations.
func (svc *FileService) CopyBatch(req CopyBatchRequestDto) ([]CopyResultDto, error) {
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
	if !filesystem.IsDir(srcAbs) {
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
	dir, name := pkgPath.Split(filesystem.NormaliseVirtual(wanted))
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
	return "", &httpkit.HTTPError{Status: http.StatusConflict, Msg: "no free name available for " + wanted}
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
	src := filesystem.NormaliseVirtual(from)
	dst := filesystem.NormaliseVirtual(to)
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
func (svc *FileService) OpenForRead(rel string) (*readable, error) {
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

func (svc *FileService) ZipFolder(dirPath string, w io.Writer) error {
	sourceAbs, err := svc.storage.Resolve(dirPath)
	if err != nil {
		return err
	}
	if !filesystem.IsDir(sourceAbs) {
		return fmt.Errorf("%w: %s", filesystem.ErrNotDirectory, dirPath)
	}
	zw := zip.NewWriter(w)
	defer zw.Close()
	prefix := ""
	if norm := filesystem.NormaliseVirtual(dirPath); norm != "" {
		prefix = pkgPath.Base(norm) + "/"
		if _, err := zw.Create(prefix); err != nil {
			return err
		}
	}
	return filepath.Walk(sourceAbs, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Exclude service state (including prompt transcripts) and git data from exports.
			if svc.storage.IsStatePath(p) || svc.storage.IsGitDir(p) {
				return filepath.SkipDir
			}
			if prefix != "" && p != sourceAbs {
				rel, err := filepath.Rel(sourceAbs, p)
				if err != nil {
					return err
				}
				if _, err := zw.Create(prefix + filepath.ToSlash(rel) + "/"); err != nil {
					return err
				}
			}
			return nil
		}
		rel, err := filepath.Rel(sourceAbs, p)
		if err != nil {
			return err
		}
		entry, err := zw.Create(prefix + filepath.ToSlash(rel))
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

func (svc *FileService) DiskUsage() DiskUsageDto {
	total, free, usable := svc.storage.DiskUsage()
	return DiskUsageDto{TotalSpace: total, FreeSpace: free, UsableSpace: usable}
}

// Return an absolute root for use by external tools, falling back to the configured path.
func (svc *FileService) StoreInfo() StoreInfoDto {
	root := svc.storage.Root
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	return StoreInfoDto{RootPath: root}
}
