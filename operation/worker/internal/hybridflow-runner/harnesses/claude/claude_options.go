package claude

import (
	"context"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// claudeModels uses stable CLI aliases: the CLI cannot enumerate concrete models offline.
var claudeModels = []harnessapi.HarnessOption{
	{Value: "opus", Label: "Opus"},
	{Value: "sonnet", Label: "Sonnet"},
	{Value: "haiku", Label: "Haiku"},
	{Value: "fable", Label: "Fable"},
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
	cached   *harnessapi.HarnessOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// Immutable for this service lifetime, so the cache needs no bypass-mode key.
	BypassEnabled bool
	Help          func() (string, error)
}

func NewClaudeOptionsService(cfg *runnerconfig.Config) *ClaudeOptionsService {
	return &ClaudeOptionsService{ttl: harnessapi.OptionsCacheTTL, BypassEnabled: cfg.BypassEnabled, Help: claudeHelp}
}

func claudeHelp() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "claude", "--help").Output()
	return string(out), err
}

// Hold the lock across help resolution so concurrent cache misses spawn the CLI only once.
func (svc *ClaudeOptionsService) Get() harnessapi.HarnessOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	opts := harnessapi.HarnessOptionsDto{
		Models:          claudeModels,
		Efforts:         svc.ResolveEfforts(),
		PermissionModes: harnessapi.PermissionModesFrom(harnessapi.ClaudeAllPermissionModes, svc.BypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

func (svc *ClaudeOptionsService) ResolveEfforts() []harnessapi.HarnessOption {
	help, err := svc.Help()
	if err != nil {
		harnessapi.LogClaudeWS.Warn("claude --help failed; using default efforts", "error", err)
		return harnessapi.DefaultEfforts
	}
	if efforts := ParseEffortChoices(help); len(efforts) > 0 {
		return efforts
	}
	harnessapi.LogClaudeWS.Warn("could not parse effort choices from claude --help; using defaults")
	return harnessapi.DefaultEfforts
}

func ParseEffortChoices(help string) []harnessapi.HarnessOption {
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
func choicesFromGroup(group string) []harnessapi.HarnessOption {
	parts := strings.Split(group, ",")
	if len(parts) < 2 {
		return nil
	}
	out := make([]harnessapi.HarnessOption, 0, len(parts))
	for _, raw := range parts {
		value := strings.TrimSpace(raw)
		if !choiceTokenRe.MatchString(value) {
			return nil
		}
		out = append(out, harnessapi.HarnessOption{Value: value, Label: harnessapi.EffortLabel(value)})
	}
	return out
}

func indentOf(s string) int {
	return len(s) - len(strings.TrimLeft(s, " \t"))
}
