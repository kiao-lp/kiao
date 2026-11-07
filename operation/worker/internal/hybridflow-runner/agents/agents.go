package agents

import (
	"os/exec"
	"strings"
)

const AgentClaude = "claude"

const AgentCodex = "codex"

const AgentMuse = "muse"

const AgentOpenCode = "opencode"

const AgentPi = "pi"

type AgentEntry struct {
	Name  string
	Label string
	Agent Agent
	// Offer an agent only while its CLI is on PATH.
	Binary string
	// Environment policy is fixed at startup; CLI availability and the panel gate are dynamic.
	Allowed bool
	// Per-agent defaults; empty means use the CLI default. Muse resolves its catalogue on demand.
	Model  string
	Effort string
}

// AgentGate is checked on each read so panel changes take effect without restart.
// A nil gate permits all agents.
type AgentGate interface {
	AgentOffered(name string) bool
}

// Keep all known agents, including unavailable ones, so existing conversations still render
// and newly installed CLIs become available. The first offered agent is the default.
type AgentRegistry struct {
	Entries  []AgentEntry
	Gate     AgentGate
	Profiles ProfileManager
}

// Test seam for CLI availability; production never reassigns it.
var CLIOnPath = func(binary string) bool {
	_, err := exec.LookPath(binary)
	return err == nil
}

// Recheck CLI and panel availability on each call so install/uninstall changes take effect immediately.
func (r *AgentRegistry) offers(entry AgentEntry) bool {
	if !r.enabled(entry) {
		return false
	}
	if available, ok := entry.Agent.(interface{ Available() bool }); ok && !available.Available() {
		return false
	}
	// An empty binary uses driver availability, or denotes a test stub.
	if entry.Binary != "" && !CLIOnPath(entry.Binary) {
		return false
	}
	return true
}

// Every agent feature shares the deployment and configuration-panel switches.
// CLI detection stays separate so an enabled agent can be signed in during setup.
func (r *AgentRegistry) enabled(entry AgentEntry) bool {
	return entry.Allowed && (r.Gate == nil || r.Gate.AgentOffered(entry.Name))
}

func (r *AgentRegistry) IsEnabled(name string) bool {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == name {
				return r.enabled(entry)
			}
		}
	}
	return false
}

func (r *AgentRegistry) Offered() []AgentEntry {
	if r == nil {
		return nil
	}
	var offered []AgentEntry
	for _, entry := range r.Entries {
		if r.offers(entry) {
			offered = append(offered, entry)
		}
	}
	return offered
}

// Fall back to Claude when none are offered, matching legacy conversation records.
func (r *AgentRegistry) DefaultName() string {
	if offered := r.Offered(); len(offered) > 0 {
		return offered[0].Name
	}
	return AgentClaude
}

// The hello payload may contain no agents when no CLI is available.
func (r *AgentRegistry) Names() []string {
	offered := r.Offered()
	names := make([]string, 0, len(offered))
	for _, entry := range offered {
		names = append(names, entry.Name)
	}
	return names
}

// An empty name selects the default. Reject unavailable names rather than silently
// running a different agent.
func (r *AgentRegistry) Resolve(name string) (AgentEntry, bool) {
	offered := r.Offered()
	if len(offered) == 0 {
		return AgentEntry{}, false
	}
	wanted := strings.TrimSpace(name)
	if wanted == "" {
		return offered[0], true
	}
	for _, entry := range offered {
		if entry.Name == wanted {
			return entry, true
		}
	}
	return AgentEntry{}, false
}

func (r *AgentRegistry) Known(name string) bool {
	_, ok := r.Resolve(name)
	return ok
}

// Legacy cards name engines directly. Recognize known but unavailable engines so the
// runner reports platform unavailability rather than an unknown card value.
func (r *AgentRegistry) Drives(name string) bool {
	if r == nil {
		return false
	}
	for _, entry := range r.Entries {
		if entry.Name == strings.TrimSpace(name) {
			return true
		}
	}
	return false
}

