package hybridflowrunner

import (
	"os/exec"
	"strings"
)

// A conversation is bound to its agent at creation: session ids are engine-specific.
// Changing agent requires a fork that copies the transcript and starts a new session
// (ConversationStore.fork and AgentBranching).

// Wire values persisted in conversations and accepted by create/fork payloads.
const (
	agentClaude   = "claude"
	agentCodex    = "codex"
	agentMuse     = "muse"
	agentOpenCode = "opencode"
)

type agentEntry struct {
	name  string
	label string
	agent Agent
	// Offer an agent only while its CLI is on PATH.
	binary string
	// Environment policy is fixed at startup; CLI availability and the panel gate are dynamic.
	allowed bool
	// Per-agent defaults; empty means use the CLI default. Muse resolves its catalogue on demand.
	model  string
	effort string
}

// AgentGate is checked on each read so panel changes take effect without restart.
// A nil gate permits all agents.
type AgentGate interface {
	AgentOffered(name string) bool
}

// Keep all known agents, including unavailable ones, so existing conversations still render
// and newly installed CLIs become available. The first offered agent is the default.
type agentRegistry struct {
	entries []agentEntry
	gate    AgentGate
}

// Test seam for CLI availability; production never reassigns it.
var cliOnPath = func(binary string) bool {
	_, err := exec.LookPath(binary)
	return err == nil
}

func newAgentRegistry(cfg *Config) *agentRegistry {
	return &agentRegistry{entries: []agentEntry{{
		name:    agentClaude,
		label:   "Claude",
		agent:   newClaudeAgent(cfg),
		binary:  claudeBinaryName,
		allowed: !cfg.ClaudeDisabled,
		model:   defaultConversationModel,
		effort:  defaultConversationEffort,
	}, {
		name:    agentCodex,
		label:   "Codex",
		agent:   newCodexAgent(cfg),
		binary:  codexBinaryName,
		allowed: !cfg.CodexDisabled,
		// Leave model and effort to the host CLI configuration.
	}, {
		name:    agentMuse,
		label:   "Muse",
		agent:   newMuseAgent(cfg),
		binary:  museBinaryName,
		allowed: !cfg.MuseDisabled,
		// Resolve defaults from the current Muse catalogue in defaultsFor.
	}, {
		name:    agentOpenCode,
		label:   "OpenCode",
		agent:   newOpenCodeAgent(cfg),
		binary:  opencodeBinaryName,
		allowed: !cfg.OpenCodeDisabled,
		// Leave model and effort to the host CLI configuration.
	}}}
}

// Recheck CLI and panel availability on each call so install/uninstall changes take effect immediately.
func (r *agentRegistry) offers(entry agentEntry) bool {
	if !r.enabled(entry) {
		return false
	}
	// An empty binary denotes a test stub; no CLI installation is required.
	if entry.binary != "" && !cliOnPath(entry.binary) {
		return false
	}
	return true
}

// Every agent feature shares the deployment and configuration-panel switches.
// CLI detection stays separate so an enabled agent can be signed in during setup.
func (r *agentRegistry) enabled(entry agentEntry) bool {
	return entry.allowed && (r.gate == nil || r.gate.AgentOffered(entry.name))
}

func (r *agentRegistry) isEnabled(name string) bool {
	if r != nil {
		for _, entry := range r.entries {
			if entry.name == name {
				return r.enabled(entry)
			}
		}
	}
	return false
}

func (r *agentRegistry) offered() []agentEntry {
	if r == nil {
		return nil
	}
	var offered []agentEntry
	for _, entry := range r.entries {
		if r.offers(entry) {
			offered = append(offered, entry)
		}
	}
	return offered
}

// Fall back to Claude when none are offered, matching legacy conversation records.
func (r *agentRegistry) defaultName() string {
	if offered := r.offered(); len(offered) > 0 {
		return offered[0].name
	}
	return agentClaude
}

// The hello payload may contain no agents when no CLI is available.
func (r *agentRegistry) names() []string {
	offered := r.offered()
	names := make([]string, 0, len(offered))
	for _, entry := range offered {
		names = append(names, entry.name)
	}
	return names
}

// An empty name selects the default. Reject unavailable names rather than silently
// running a different agent.
func (r *agentRegistry) resolve(name string) (agentEntry, bool) {
	offered := r.offered()
	if len(offered) == 0 {
		return agentEntry{}, false
	}
	wanted := strings.TrimSpace(name)
	if wanted == "" {
		return offered[0], true
	}
	for _, entry := range offered {
		if entry.name == wanted {
			return entry, true
		}
	}
	return agentEntry{}, false
}

