package assembly

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	codexcli "kiao/worker/internal/hybridflow-runner/harnesses/codex"
	musecli "kiao/worker/internal/hybridflow-runner/harnesses/muse"
	opencodecli "kiao/worker/internal/hybridflow-runner/harnesses/opencode"
	picli "kiao/worker/internal/hybridflow-runner/harnesses/pi"
	"kiao/worker/internal/hybridflow-runner/skills"
)

func NewHarnessRegistry(cfg *runnerconfig.Config) *harnessapi.HarnessRegistry {
	profiles := picli.NewPiProfiles(cfg)
	return &harnessapi.HarnessRegistry{Profiles: profiles, Entries: []harnessapi.HarnessEntry{{
		Name:    harnessapi.HarnessClaude,
		Label:   "Claude",
		Harness: claudecli.NewClaudeHarness(cfg),
		Binary:  skills.ClaudeBinaryName,
		Allowed: !cfg.ClaudeDisabled,
		Model:   harnessapi.DefaultConversationModel,
		Effort:  harnessapi.DefaultConversationEffort,
	}, {
		Name:    harnessapi.HarnessCodex,
		Label:   "Codex",
		Harness: codexcli.NewCodexHarness(cfg),
		Binary:  codexcli.CodexBinaryName,
		Allowed: !cfg.CodexDisabled,
		// Leave model and effort to the host CLI configuration.
	}, {
		Name:    harnessapi.HarnessMuse,
		Label:   "Muse",
		Harness: musecli.NewMuseHarness(cfg),
		Binary:  musecli.MuseBinaryName,
		Allowed: !cfg.MuseDisabled,
		// Resolve defaults from the current Muse catalogue in defaultsFor.
	}, {
		Name:    harnessapi.HarnessOpenCode,
		Label:   "OpenCode",
		Harness: opencodecli.NewOpenCodeHarness(cfg),
		Binary:  opencodecli.OpencodeBinaryName,
		Allowed: !cfg.OpenCodeDisabled,
		// Leave model and effort to the host CLI configuration.
	}, {
		Name: harnessapi.HarnessPi, Label: "Pi (Harness)", Harness: picli.NewPiHarness(cfg, profiles), Allowed: !cfg.PiDisabled,
	}}}
}
