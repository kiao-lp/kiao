package files

import (
	"bytes"
	"embed"
	"io/fs"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
)

//go:embed all:pdfthemes
var pdfThemeDefaults embed.FS

const pdfThemesDirRel = "kiao-user-config/pdf-themes"

// SyncPdfThemes refreshes the delivered filenames on every start. Other filenames belong to the
// store: adding, editing or deleting a custom theme never changes what the next sync writes.
func SyncPdfThemes(cfg *Config) {
	if cfg.RootPath == "" {
		return
	}
	dir := filepath.Join(cfg.RootPath, filepath.FromSlash(pdfThemesDirRel))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		core.LogMain.Warn("cannot create the PDF themes folder", "path", dir, "error", err)
		return
	}
	entries, err := fs.ReadDir(pdfThemeDefaults, "pdfthemes")
	if err != nil {
		core.LogMain.Warn("cannot read the bundled PDF themes", "error", err)
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		body, err := pdfThemeDefaults.ReadFile("pdfthemes/" + entry.Name())
		if err != nil {
			core.LogMain.Warn("cannot read a bundled PDF theme", "file", entry.Name(), "error", err)
			continue
		}
		target := filepath.Join(dir, entry.Name())
		current, err := os.ReadFile(target)
		if err == nil && bytes.Equal(current, body) {
			continue
		}
		if err != nil && !os.IsNotExist(err) {
			core.LogMain.Warn("cannot read a delivered PDF theme", "file", target, "error", err)
			continue
		}
		if err := core.WriteFileAtomic(target, body, 0o644); err != nil {
			core.LogMain.Warn("cannot synchronize a PDF theme", "file", target, "error", err)
		}
	}
}
