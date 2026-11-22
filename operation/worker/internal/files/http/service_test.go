package fileshttp

import (
	"kiao/worker/internal/core/filesystem"
	pkgContent "kiao/worker/internal/files/content"
	"kiao/worker/internal/files/refactor"
)

func newTestService(root string) *pkgContent.FileService {
	storage := &filesystem.Storage{Root: root}
	return pkgContent.NewFileService(storage, refactor.NewLinkFixer(storage, []string{".md", ".txt"}))
}
