package agents

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"strings"
	"time"
)

type AgentOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// agentOptionsDto is GET /hybridflow-runner/options (see PROTOCOL.md and agent-types.ts).
// Top-level lists mirror the default agent for older clients; agents holds per-agent choices.
// The spawning service owns these lists so UI offers match supported CLI options.
type AgentOptionsDto struct {
	Profiles         []PiProfileOffer   `json:"profiles,omitempty"`
	DefaultProfileID string             `json:"defaultProfileId,omitempty"`
	Capabilities     *AgentCapabilities `json:"capabilities,omitempty"`
	Models           []AgentOption      `json:"models"`
	Efforts          []AgentOption      `json:"efforts"`
	PermissionModes  []AgentOption      `json:"permissionModes"`
	// Defaults match conversation creation without explicit options; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// The handler always sends an array, including [] when no agent is offered.
	Agents []AgentOptionsEntry `json:"agents"`
	// DefaultAgent binds conversations created without an explicit agent.
	DefaultAgent string `json:"defaultAgent,omitempty"`
}

type AgentOptionsEntry struct {
	Profiles         []PiProfileOffer   `json:"profiles,omitempty"`
	DefaultProfileID string             `json:"defaultProfileId,omitempty"`
	Capabilities     *AgentCapabilities `json:"capabilities,omitempty"`
	Value            string             `json:"value"`
	Label            string             `json:"label"`
	Models           []AgentOption      `json:"models"`
	Efforts          []AgentOption      `json:"efforts"`
	PermissionModes  []AgentOption      `json:"permissionModes"`
	// Defaults match conversation creation and must be offered choices; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// Login is absent for agents the panel cannot sign in; otherwise it includes host fallback instructions.
	Login *agentLoginOffer `json:"login,omitempty"`
}

const DeviceLoginMethod = "device"

const ApiKeyLoginMethod = "api-key"

type agentLoginOffer struct {
	Methods     []string `json:"methods"`
	Enabled     bool     `json:"enabled"`
	HostCommand string   `json:"hostCommand,omitempty"`
}

// loginOfferFor prefers device login when both methods exist. Both share the deployment gate;
// Enabled and HostCommand come from the first method.
func LoginOfferFor(agent Agent) *agentLoginOffer {
	var offer *agentLoginOffer
	if device, ok := agent.(AgentDeviceLogin); ok {
		offer = &agentLoginOffer{
			Methods:     []string{DeviceLoginMethod},
			Enabled:     device.DeviceLoginEnabled(),
			HostCommand: device.DeviceLoginHostCommand(),
		}
	}
	if key, ok := agent.(AgentAPIKeyLogin); ok {
		if offer == nil {
			offer = &agentLoginOffer{
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
// AgentPermissionMode in reference/kiao-worker/src/agent-types.ts.
var ClaudeAllPermissionModes = []AgentOption{
	{Value: runnerconfig.PermissionModeManual, Label: "Manual"},
	{Value: runnerconfig.PermissionModeManualLive, Label: "Manual Live"},
	{Value: runnerconfig.PermissionModeBypass, Label: "Bypass permissions"},
}

// Filtering bypassPermissions here only controls the UI; accepting endpoints must enforce the gate.
// Filtering may leave an agent with no modes (see codexAllPermissionModes).
func PermissionModesFrom(offered []AgentOption, bypassEnabled bool) []AgentOption {
	if bypassEnabled {
		return offered
	}
	modes := make([]AgentOption, 0, len(offered))
	for _, mode := range offered {
		if mode.Value != runnerconfig.PermissionModeBypass {
			modes = append(modes, mode)
		}
	}
	return modes
}

// defaultEfforts is used when claude --help cannot run or yields no parseable choices.
var DefaultEfforts = []AgentOption{
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

func HasAgentOption(offered []AgentOption, value string) bool {
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
