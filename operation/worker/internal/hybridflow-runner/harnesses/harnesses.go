package harnesses

import (
	"os/exec"
	"strings"
)

const HarnessClaude = "claude"

const HarnessCodex = "codex"

const HarnessMuse = "muse"

const HarnessOpenCode = "opencode"

const HarnessPi = "pi"

type HarnessEntry struct {
	Name    string
	Label   string
	Harness Harness
	// Offer a harness only while its CLI is on PATH.
	Binary string
	// Environment policy is fixed at startup; CLI availability and the panel gate are dynamic.
	Allowed bool
	// Per-harness defaults; empty means use the CLI default. Muse resolves its catalogue on demand.
	Model  string
	Effort string
}

// HarnessGate is checked on each read so panel changes take effect without restart.
// A nil gate permits all harnesses.
type HarnessGate interface {
	HarnessOffered(name string) bool
}

// Keep all known harnesses, including unavailable ones, so existing conversations still render
// and newly installed CLIs become available. The first offered harness is the default.
type HarnessRegistry struct {
	Entries  []HarnessEntry
	Gate     HarnessGate
	Profiles ProfileManager
}

// Test seam for CLI availability; production never reassigns it.
var CLIOnPath = func(binary string) bool {
	_, err := exec.LookPath(binary)
	return err == nil
}

// Recheck CLI and panel availability on each call so install/uninstall changes take effect immediately.
func (r *HarnessRegistry) offers(entry HarnessEntry) bool {
	if !r.enabled(entry) {
		return false
	}
	if available, ok := entry.Harness.(interface{ Available() bool }); ok && !available.Available() {
		return false
	}
	// An empty binary uses driver availability, or denotes a test stub.
	if entry.Binary != "" && !CLIOnPath(entry.Binary) {
		return false
	}
	return true
}

// Every harness feature shares the deployment and configuration-panel switches.
// CLI detection stays separate so an enabled harness can be signed in during setup.
func (r *HarnessRegistry) enabled(entry HarnessEntry) bool {
	return entry.Allowed && (r.Gate == nil || r.Gate.HarnessOffered(entry.Name))
}

func (r *HarnessRegistry) IsEnabled(name string) bool {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == name {
				return r.enabled(entry)
			}
		}
	}
	return false
}

func (r *HarnessRegistry) Offered() []HarnessEntry {
	if r == nil {
		return nil
	}
	var offered []HarnessEntry
	for _, entry := range r.Entries {
		if r.offers(entry) {
			offered = append(offered, entry)
		}
	}
	return offered
}

// Fall back to Claude when none are offered, matching legacy conversation records.
func (r *HarnessRegistry) DefaultName() string {
	if offered := r.Offered(); len(offered) > 0 {
		return offered[0].Name
	}
	return HarnessClaude
}

// The hello payload may contain no harnesses when no CLI is available.
func (r *HarnessRegistry) Names() []string {
	offered := r.Offered()
	names := make([]string, 0, len(offered))
	for _, entry := range offered {
		names = append(names, entry.Name)
	}
	return names
}

// An empty name selects the default. Reject unavailable names rather than silently
// running a different harness.
func (r *HarnessRegistry) Resolve(name string) (HarnessEntry, bool) {
	offered := r.Offered()
	if len(offered) == 0 {
		return HarnessEntry{}, false
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
	return HarnessEntry{}, false
}

func (r *HarnessRegistry) Known(name string) bool {
	_, ok := r.Resolve(name)
	return ok
}

// Legacy cards name engines directly. Recognize known but unavailable engines so the
// runner reports harness unavailability rather than an unknown card value.
func (r *HarnessRegistry) Drives(name string) bool {
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

func (r *HarnessRegistry) Name(asked string) string {
	entry, ok := r.Resolve(asked)
	if !ok {
		return r.DefaultName()
	}
	return entry.Name
}

// Read all entries so unavailable harnesses retain their labels in existing conversations.
func (r *HarnessRegistry) Label(name string) string {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == strings.TrimSpace(name) {
				return entry.Label
			}
		}
	}
	return name
}

