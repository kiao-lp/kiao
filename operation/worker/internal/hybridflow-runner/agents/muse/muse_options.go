package muse

import (
	"context"
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"strings"
	"sync"
	"time"
)

// Manual and Manual Live relay MSP approvals and questions as Claude does.
// Bypass is offered only when enabled by configuration.
var museAllPermissionModes = []agentapi.AgentOption{
	{Value: runnerconfig.PermissionModeManual, Label: "Manual"},
	{Value: runnerconfig.PermissionModeManualLive, Label: "Manual Live"},
	{Value: runnerconfig.PermissionModeBypass, Label: "Bypass permissions"},
}

// MSP ReasoningEffort tiers, lowest first. `none` is controlled by the Thinking switch.
var MuseEfforts = []agentapi.AgentOption{
	{Value: "minimal", Label: "Minimal"},
	{Value: "low", Label: "Low"},
	{Value: "medium", Label: "Medium"},
	{Value: "high", Label: "High"},
	{Value: "xhigh", Label: "X-High"},
	{Value: "max", Label: "Max"},
	{Value: "ultra", Label: "Ultra"},
}

type museModelCatalogue struct {
	Models []struct {
		ModelID      string `json:"modelId"`
		DisplayLabel string `json:"displayLabel"`
		IsDefault    bool   `json:"isDefault"`
	} `json:"models"`
}

// MuseOptionsService caches the installed CLI's model catalogue and prompt options.
type MuseOptionsService struct {
	mu       sync.Mutex
	cached   *agentapi.AgentOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// Immutable configuration; the cache needs no bypass key.
	BypassEnabled bool
	// Catalogue override for tests; nil queries the installed CLI.
	Catalogue func() ([]byte, error)
	Binary    string
}

func NewMuseOptionsService(cfg *runnerconfig.Config) *MuseOptionsService {
	return &MuseOptionsService{
		ttl:           agentapi.OptionsCacheTTL,
		BypassEnabled: cfg.BypassEnabled,
		Binary:        MuseBinaryName,
		Catalogue:     nil,
	}
}

// museModels queries a short-lived host, then kills it. `model/list` consumes no tokens.
func museModels(binary string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// No turn trace for a catalogue probe; stderr is discarded.
	conn, err := SpawnMSP(ctx, binary, MuseServeArgs(), "", nil, nil)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return conn.Call("model/list", map[string]any{})
}

// Hold the lock across the probe so concurrent cache misses spawn only one host.
func (svc *MuseOptionsService) Get() agentapi.AgentOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	opts := agentapi.AgentOptionsDto{
		Models:          svc.resolveModels(),
		Efforts:         MuseEfforts,
		PermissionModes: agentapi.PermissionModesFrom(museAllPermissionModes, svc.BypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

// Do not guess fallback model IDs: availability depends on the account catalogue.
// An empty list lets turns use the host default.
func (svc *MuseOptionsService) resolveModels() []agentapi.AgentOption {
	probe := svc.Catalogue
	if probe == nil {
		binary := svc.Binary
		probe = func() ([]byte, error) { return museModels(binary) }
	}
	raw, err := probe()
	if err != nil {
		agentapi.LogClaudeWS.Warn("muse model/list failed; the prompt offers no Muse model", "error", err)
		return nil
	}
	var catalogue museModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		agentapi.LogClaudeWS.Warn("could not read the Muse model catalogue", "error", err)
		return nil
	}
	var models []agentapi.AgentOption
	for _, model := range catalogue.Models {
		id := strings.TrimSpace(model.ModelID)
		if id == "" {
			continue
		}
		models = append(models, agentapi.AgentOption{Value: id, Label: pkgProtocol.OrDefault(model.DisplayLabel, id)})
	}
	return withContributorTwins(models)
}

// withContributorTwins adds hidden contributor builds accepted by the CLI but omitted
// from `model/list`. Already-listed twins are preserved without duplication; hidden labels are IDs.
func withContributorTwins(models []agentapi.AgentOption) []agentapi.AgentOption {
	listed := make(map[string]bool, len(models))
	for _, model := range models {
		listed[model.Value] = true
	}
	var out []agentapi.AgentOption
	for _, model := range models {
		out = append(out, model)
		matched := agentapi.MuseModelRe.FindStringSubmatch(model.Value)
		if matched == nil || matched[3] != "" {
			continue
		}
		if twin := model.Value + "-contributor"; !listed[twin] {
			listed[twin] = true
			out = append(out, agentapi.AgentOption{Value: twin, Label: twin})
		}
	}
	return out
}

// Kept for callers that named the Spark-only spelling.
func newestSparkModel(models []agentapi.AgentOption, contributorOnly bool) string {
	return agentapi.NewestMuseModel(models, contributorOnly)
}

// Kept for callers that named the Spark-only spelling.
func sparkVersionOf(id string) string {
	matched := agentapi.MuseModelRe.FindStringSubmatch(id)
	if matched == nil {
		return ""
	}
	return matched[2]
}

// Kept for callers that named the Spark-only spelling.
func compareSparkVersions(a, b string) int {
	return agentapi.CompareMuseVersions(a, b)
}

// defaultModel prefers the catalogue's isDefault row where the channel names one,
// falling back to the newest contributor and then the newest model. It reads the
// catalogue fresh rather than trusting the cached options, so a stale cache cannot
// pin the default to a model the account no longer carries.
func (svc *MuseOptionsService) DefaultModel() string {
	probe := svc.Catalogue
	if probe == nil {
		binary := svc.Binary
		probe = func() ([]byte, error) { return museModels(binary) }
	}
	raw, err := probe()
	if err != nil {
		return agentapi.DefaultMuseModel(svc.Get().Models)
	}
	var catalogue museModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		return agentapi.DefaultMuseModel(svc.Get().Models)
	}
	offered := svc.Get().Models
	for _, model := range catalogue.Models {
		if model.IsDefault {
			if id := strings.TrimSpace(model.ModelID); id != "" {
				return agentapi.DefaultMuseModelWithDefault(offered, id)
			}
		}
	}
	return agentapi.DefaultMuseModel(offered)
}
