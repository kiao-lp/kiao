package files

import (
	"fmt"

	"kiao/worker/internal/core"
)

type Service struct {
	cfg     *Config
	files   *FileService
	git     *GitService
	actions *ActionCatalog
	media   *mediaCutter
	// Optional callbacks, wired by the program after both services exist.
	configSaved func()
	runnerSaved func()
}

// Start requires RunMigrations to have completed before serving the store.
func Start(cfg *Config) (*Service, error) {
	// Keep the state directory inaccessible to file browsing, renames and deletion.
	storage := &core.Storage{
		Root:     cfg.RootPath,
		StateDir: core.RelativeStateDir(cfg.RootPath, cfg.StatePath),
	}
	linkFix := newLinkFixerWithWorkers(storage, cfg.LinkFixExtensions, cfg.LinkFixWorkers)

	// Re-read after validation to catch manifest changes between the two reads.
	actions, err := loadActionCatalog(cfg.ActionsPath)
	if err != nil {
		return nil, fmt.Errorf("action manifest failure: %w", err)
	}
	core.LogMain.Info("file actions loaded", "count", len(actions.descriptors()))

	return &Service{
		cfg:     cfg,
		files:   newFileService(storage, linkFix),
		git:     newGitService(cfg),
		actions: actions,
		media:   newMediaCutter(storage),
	}, nil
}

// OnDashboardConfigSaved sets the single callback at wiring time.
func (s *Service) OnDashboardConfigSaved(changed func()) { s.configSaved = changed }

// OnRunnerConfigSaved sets the single callback at wiring time.
func (s *Service) OnRunnerConfigSaved(changed func()) { s.runnerSaved = changed }

// UseFFmpeg sets a lookup called on every save, so toolbox installs take effect
// without restart. Without it, saves look for ffmpeg on PATH.
func (s *Service) UseFFmpeg(lookup func() (string, bool)) {
	s.media.ffmpeg = lookup
}