func (r *agentRegistry) known(name string) bool {
	_, ok := r.resolve(name)
	return ok
}

// Legacy cards name engines directly. Recognize known but unavailable engines so the
// runner reports platform unavailability rather than an unknown card value.
func (r *agentRegistry) drives(name string) bool {
	if r == nil {
		return false
	}
	for _, entry := range r.entries {
		if entry.name == strings.TrimSpace(name) {
			return true
		}
	}
	return false
}

func (r *agentRegistry) name(asked string) string {
	entry, ok := r.resolve(asked)
	if !ok {
		return r.defaultName()
	}
	return entry.name
}

// Read all entries so unavailable agents retain their labels in existing conversations.
func (r *agentRegistry) label(name string) string {
	if r != nil {
		for _, entry := range r.entries {
			if entry.name == strings.TrimSpace(name) {
				return entry.label
			}
		}
	}
	return name
}

func (r *agentRegistry) driverFor(name string) Agent {
	if entry, ok := r.resolve(name); ok {
		return entry.agent
	}
	return nil
}

// Muse catalogue ids are versioned, and the channel names its default with isDefault,
// so resolve its defaults on each call. Other agents use their entry defaults
// (empty delegates to the CLI).
func (r *agentRegistry) defaultsFor(name string) (model, effort string) {
	entry, ok := r.resolve(name)
	if !ok {
		return defaultConversationModel, defaultConversationEffort
	}
	if entry.name == agentMuse {
		options, ok := entry.agent.(AgentOptions)
		if !ok {
			return "", ""
		}
		offered := options.Options()
		if defaulter, ok := entry.agent.(interface{ DefaultModel() string }); ok {
			if model := defaulter.DefaultModel(); model != "" {
				return model, defaultMuseEffort(offered.Efforts)
			}
		}
		return defaultMuseModel(offered.Models), defaultMuseEffort(offered.Efforts)
	}
	return entry.model, entry.effort
}

// This is the agent gate; callers check Config.allowsPermissionMode first.
// Missing AgentOptions imposes no restriction; a published list must include the mode.
func (r *agentRegistry) publishesMode(name, mode string) bool {
	entry, ok := r.resolve(name)
	if !ok {
		return false
	}
	options, ok := entry.agent.(AgentOptions)
	if !ok {
		return true
	}
	for _, offered := range options.Options().PermissionModes {
		if offered.Value == mode {
			return true
		}
	}
	return false
}

// A disabled agent must not be probed, including by a quota-blocked run.
func (r *agentRegistry) usageFor(name string) AgentUsage {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	if wanted == "" {
		entry, ok := r.resolve("")
		if !ok {
			return nil
		}
		wanted = entry.name
	}
	for _, entry := range r.entries {
		if entry.name == wanted && r.enabled(entry) {
			usage, _ := entry.agent.(AgentUsage)
			return usage
		}
	}
	return nil
}

// Enabled agents can be signed in during setup, before their CLI is detected.
func (r *agentRegistry) apiKeyLoginFor(name string) AgentAPIKeyLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.entries {
		if entry.name == wanted && r.enabled(entry) {
			login, _ := entry.agent.(AgentAPIKeyLogin)
			return login
		}
	}
	return nil
}

// Like apiKeyLoginFor, allow setup only while the agent is enabled.
func (r *agentRegistry) deviceLoginFor(name string) AgentDeviceLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.entries {
		if entry.name == wanted && r.enabled(entry) {
			login, _ := entry.agent.(AgentDeviceLogin)
			return login
		}
	}
	return nil
}

// Session branching determines whether a fork carries the session or only the transcript.
func (r *agentRegistry) branches(name string) bool {
	entry, ok := r.resolve(name)
	if !ok {
		return false
	}
	branching, ok := entry.agent.(AgentBranching)
	return ok && branching.BranchesSessions()
}

// Test seam; production never replaces registered drivers.
func (r *agentRegistry) set(name string, agent Agent) {
	if r == nil {
		return
	}
	for i := range r.entries {
		if r.entries[i].name == name {
			r.entries[i].agent = agent
			// The stub replaces the CLI; do not require a real installation.
			r.entries[i].binary = ""
			return
		}
	}
}

func modeUnsupportedMessage(label, mode string) string {
	return label + " does not offer the " + mode + " permission mode. " +
		"Choose one it offers, or start a conversation on an agent that has this one."
}
