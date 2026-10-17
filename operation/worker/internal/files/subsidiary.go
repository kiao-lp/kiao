package files

import (
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
)

// subsidiarySuffixes are the known companion suffixes (kiao.worker.SubsidiaryFileService).
// A file named <main><suffix> is subsidiary to <main>: hidden from the listing, moved, copied and
// deleted with it, and offered beside it as a companion tab.
//
// Derived from indexSuffixes rather than spelled out, so adding an index format is one line in
// fileindex.go and not a hunt for every list that had to hear about it — an index nobody added
// here would show up as a file of its own and outlive the document it describes.
var subsidiarySuffixes = append(append([]string{}, indexSuffixes...), ".blog.md")

// sidecarSuffixes name a settings file that belongs to the content file it sits beside: an
// article's or a podcast script's `<file>.config.json` carries that item's reader-facing title,
// bibliography, voice and pronunciation dictionary.
//
// They are deliberately NOT subsidiaries. A subsidiary is hidden from listings and offered as a
// companion tab in the editor, and a settings sidecar is neither — it is edited through the item's
// own editor. Deletion is the one place it has to follow its main file: leaving it behind orphans a
// settings file naming content that no longer exists, and — now that removing a directory takes
// everything under it — used to be what kept a unit folder from ever going away.
var sidecarSuffixes = []string{".config.json"}

// matchedSuffix returns the subsidiary suffix that fileName ends with, or "" if none.
func matchedSuffix(fileName string) string {
	for _, suffix := range subsidiarySuffixes {
		if strings.HasSuffix(fileName, suffix) {
			return suffix
		}
	}
	return ""
}

// mainFileName returns the main file name for a subsidiary name, and whether the name was a
// subsidiary at all (e.g. "foo.pdf.index.md" -> "foo.pdf", true).
func mainFileName(subsidiaryName string) (string, bool) {
	if suffix := matchedSuffix(subsidiaryName); suffix != "" {
		return subsidiaryName[:len(subsidiaryName)-len(suffix)], true
	}
	return "", false
}

// subsidiaryPaths returns every possible subsidiary path for the given absolute main file path.
func subsidiaryPaths(mainAbs string) []string {
	dir := filepath.Dir(mainAbs)
	base := filepath.Base(mainAbs)
	paths := make([]string, 0, len(subsidiarySuffixes))
	for _, suffix := range subsidiarySuffixes {
		paths = append(paths, filepath.Join(dir, base+suffix))
	}
	return paths
}

// deleteSubsidiaries removes every existing subsidiary of the given main file.
func deleteSubsidiaries(mainAbs string) {
	for _, sub := range subsidiaryPaths(mainAbs) {
		if err := os.Remove(sub); err != nil && !os.IsNotExist(err) {
			logSubsidiary.Warn("failed to delete subsidiary", "path", sub, "error", err)
		}
	}
}

// deleteSidecars removes every existing settings sidecar of the given main file. Separate from
// deleteSubsidiaries because a sidecar is only *deleted* with its main file — it is not hidden from
// listings, not a companion tab, and rename leaves it alone.
func deleteSidecars(mainAbs string) {
	dir := filepath.Dir(mainAbs)
	base := filepath.Base(mainAbs)
	for _, suffix := range sidecarSuffixes {
		sidecar := filepath.Join(dir, base+suffix)
		if err := os.Remove(sidecar); err != nil && !os.IsNotExist(err) {
			logSubsidiary.Warn("failed to delete sidecar", "path", sidecar, "error", err)
		}
	}
}

// moveSubsidiaries moves every existing subsidiary alongside its renamed main file.
func moveSubsidiaries(oldMainAbs, newMainAbs string) {
	oldPaths := subsidiaryPaths(oldMainAbs)
	newPaths := subsidiaryPaths(newMainAbs)
	for i := range oldPaths {
		if _, err := os.Stat(oldPaths[i]); err == nil {
			if err := os.Rename(oldPaths[i], newPaths[i]); err != nil {
				logSubsidiary.Warn("failed to move subsidiary", "from", oldPaths[i], "to", newPaths[i], "error", err)
			}
		}
	}
}

// copySubsidiaries copies every existing subsidiary alongside the copy of its main file, so a
// duplicated entry keeps the same companion family as the original.
func copySubsidiaries(srcMainAbs, dstMainAbs string) {
	srcPaths := subsidiaryPaths(srcMainAbs)
	dstPaths := subsidiaryPaths(dstMainAbs)
	for i := range srcPaths {
		if _, err := os.Stat(srcPaths[i]); err == nil {
			if err := core.CopyRegularFile(srcPaths[i], dstPaths[i]); err != nil {
				logSubsidiary.Warn("failed to copy subsidiary", "from", srcPaths[i], "to", dstPaths[i], "error", err)
			}
		}
	}
}

// companionsFor returns the full companion family for the given absolute file path: the main
// entry plus every supported subsidiary suffix, each tagged with whether it exists on disk.
func companionsFor(resolvedAbs string) []FileCompanionDto {
	parent := filepath.Dir(resolvedAbs)
	if parent == "" {
		return []FileCompanionDto{}
	}
	fileName := filepath.Base(resolvedAbs)
	mainName := fileName
	if m, ok := mainFileName(fileName); ok {
		mainName = m
	}

	family := make([]FileCompanionDto, 0, len(subsidiarySuffixes)+1)
	family = append(family, FileCompanionDto{
		Name:   mainName,
		Suffix: "",
		Exists: fileExists(filepath.Join(parent, mainName)),
	})
	for _, suffix := range subsidiarySuffixes {
		family = append(family, FileCompanionDto{
			Name:   mainName + suffix,
			Suffix: suffix,
			Exists: fileExists(filepath.Join(parent, mainName+suffix)),
		})
	}
	return family
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
