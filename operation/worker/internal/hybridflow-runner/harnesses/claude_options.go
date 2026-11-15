package harnesses

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"strings"
	"time"
)

type HarnessOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// harnessOptionsDto is GET /hybridflow-runner/options (see PROTOCOL.md and harness-types.ts).
// Top-level lists mirror the default harness for older clients; harnesses holds per-harness choices.
// The spawning service owns these lists so UI offers match supported CLI options.
type HarnessOptionsDto struct {
	Profiles         []PiProfileOffer     `json:"profiles,omitempty"`
	DefaultProfileID string               `json:"defaultProfileId,omitempty"`
	Capabilities     *HarnessCapabilities `json:"capabilities,omitempty"`
	Models           []HarnessOption      `json:"models"`
	Efforts          []HarnessOption      `json:"efforts"`
	PermissionModes  []HarnessOption      `json:"permissionModes"`
	// Defaults match conversation creation without explicit options; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// The handler always sends an array, including [] when no harness is offered.
	Harnesses []HarnessOptionsEntry `json:"harnesses"`
	// DefaultHarness binds conversations created without an explicit harness.
	DefaultHarness string `json:"defaultHarness,omitempty"`
}

type HarnessOptionsEntry struct {
	Profiles         []PiProfileOffer     `json:"profiles,omitempty"`
	DefaultProfileID string               `json:"defaultProfileId,omitempty"`
	Capabilities     *HarnessCapabilities `json:"capabilities,omitempty"`
	Value            string               `json:"value"`
	Label            string               `json:"label"`
	Models           []HarnessOption      `json:"models"`
	Efforts          []HarnessOption      `json:"efforts"`
	PermissionModes  []HarnessOption      `json:"permissionModes"`
	// Defaults match conversation creation and must be offered choices; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// Login is absent for harnesses the panel cannot sign in; otherwise it includes host fallback instructions.
	Login *harnessLoginOffer `json:"login,omitempty"`
}

const DeviceLoginMethod = "device"

const ApiKeyLoginMethod = "api-key"

type harnessLoginOffer struct {
	Methods     []string `json:"methods"`
	Enabled     bool     `json:"enabled"`
	HostCommand string   `json:"hostCommand,omitempty"`
}

// loginOfferFor prefers device login when both methods exist. Both share the deployment gate;
// Enabled and HostCommand come from the first method.
func LoginOfferFor(harness Harness) *harnessLoginOffer {
	var offer *harnessLoginOffer
	if device, ok := harness.(HarnessDeviceLogin); ok {
		offer = &harnessLoginOffer{
			Methods:     []string{DeviceLoginMethod},
			Enabled:     device.DeviceLoginEnabled(),
			HostCommand: device.DeviceLoginHostCommand(),
		}
	}
	if key, ok := harness.(HarnessAPIKeyLogin); ok {
		if offer == nil {
			offer = &harnessLoginOffer{
				Enabled:     key.APIKeyLoginEnabled(),
				HostCommand: key.APIKeyHostCommand(),
			}
		}
		offer.Methods = append(offer.Methods, ApiKeyLoginMethod)
	}
	return offer
}

// Offer only modes this service can drive over the socket, not every CLI permission mode.
// manualLive is service-defined. Keep aligned with claudeArgs in driver_claude.go and
// HarnessPermissionMode in reference/kiao-worker/src/harness-types.ts.
var ClaudeAllPermissionModes = []HarnessOption{
	{Value: runnerconfig.PermissionModeManual, Label: "Manual"},
	{Value: runnerconfig.PermissionModeManualLive, Label: "Manual Live"},
	{Value: runnerconfig.PermissionModeBypass, Label: "Bypass permissions"},
}

// Filtering bypassPermissions here only controls the UI; accepting endpoints must enforce the gate.
// Filtering may leave a harness with no modes (see codexAllPermissionModes).
func PermissionModesFrom(offered []HarnessOption, bypassEnabled bool) []HarnessOption {
	if bypassEnabled {
		return offered
	}
	modes := make([]HarnessOption, 0, len(offered))
	for _, mode := range offered {
		if mode.Value != runnerconfig.PermissionModeBypass {
			modes = append(modes, mode)
		}
	}
	return modes
}

// defaultEfforts is used when claude --help cannot run or yields no parseable choices.
var DefaultEfforts = []HarnessOption{
	{Value: "low", Label: "Low"},
	{Value: "medium", Label: "Medium"},
	{Value: "high", Label: "High"},
	{Value: "xhigh", Label: "X-High"},
	{Value: "max", Label: "Max"},
}

const OptionsCacheTTL = 10 * time.Minute

// Unlisted efforts use title case, allowing new CLI effort levels without a code change.
var effortLabels = map[string]string{"xhigh": "X-High"}

func EffortLabel(value string) string {
	if label, ok := effortLabels[value]; ok {
		return label
	}
	return titleCase(value)
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func HasHarnessOption(offered []HarnessOption, value string) bool {
	if value == "" {
		return false
	}
	for _, option := range offered {
		if option.Value == value {
			return true
		}
	}
	return false
}
