package skills

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
)

// RetireLegacyCopies removes former KIAO copies from the store and harness homes.
func RetireLegacyCopies(storePath string) {
	workspaceDirs := []string{".agent/skills", ".agents/skills", ".claude/skills"}
	retireCopiesUnder(storePath, workspaceDirs...)

	home, _ := os.UserHomeDir()
	homeDirs := append(workspaceDirs, ".codex/skills", ".config/muse/skills")
	for _, dir := range []string{home, os.Getenv("KIAO_WORKER_LEGACY_SKILLS_HOME")} {
		retireCopiesUnder(dir, homeDirs...)
	}
	retireCopiesUnder(os.Getenv("CLAUDE_CONFIG_DIR"), "skills")
	retireCopiesUnder(os.Getenv("CODEX_HOME"), "skills")
	retireCopiesUnder(os.Getenv("XDG_CONFIG_HOME"), "muse/skills")
}

func retireCopiesUnder(rootPath string, dirs ...string) {
	if strings.TrimSpace(rootPath) == "" {
		return
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			logSkills.Warn("cannot open the root to retire managed skills", "path", rootPath, "error", err)
		}
		return
	}
	defer root.Close()
	for _, dir := range dirs {
		if realDir(root, dir) {
			retireCopies(root, dir)
		}
	}
}

func realDir(root *os.Root, dir string) bool {
	current := "."
	for _, part := range strings.Split(dir, "/") {
		current = path.Join(current, part)
		info, err := root.Lstat(current)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				logSkills.Warn("cannot inspect the previous skills directory", "path", filepath.Join(root.Name(), current), "error", err)
			}
			return false
		}
		if !info.IsDir() {
			return false
		}
	}
	return true
}

func retireCopies(root *os.Root, dir string) {
	entries, err := fs.ReadDir(root.FS(), dir)
	if err != nil {
		logSkills.Warn("cannot read the previous skills directory", "path", filepath.Join(root.Name(), dir), "error", err)
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || strings.HasPrefix(name, ".") {
			continue
		}
		target := path.Join(dir, name)
		var removeErr error
		switch {
		case managedCopy(root, target, name):
			removeErr = root.RemoveAll(target)
		case legacyManifestCopy(root, target, legacyManifestDigests[name]):
			removeErr = root.Remove(path.Join(target, "SKILL.md"))
			if removeErr == nil {
				removeErr = root.Remove(target)
			}
		default:
			continue
		}
		location := filepath.Join(root.Name(), target)
		if errors.Is(removeErr, fs.ErrNotExist) {
			continue
		}
		if removeErr != nil {
			logSkills.Warn("cannot retire a KIAO skill copy", "path", location, "error", removeErr)
			continue
		}
		logSkills.Info("retired a KIAO skill copy", "path", location)
	}
}

func legacyManifestCopy(root *os.Root, dir string, fingerprints []string) bool {
	if len(fingerprints) == 0 {
		return false
	}
	entries, err := fs.ReadDir(root.FS(), dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "SKILL.md" {
		return false
	}
	info, err := entries[0].Info()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 128*1024 {
		return false
	}
	body, err := root.ReadFile(path.Join(dir, "SKILL.md"))
	if err != nil {
		return false
	}
	// Git checkouts on Windows can write CRLF for the same manifest.
	digest := sha256.Sum256(bytes.ReplaceAll(body, []byte("\r\n"), []byte("\n")))
	return slices.Contains(fingerprints, hex.EncodeToString(digest[:]))
}

func managedCopy(root *os.Root, dir, name string) bool {
	marker := path.Join(dir, ".kiao-skill")
	info, err := root.Lstat(marker)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return false
	}
	body, err := root.ReadFile(marker)
	if err != nil {
		return false
	}
	header, lines, _ := strings.Cut(string(body), "\n")
	switch strings.TrimSpace(header) {
	case "# Installed by kiao (worker) from its skills catalogue,",
		"# Installed by kiao (worker) from the skills bundled into it,",
		"# Installed by kiao-dcms (worker) from the skills bundled into it,",
		"# Installed by kiao-dcms (files-service) from the skills bundled into it,":
	default:
		return false
	}
	var skill, digest string
	for _, line := range strings.Split(lines, "\n") {
		switch key, value, _ := strings.Cut(strings.TrimSpace(line), "="); key {
		case "skill":
			skill = value
		case "digest":
			digest = value
		}
	}
	decoded, err := hex.DecodeString(digest)
	if skill != name || err != nil || len(decoded) != sha256.Size {
		return false
	}
	_, err = root.Lstat(path.Join(dir, ".git"))
	return errors.Is(err, fs.ErrNotExist)
}
