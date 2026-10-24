package opencode

import (
	"context"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// opencode run has no approval channel: without --auto, permission requests are rejected.
// Offer bypass only; deployments that disable bypass cannot use this agent.
var opencodeAllPermissionModes = []agentapi.AgentOption{
	{Value: runnerconfig.PermissionModeBypass, Label: "Bypass permissions"},
}

// Efforts travel verbatim as --variant; models without variants ignore the flag.
var opencodeEfforts = []agentapi.AgentOption{
	{Value: "low", Label: "Low"},
	{Value: "medium", Label: "Medium"},
	{Value: "high", Label: "High"},
	{Value: "max", Label: "Max"},
}

// These supported provider/model IDs head the host catalogue and remain available
// when it cannot be read, including before provider keys are configured. Missing keys
// fail the turn explicitly rather than silently selecting another model.
var opencodeCuratedModels = []agentapi.AgentOption{
	{Value: "deepseek/deepseek-v4-pro", Label: "DeepSeek V4 Pro"},
	{Value: "mistral/mistral-large-4", Label: "Mistral Large 4"},
}

// OpenCodeOptionsService caches curated models plus the host's opencode models catalogue.
type OpenCodeOptionsService struct {
	mu       sync.Mutex
	cached   *agentapi.AgentOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// Fixed for the service lifetime, so the cache needs no bypass key.
	BypassEnabled bool
	Catalogue     func() ([]byte, error)
}

func NewOpenCodeOptionsService(cfg *runnerconfig.Config) *OpenCodeOptionsService {
	return &OpenCodeOptionsService{
		ttl:           agentapi.OptionsCacheTTL,
		BypassEnabled: cfg.BypassEnabled,
		Catalogue:     opencodeModels,
	}
}

// opencode models returns one provider/model ID per line.
func opencodeModels() ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, OpencodeBinaryName, "models").Output()
}

// Hold the lock across the probe so concurrent cache misses spawn it only once.
func (svc *OpenCodeOptionsService) Get() agentapi.AgentOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	opts := agentapi.AgentOptionsDto{
		Models:          svc.resolveModels(),
		Efforts:         opencodeEfforts,
		PermissionModes: agentapi.PermissionModesFrom(opencodeAllPermissionModes, svc.BypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

func (svc *OpenCodeOptionsService) resolveModels() []agentapi.AgentOption {
	models := append([]agentapi.AgentOption(nil), opencodeCuratedModels...)
	seen := map[string]bool{}
	for _, model := range models {
		seen[model.Value] = true
	}
	raw, err := svc.Catalogue()
	if err != nil {
		agentapi.LogClaudeWS.Warn("opencode models failed; the prompt offers the curated models alone", "error", err)
		return models
	}
	for _, line := range strings.Split(string(raw), "\n") {
		id := strings.TrimSpace(line)
		if id == "" || !strings.Contains(id, "/") || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, agentapi.AgentOption{Value: id, Label: id})
	}
	return models
}
