package hybridflowrunner

import (
	"context"
	"kiao/worker/internal/core"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

type agentOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// agentOptionsDto is GET /hybridflow-runner/options (see PROTOCOL.md and agent-types.ts).
// Top-level lists mirror the default agent for older clients; agents holds per-agent choices.
// The spawning service owns these lists so UI offers match supported CLI options.
type agentOptionsDto struct {
	Models          []agentOption `json:"models"`
	Efforts         []agentOption `json:"efforts"`
	PermissionModes []agentOption `json:"permissionModes"`
	// Defaults match conversation creation without explicit options; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// The handler always sends an array, including [] when no agent is offered.
	Agents []agentOptionsEntry `json:"agents"`
	// DefaultAgent binds conversations created without an explicit agent.
	DefaultAgent string `json:"defaultAgent,omitempty"`
}

type agentOptionsEntry struct {
	Value           string        `json:"value"`
	Label           string        `json:"label"`
	Models          []agentOption `json:"models"`
	Efforts         []agentOption `json:"efforts"`
	PermissionModes []agentOption `json:"permissionModes"`
	// Defaults match conversation creation and must be offered choices; absent means client fallback.
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultEffort string `json:"defaultEffort,omitempty"`
	// Login is absent for agents the panel cannot sign in; otherwise it includes host fallback instructions.
	Login *agentLoginOffer `json:"login,omitempty"`
}

// Clients ignore unknown sign-in methods.
const (
	deviceLoginMethod = "device"
	apiKeyLoginMethod = "api-key"
)

type agentLoginOffer struct {
	Methods     []string `json:"methods"`
	Enabled     bool     `json:"enabled"`
	HostCommand string   `json:"hostCommand,omitempty"`
}

// loginOfferFor prefers device login when both methods exist. Both share the deployment gate;
// Enabled and HostCommand come from the first method.
func loginOfferFor(agent Agent) *agentLoginOffer {
	var offer *agentLoginOffer
	if device, ok := agent.(AgentDeviceLogin); ok {
		offer = &agentLoginOffer{
			Methods:     []string{deviceLoginMethod},
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
		offer.Methods = append(offer.Methods, apiKeyLoginMethod)
	}
	return offer
}

// claudeModels uses stable CLI aliases: the CLI cannot enumerate concrete models offline.
var claudeModels = []agentOption{
	{Value: "opus", Label: "Opus"},
	{Value: "sonnet", Label: "Sonnet"},
	{Value: "haiku", Label: "Haiku"},
	{Value: "fable", Label: "Fable"},
}

// Offer only modes this service can drive over the socket, not every CLI permission mode.
// manualLive is service-defined. Keep aligned with claudeArgs in driver_claude.go and
// AgentPermissionMode in reference/npm/kiao-worker/src/agent-types.ts.
var claudeAllPermissionModes = []agentOption{
	{Value: permissionModeManual, Label: "Manual"},
	{Value: permissionModeManualLive, Label: "Manual Live"},
	{Value: permissionModeBypass, Label: "Bypass permissions"},
}

// Filtering bypassPermissions here only controls the UI; accepting endpoints must enforce the gate.
// Filtering may leave an agent with no modes (see codexAllPermissionModes).
func permissionModesFrom(offered []agentOption, bypassEnabled bool) []agentOption {
	if bypassEnabled {
		return offered
	}
	modes := make([]agentOption, 0, len(offered))
	for _, mode := range offered {
		if mode.Value != permissionModeBypass {
			modes = append(modes, mode)
		}
	}
	return modes
}

// defaultEfforts is used when claude --help cannot run or yields no parseable choices.
var defaultEfforts = []agentOption{
	{Value: "low", Label: "Low"},
	{Value: "medium", Label: "Medium"},
	{Value: "high", Label: "High"},
	{Value: "xhigh", Label: "X-High"},
	{Value: "max", Label: "Max"},
}

// Help wraps to terminal width, including without a TTY; parse continuations as well as the option line.
var (
	effortOptionRe = regexp.MustCompile(`^\s*--effort\b`)
	choiceGroupRe  = regexp.MustCompile(`\(([^)]*)\)`)
	// Require bare values to reject descriptive parentheses such as "(only works with --print)".
	choiceTokenRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)
)

// ClaudeOptionsService caches model/effort options; efforts come from the installed CLI help.
type ClaudeOptionsService struct {
	mu       sync.Mutex
	cached   *agentOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// Immutable for this service lifetime, so the cache needs no bypass-mode key.
	bypassEnabled bool
	help          func() (string, error)
}

const optionsCacheTTL = 10 * time.Minute

func newClaudeOptionsService(cfg *Config) *ClaudeOptionsService {
	return &ClaudeOptionsService{ttl: optionsCacheTTL, bypassEnabled: cfg.BypassEnabled, help: claudeHelp}
}

func claudeHelp() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "claude", "--help").Output()
	return string(out), err
}

