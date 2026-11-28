package fileshttp

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/logging"
	pkgActions "kiao/worker/internal/files/actions"
	fileconfig "kiao/worker/internal/files/configuration"
	pkgContent "kiao/worker/internal/files/content"
	"kiao/worker/internal/files/git"
	"kiao/worker/internal/files/media"
	"kiao/worker/internal/files/refactor"
)

type Service struct {
	cfg     *fileconfig.Config
	files   *pkgContent.FileService
	git     *git.GitService
	actions *pkgActions.ActionCatalog
	media   *media.MediaCutter
	// Optional callback, wired after the runner starts.
	runnerSaved func()
}

// Start requires RunMigrations to have completed before serving the store.
func Start(cfg *fileconfig.Config) (*Service, error) {
	// Keep the state directory inaccessible to file browsing, renames and deletion.
	storage := filesystem.NewStorage(cfg.DCMSRoot, cfg.StatePath)
	linkFix := refactor.NewLinkFixerWithWorkers(storage, cfg.LinkFixExtensions, cfg.LinkFixWorkers)

	// Re-read after validation to catch manifest changes between the two reads.
	actions, err := pkgActions.LoadActionCatalog(cfg.ActionsPath)
	if err != nil {
		return nil, fmt.Errorf("action manifest failure: %w", err)
	}
	logging.LogMain.Info("file actions loaded", "count", len(actions.Descriptors()))

	return &Service{
		cfg:     cfg,
		files:   pkgContent.NewFileService(storage, linkFix),
		git:     git.NewGitService(cfg),
		actions: actions,
		media:   media.NewMediaCutter(storage),
	}, nil
}

// OnRunnerConfigSaved sets the single callback at wiring time.
func (s *Service) OnRunnerConfigSaved(changed func()) { s.runnerSaved = changed }

// UseFFmpeg sets a lookup called on every save, so toolbox installs take effect
// without restart. Without it, saves look for ffmpeg on PATH.
func (s *Service) UseFFmpeg(lookup func() (string, bool)) {
	s.media.Ffmpeg = lookup
}