func (r *AgentRegistry) Name(asked string) string {
	entry, ok := r.Resolve(asked)
	if !ok {
		return r.DefaultName()
	}
	return entry.Name
}

// Read all entries so unavailable agents retain their labels in existing conversations.
func (r *AgentRegistry) Label(name string) string {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == strings.TrimSpace(name) {
				return entry.Label
			}
		}
	}
	return name
}

func (r *AgentRegistry) DriverFor(name string) Agent {
	if entry, ok := r.Resolve(name); ok {
		return entry.Agent
	}
	return nil
}

// Muse catalogue ids are versioned, and the channel names its default with isDefault,
// so resolve its defaults on each call. Other agents use their entry defaults
// (empty delegates to the CLI).
func (r *AgentRegistry) DefaultsFor(name string) (model, effort string) {
	entry, ok := r.Resolve(name)
	if !ok {
		return DefaultConversationModel, DefaultConversationEffort
	}
	if entry.Name == AgentMuse {
		options, ok := entry.Agent.(AgentOptions)
		if !ok {
			return "", ""
		}
		offered := options.Options()
		if defaulter, ok := entry.Agent.(interface{ DefaultModel() string }); ok {
			if model := defaulter.DefaultModel(); model != "" {
				return model, DefaultMuseEffort(offered.Efforts)
			}
		}
		return DefaultMuseModel(offered.Models), DefaultMuseEffort(offered.Efforts)
	}
	return entry.Model, entry.Effort
}

// This is the agent gate; callers check Config.allowsPermissionMode first.
// Missing AgentOptions imposes no restriction; a published list must include the mode.
func (r *AgentRegistry) PublishesMode(name, mode string) bool {
	entry, ok := r.Resolve(name)
	if !ok {
		return false
	}
	options, ok := entry.Agent.(AgentOptions)
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
func (r *AgentRegistry) UsageFor(name string) AgentUsage {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	if wanted == "" {
		entry, ok := r.Resolve("")
		if !ok {
			return nil
		}
		wanted = entry.Name
	}
	for _, entry := range r.Entries {
		if entry.Name == wanted && r.enabled(entry) {
			usage, _ := entry.Agent.(AgentUsage)
			return usage
		}
	}
	return nil
}

// Status remains readable when browser sign-in is disabled.
func (r *AgentRegistry) AuthFor(name string) AgentAuth {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == name && r.enabled(entry) {
				auth, _ := entry.Agent.(AgentAuth)
				return auth
			}
		}
	}
	return nil
}

// Enabled agents can be signed in during setup, before their CLI is detected.
func (r *AgentRegistry) ApiKeyLoginFor(name string) AgentAPIKeyLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.Entries {
		if entry.Name == wanted && r.enabled(entry) {
			login, _ := entry.Agent.(AgentAPIKeyLogin)
			return login
		}
	}
	return nil
}

// Like apiKeyLoginFor, allow setup only while the agent is enabled.
func (r *AgentRegistry) DeviceLoginFor(name string) AgentDeviceLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.Entries {
		if entry.Name == wanted && r.enabled(entry) {
			login, _ := entry.Agent.(AgentDeviceLogin)
			return login
		}
	}
	return nil
}

// Session branching determines whether a fork carries the session or only the transcript.
func (r *AgentRegistry) Branches(name string) bool {
	entry, ok := r.Resolve(name)
	if !ok {
		return false
	}
	branching, ok := entry.Agent.(AgentBranching)
	return ok && branching.BranchesSessions()
}

// Test seam; production never replaces registered drivers.
func (r *AgentRegistry) Set(name string, agent Agent) {
	if r == nil {
		return
	}
	for i := range r.Entries {
		if r.Entries[i].Name == name {
			r.Entries[i].Agent = agent
			// The stub replaces the CLI; do not require a real installation.
			r.Entries[i].Binary = ""
			return
		}
	}
}

func ModeUnsupportedMessage(label, mode string) string {
	return label + " does not offer the " + mode + " permission mode. " +
		"Choose one it offers, or start a conversation on an agent that has this one."
}