// Hold the lock across help resolution so concurrent cache misses spawn the CLI only once.
func (svc *ClaudeOptionsService) get() agentOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	opts := agentOptionsDto{
		Models:          claudeModels,
		Efforts:         svc.resolveEfforts(),
		PermissionModes: permissionModesFrom(claudeAllPermissionModes, svc.bypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

func (svc *ClaudeOptionsService) resolveEfforts() []agentOption {
	help, err := svc.help()
	if err != nil {
		logClaudeWS.Warn("claude --help failed; using default efforts", "error", err)
		return defaultEfforts
	}
	if efforts := parseEffortChoices(help); len(efforts) > 0 {
		return efforts
	}
	logClaudeWS.Warn("could not parse effort choices from claude --help; using defaults")
	return defaultEfforts
}

func parseEffortChoices(help string) []agentOption {
	for _, group := range choiceGroupRe.FindAllStringSubmatch(effortHelpEntry(help), -1) {
		if opts := choicesFromGroup(group[1]); opts != nil {
			return opts
		}
	}
	return nil
}

// effortHelpEntry joins deeper-indented continuations, even those starting with a flag.
func effortHelpEntry(help string) string {
	lines := strings.Split(help, "\n")
	for i, line := range lines {
		if !effortOptionRe.MatchString(line) {
			continue
		}
		entry := []string{strings.TrimSpace(line)}
		for _, next := range lines[i+1:] {
			if strings.TrimSpace(next) == "" || indentOf(next) <= indentOf(line) {
				break
			}
			entry = append(entry, strings.TrimSpace(next))
		}
		return strings.Join(entry, " ")
	}
	return ""
}

// choicesFromGroup rejects prose rather than treating it as a list of values.
func choicesFromGroup(group string) []agentOption {
	parts := strings.Split(group, ",")
	if len(parts) < 2 {
		return nil
	}
	out := make([]agentOption, 0, len(parts))
	for _, raw := range parts {
		value := strings.TrimSpace(raw)
		if !choiceTokenRe.MatchString(value) {
			return nil
		}
		out = append(out, agentOption{Value: value, Label: effortLabel(value)})
	}
	return out
}

func indentOf(s string) int {
	return len(s) - len(strings.TrimLeft(s, " \t"))
}

// Unlisted efforts use title case, allowing new CLI effort levels without a code change.
var effortLabels = map[string]string{"xhigh": "X-High"}

func effortLabel(value string) string {
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

// HandleOptions serves GET /hybridflow-runner/options.
// Offered agents without AgentOptions remain listed with empty choices for client fallback.
// Unavailable or disabled agents are omitted; a host may offer no agents.
func (s *Service) HandleOptions(w http.ResponseWriter, _ *http.Request) {
	payload := agentOptionsDto{DefaultAgent: s.agents.defaultName(), Agents: []agentOptionsEntry{}}
	for _, entry := range s.agents.offered() {
		offered := agentOptionsEntry{Value: entry.name, Label: entry.label}
		if options, ok := entry.agent.(AgentOptions); ok {
			own := options.Options()
			offered.Models, offered.Efforts, offered.PermissionModes =
				own.Models, own.Efforts, own.PermissionModes
		}
		offered.Login = loginOfferFor(entry.agent)
		// Advertise defaults only when present in the offered lists; otherwise let the client fall back.
		if model, effort := s.agents.defaultsFor(entry.name); model != "" || effort != "" {
			if hasAgentOption(offered.Models, model) {
				offered.DefaultModel = model
			}
			if hasAgentOption(offered.Efforts, effort) {
				offered.DefaultEffort = effort
			}
		}
		if entry.name == payload.DefaultAgent {
			payload.Models, payload.Efforts, payload.PermissionModes =
				offered.Models, offered.Efforts, offered.PermissionModes
			payload.DefaultModel, payload.DefaultEffort = offered.DefaultModel, offered.DefaultEffort
		}
		payload.Agents = append(payload.Agents, offered)
	}
	core.WriteJSON(w, http.StatusOK, payload)
}

func hasAgentOption(offered []agentOption, value string) bool {
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
