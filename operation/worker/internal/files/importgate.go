package files

import (
	"embed"
	"io/fs"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
)

// Matchers are editable store content, seeded once; Dashboard evaluates them during upload review.

// Include the README so users can add their own matchers.
//
//go:embed all:importgate
var importGateSeed embed.FS

const (
	importGateDirRel  = "kiao-user-config/import-gate"
	importGateSeedDir = "importgate"
)

// EnsureImportGateMatchers seeds stores without an import-gate folder, best-effort.
// Existing folders are left untouched so intentionally deleted categories stay deleted.
// New bundled categories require manual copying or deleting the folder to re-seed.
func EnsureImportGateMatchers(cfg *Config) {
	dir := filepath.Join(cfg.RootPath, filepath.FromSlash(importGateDirRel))
	if _, err := os.Stat(dir); err == nil {
		return
	} else if !os.IsNotExist(err) {
		core.LogMain.Warn("cannot read the import-gate folder; the review will highlight nothing",
			"path", dir, "error", err)
		return
	}

	entries, err := fs.ReadDir(importGateSeed, importGateSeedDir)
	if err != nil || len(entries) == 0 {
		core.LogMain.Warn("this build carries no import-gate catalogue", "error", err)
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		core.LogMain.Warn("cannot create the import-gate folder; the review will highlight nothing",
			"path", dir, "error", err)
		return
	}

	written := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		body, err := fs.ReadFile(importGateSeed, importGateSeedDir+"/"+entry.Name())
		if err != nil {
			continue
		}
		if err := core.WriteFileAtomic(filepath.Join(dir, entry.Name()), body, 0o644); err != nil {
			core.LogMain.Warn("cannot write an import-gate category",
				"file", entry.Name(), "error", err)
			continue
		}
		written++
	}
	core.LogMain.Info("import-gate catalogue seeded", "path", dir, "files", written)
}
