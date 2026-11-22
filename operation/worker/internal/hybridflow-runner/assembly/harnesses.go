package assembly

import (
	coreconfig "kiao/worker/internal/core/config"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	codexcli "kiao/worker/internal/hybridflow-runner/harnesses/codex"
	musecli "kiao/worker/internal/hybridflow-runner/harnesses/muse"
	picli "kiao/worker/internal/hybridflow-runner/harnesses/pi"
	"path/filepath"
)

func NewHarnessRegistry(cfg *runnerconfig.Config) *harnessapi.HarnessRegistry {
	profiles := picli.NewPiProfiles(cfg)
	modelPreferencesDir := ""
	if cfg.Config != nil && cfg.RootPath != "" {
		modelPreferencesDir = filepath.Join(coreconfig.DefaultStatePath(cfg.RootPath), "harness-models")
	}
	return &harnessapi.HarnessRegistry{Profiles: profiles, ModelPreferencesDir: modelPreferencesDir, Entries: []harnessapi.HarnessEntry{{
		Name:    harnessapi.HarnessClaude,
		Label:   "Claude",
		Harness: claudecli.NewClaudeHarness(cfg),
		Binary:  claudecli.ClaudeBinaryName,
		Allowed: !cfg.ClaudeDisabled,
		Model:   harnessapi.DefaultConversationModel,
		Effort:  harnessapi.DefaultConversationEffort,
	}, {
		Name:    harnessapi.HarnessCodex,
		Label:   "Codex",
		Harness: codexcli.NewCodexHarness(cfg),
		Binary:  codexcli.CodexBinaryName,
		Allowed: !cfg.CodexDisabled,
	}, {
		Name:    harnessapi.HarnessMuse,
		Label:   "Muse",
		Harness: musecli.NewMuseHarness(cfg),
		Binary:  musecli.MuseBinaryName,
		Allowed: !cfg.MuseDisabled,
	}, {
		Name: harnessapi.HarnessPi, Label: "Pi (Harness)", Harness: picli.NewPiHarness(cfg, profiles), Allowed: !cfg.PiDisabled,
	}}}
}