func (r *HarnessRegistry) DriverFor(name string) Harness {
	if entry, ok := r.Resolve(name); ok {
		return entry.Harness
	}
	return nil
}

// Muse catalogue ids are versioned, and the channel names its default with isDefault,
// so resolve its defaults on each call. Other harnesses use their entry defaults
// (empty delegates to the CLI).
func (r *HarnessRegistry) DefaultsFor(name string) (model, effort string) {
	entry, ok := r.Resolve(name)
	if !ok {
		return DefaultConversationModel, DefaultConversationEffort
	}
	if entry.Name == HarnessMuse {
		options, ok := entry.Harness.(HarnessOptions)
		if !ok {
			return "", ""
		}
		offered := options.Options()
		if defaulter, ok := entry.Harness.(interface{ DefaultModel() string }); ok {
			if model := defaulter.DefaultModel(); model != "" {
				return model, DefaultMuseEffort(offered.Efforts)
			}
		}
		return DefaultMuseModel(offered.Models), DefaultMuseEffort(offered.Efforts)
	}
	return entry.Model, entry.Effort
}

// This is the harness gate; callers check Config.allowsPermissionMode first.
// Missing HarnessOptions imposes no restriction; a published list must include the mode.
func (r *HarnessRegistry) PublishesMode(name, mode string) bool {
	entry, ok := r.Resolve(name)
	if !ok {
		return false
	}
	options, ok := entry.Harness.(HarnessOptions)
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

// A disabled harness must not be probed, including by a quota-blocked run.
func (r *HarnessRegistry) UsageFor(name string) HarnessUsage {
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
			usage, _ := entry.Harness.(HarnessUsage)
			return usage
		}
	}
	return nil
}

// Status remains readable when browser sign-in is disabled.
func (r *HarnessRegistry) AuthFor(name string) HarnessAuth {
	if r != nil {
		for _, entry := range r.Entries {
			if entry.Name == name && r.enabled(entry) {
				auth, _ := entry.Harness.(HarnessAuth)
				return auth
			}
		}
	}
	return nil
}

// Enabled harnesses can be signed in during setup, before their CLI is detected.
func (r *HarnessRegistry) ApiKeyLoginFor(name string) HarnessAPIKeyLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.Entries {
		if entry.Name == wanted && r.enabled(entry) {
			login, _ := entry.Harness.(HarnessAPIKeyLogin)
			return login
		}
	}
	return nil
}

// Like apiKeyLoginFor, allow setup only while the harness is enabled.
func (r *HarnessRegistry) DeviceLoginFor(name string) HarnessDeviceLogin {
	if r == nil {
		return nil
	}
	wanted := strings.TrimSpace(name)
	for _, entry := range r.Entries {
		if entry.Name == wanted && r.enabled(entry) {
			login, _ := entry.Harness.(HarnessDeviceLogin)
			return login
		}
	}
	return nil
}

// Session branching determines whether a fork carries the session or only the transcript.
func (r *HarnessRegistry) Branches(name string) bool {
	entry, ok := r.Resolve(name)
	if !ok {
		return false
	}
	branching, ok := entry.Harness.(HarnessBranching)
	return ok && branching.BranchesSessions()
}

// Test seam; production never replaces registered drivers.
func (r *HarnessRegistry) Set(name string, harness Harness) {
	if r == nil {
		return
	}
	for i := range r.Entries {
		if r.Entries[i].Name == name {
			r.Entries[i].Harness = harness
			// The stub replaces the CLI; do not require a real installation.
			r.Entries[i].Binary = ""
			return
		}
	}
}

func ModeUnsupportedMessage(label, mode string) string {
	return label + " does not offer the " + mode + " permission mode. " +
		"Choose one it offers, or start a conversation on a harness that has this one."
}
