package files

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"kiao/worker/internal/core"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Duplicate and largest-file reports share one walk with .kiao-files [search] exclusions.
// Only files sharing a size are hashed, avoiding reads of unique-size files.

const maxOptimizationFiles = 50000

// Hash the groups with the greatest potential savings first; unprocessed groups mean truncation.
const maxHashBytes int64 = 4 << 30

const maxLargestFiles = 100

const maxDuplicateGroups = 500

// Files may have changed since the scan; report a conflict rather than an invalid request.
var errNotIdentical = &core.HTTPError{Status: http.StatusConflict, Msg: "these files are no longer identical"}

// Refuse to overwrite a target that is not one of the copies.
var errTargetTaken = &core.HTTPError{Status: http.StatusConflict, Msg: "another file already has that name at that location"}

var errNothingToKeep = core.Invalid("a consolidation needs at least two files")

var errNotARegularFile = core.Invalid("not a regular file")

type scannedFile struct {
	rel  string
	size int64
	mod  int64
}

// fileOptimizations reports duplicates and largest files below p. Empty files (e.g. .gitkeep)
// are omitted, as are subsidiaries and settings sidecars that must stay with their main file.
func (svc *FileService) fileOptimizations(p string) (FileOptimizationsDto, error) {
	absRoot, err := svc.storage.Resolve(p)
	if err != nil {
		return FileOptimizationsDto{}, err
	}
	if !core.IsDir(absRoot) {
		return FileOptimizationsDto{}, core.ErrNotDirectory
	}

	files, truncated := svc.scanForOptimization(absRoot)
	groups, hashTruncated := duplicateGroups(svc.storage.Root, files)

	logOptimize.Info("file optimizations", "path", p, "scanned", len(files),
		"duplicateGroups", len(groups), "truncated", truncated || hashTruncated)

	return FileOptimizationsDto{
		Duplicates: groups,
		Largest:    largestFiles(files),
		Scanned:    len(files),
		Truncated:  truncated || hashTruncated,
	}, nil
}

// scanForOptimization applies search exclusions and reports whether the file cap stopped the walk.
func (svc *FileService) scanForOptimization(absRoot string) ([]scannedFile, bool) {
	var out []scannedFile
	truncated := false
	walk := newKiaoWalk(svc.storage.Root, absRoot, concernSearch)
	_ = filepath.WalkDir(absRoot, func(abs string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if abs != absRoot && skipMachineryDir(d.Name()) {
				return filepath.SkipDir
			}
			if svc.storage.IsStatePath(abs) || svc.storage.IsGitDir(abs) || walk.excludesDir(abs) {
				return filepath.SkipDir
			}
			return nil
		}
		if walk.excludesFile(abs) || belongsToAMainFile(abs) {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return nil
		}
		if len(out) >= maxOptimizationFiles {
			truncated = true
			return filepath.SkipAll
		}
		rel, rerr := filepath.Rel(svc.storage.Root, abs)
		if rerr != nil {
			return nil
		}
		out = append(out, scannedFile{rel: filepath.ToSlash(rel), size: info.Size(), mod: info.ModTime().UnixMilli()})
		return nil
	})
	return out, truncated
}

// belongsToAMainFile requires an existing main file; orphaned companions remain independent candidates.
func belongsToAMainFile(abs string) bool {
	name := filepath.Base(abs)
	main, ok := mainFileName(name)
	if !ok {
		if s := matchedSidecarSuffix(name); s != "" {
			main, ok = name[:len(name)-len(s)], true
		}
	}
	if !ok || main == "" {
		return false
	}
	return fileExists(filepath.Join(filepath.Dir(abs), main))
}

// matchedSidecarSuffix returns the matching settings-sidecar suffix, or "".
func matchedSidecarSuffix(fileName string) string {
	for _, suffix := range sidecarSuffixes {
		if len(fileName) > len(suffix) && strings.HasSuffix(fileName, suffix) {
			return suffix
		}
	}
	return ""
}

func largestFiles(files []scannedFile) []FileDto {
	sorted := make([]scannedFile, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].size != sorted[j].size {
			return sorted[i].size > sorted[j].size
		}
		return sorted[i].rel < sorted[j].rel
	})
	if len(sorted) > maxLargestFiles {
		sorted = sorted[:maxLargestFiles]
	}
	out := make([]FileDto, 0, len(sorted))
	for _, f := range sorted {
		out = append(out, FileDto{
			Path:         f.rel,
			Size:         f.size,
			LastModified: f.mod,
			Companions:   []FileCompanionDto{},
		})
	}
	return out
}

