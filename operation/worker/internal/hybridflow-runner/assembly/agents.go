package assembly

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	codexcli "kiao/worker/internal/hybridflow-runner/agents/codex"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	opencodecli "kiao/worker/internal/hybridflow-runner/agents/opencode"
	picli "kiao/worker/internal/hybridflow-runner/agents/pi"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/skills"
)

func NewAgentRegistry(cfg *runnerconfig.Config) *agentapi.AgentRegistry {
	profiles := picli.NewPiProfiles(cfg)
	return &agentapi.AgentRegistry{Profiles: profiles, Entries: []agentapi.AgentEntry{{
		Name:    agentapi.AgentClaude,
		Label:   "Claude",
		Agent:   claudecli.NewClaudeAgent(cfg),
		Binary:  skills.ClaudeBinaryName,
		Allowed: !cfg.ClaudeDisabled,
		Model:   agentapi.DefaultConversationModel,
		Effort:  agentapi.DefaultConversationEffort,
	}, {
		Name:    agentapi.AgentCodex,
		Label:   "Codex",
		Agent:   codexcli.NewCodexAgent(cfg),
		Binary:  codexcli.CodexBinaryName,
		Allowed: !cfg.CodexDisabled,
		// Leave model and effort to the host CLI configuration.
	}, {
		Name:    agentapi.AgentMuse,
		Label:   "Muse",
		Agent:   musecli.NewMuseAgent(cfg),
		Binary:  musecli.MuseBinaryName,
		Allowed: !cfg.MuseDisabled,
		// Resolve defaults from the current Muse catalogue in defaultsFor.
	}, {
		Name:    agentapi.AgentOpenCode,
		Label:   "OpenCode",
		Agent:   opencodecli.NewOpenCodeAgent(cfg),
		Binary:  opencodecli.OpencodeBinaryName,
		Allowed: !cfg.OpenCodeDisabled,
		// Leave model and effort to the host CLI configuration.
	}, {
		Name: agentapi.AgentPi, Label: "Pi (Agent)", Agent: picli.NewPiAgent(cfg, profiles), Allowed: !cfg.PiDisabled,
	}}}
}