// duplicateGroups hashes same-size candidates by potential savings: size × (copies − 1).
// Only matching hashes are reported; exhausted byte or group budgets mark the result truncated.
func duplicateGroups(root string, files []scannedFile) ([]DuplicateGroupDto, bool) {
	bySize := map[int64][]scannedFile{}
	for _, f := range files {
		bySize[f.size] = append(bySize[f.size], f)
	}
	candidates := make([][]scannedFile, 0, len(bySize))
	for _, group := range bySize {
		if len(group) > 1 {
			candidates = append(candidates, group)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		wi := candidates[i][0].size * int64(len(candidates[i])-1)
		wj := candidates[j][0].size * int64(len(candidates[j])-1)
		if wi != wj {
			return wi > wj
		}
		return candidates[i][0].rel < candidates[j][0].rel
	})

	out := []DuplicateGroupDto{}
	truncated := false
	budget := maxHashBytes
	for _, group := range candidates {
		if budget < group[0].size*int64(len(group)) {
			truncated = true
			break
		}
		byHash := map[string][]scannedFile{}
		for _, f := range group {
			sum, err := hashFile(filepath.Join(root, filepath.FromSlash(f.rel)))
			if err != nil {
				continue // unreadable files cannot be verified
			}
			budget -= f.size
			byHash[sum] = append(byHash[sum], f)
		}
		for sum, same := range byHash {
			if len(same) < 2 {
				continue
			}
			sort.Slice(same, func(i, j int) bool { return same[i].rel < same[j].rel })
			out = append(out, duplicateGroupDto(sum, same))
		}
	}

	// Actual savings determine report order after size groups have been split by hash.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Wasted != out[j].Wasted {
			return out[i].Wasted > out[j].Wasted
		}
		return out[i].Files[0].Path < out[j].Files[0].Path
	})
	if len(out) > maxDuplicateGroups {
		out, truncated = out[:maxDuplicateGroups], true
	}
	return out, truncated
}

func duplicateGroupDto(hash string, same []scannedFile) DuplicateGroupDto {
	entries := make([]FileDto, 0, len(same))
	for _, f := range same {
		entries = append(entries, FileDto{
			Path:         f.rel,
			Size:         f.size,
			LastModified: f.mod,
			Companions:   []FileCompanionDto{},
		})
	}
	return DuplicateGroupDto{
		Hash:   hash,
		Size:   same[0].size,
		Wasted: same[0].size * int64(len(same)-1),
		Files:  entries,
	}
}

// distinctPaths removes repeats while preserving request order.
func distinctPaths(paths []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		key := filepath.ToSlash(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out
}

// Stream the content hash to keep memory use independent of file size.
func hashFile(abs string) (string, error) {
	f, err := os.Open(abs)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// deduplicate moves identical copies onto target so link repair redirects their references.
// Re-hash before moving: changed content or a target taken by another file returns HTTP 409.
func (svc *FileService) deduplicate(requested []string, target string) (DeduplicateResultDto, error) {
	// Count distinct paths before the two-file guard to avoid failing after a partial move.
	paths := distinctPaths(requested)
	if len(paths) < 2 || target == "" {
		return DeduplicateResultDto{}, errNothingToKeep
	}
	named := map[string]bool{}
	var hash string
	for _, p := range paths {
		abs, err := svc.storage.Resolve(p)
		if err != nil {
			return DeduplicateResultDto{}, err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return DeduplicateResultDto{}, err // gone since the scan → 404
		}
		if !info.Mode().IsRegular() {
			return DeduplicateResultDto{}, errNotARegularFile
		}
		sum, err := hashFile(abs)
		if err != nil {
			return DeduplicateResultDto{}, err
		}
		if hash == "" {
			hash = sum
		} else if sum != hash {
			return DeduplicateResultDto{}, errNotIdentical
		}
		named[filepath.ToSlash(p)] = true
	}

	targetAbs, err := svc.storage.Resolve(target)
	if err != nil {
		return DeduplicateResultDto{}, err
	}
	if !named[filepath.ToSlash(target)] && fileExists(targetAbs) {
		return DeduplicateResultDto{}, errTargetTaken
	}

	items := make([]MoveItemDto, 0, len(paths))
	removed := make([]string, 0, len(paths))
	for _, p := range paths {
		if filepath.ToSlash(p) == filepath.ToSlash(target) {
			continue
		}
		items = append(items, MoveItemDto{From: p, To: target})
		removed = append(removed, p)
	}
	reports, err := svc.moveBatch(MoveBatchRequestDto{Items: items})
	if err != nil {
		return DeduplicateResultDto{}, err
	}
	if reports == nil {
		reports = []LinkFixReport{}
	}
	logOptimize.Info("duplicates consolidated", "kept", target, "removed", len(removed))
	return DeduplicateResultDto{Kept: target, Removed: removed, LinkFixes: reports}, nil
}
