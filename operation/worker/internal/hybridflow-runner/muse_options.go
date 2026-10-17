package hybridflowrunner

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Manual and Manual Live relay MSP approvals and questions as Claude does.
// Bypass is offered only when enabled by configuration.
var museAllPermissionModes = []agentOption{
	{Value: permissionModeManual, Label: "Manual"},
	{Value: permissionModeManualLive, Label: "Manual Live"},
	{Value: permissionModeBypass, Label: "Bypass permissions"},
}

// MSP ReasoningEffort tiers, lowest first. `none` is controlled by the Thinking switch.
var museEfforts = []agentOption{
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
	cached   *agentOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// Immutable configuration; the cache needs no bypass key.
	bypassEnabled bool
	// Catalogue override for tests; nil queries the installed CLI.
	catalogue func() ([]byte, error)
	binary    string
}

func newMuseOptionsService(cfg *Config) *MuseOptionsService {
	return &MuseOptionsService{
		ttl:           optionsCacheTTL,
		bypassEnabled: cfg.BypassEnabled,
		binary:        museBinaryName,
		catalogue:     nil,
	}
}

// museModels queries a short-lived host, then kills it. `model/list` consumes no tokens.
func museModels(binary string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// No turn trace for a catalogue probe; stderr is discarded.
	conn, err := spawnMSP(ctx, binary, museServeArgs(), "", nil, nil)
	if err != nil {
		return nil, err
	}
	defer conn.close()
	return conn.call("model/list", map[string]any{})
}

// Hold the lock across the probe so concurrent cache misses spawn only one host.
func (svc *MuseOptionsService) get() agentOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	opts := agentOptionsDto{
		Models:          svc.resolveModels(),
		Efforts:         museEfforts,
		PermissionModes: permissionModesFrom(museAllPermissionModes, svc.bypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

// Do not guess fallback model IDs: availability depends on the account catalogue.
// An empty list lets turns use the host default.
func (svc *MuseOptionsService) resolveModels() []agentOption {
	probe := svc.catalogue
	if probe == nil {
		binary := svc.binary
		probe = func() ([]byte, error) { return museModels(binary) }
	}
	raw, err := probe()
	if err != nil {
		logClaudeWS.Warn("muse model/list failed; the prompt offers no Muse model", "error", err)
		return nil
	}
	var catalogue museModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		logClaudeWS.Warn("could not read the Muse model catalogue", "error", err)
		return nil
	}
	var models []agentOption
	for _, model := range catalogue.Models {
		id := strings.TrimSpace(model.ModelID)
		if id == "" {
			continue
		}
		models = append(models, agentOption{Value: id, Label: orDefault(model.DisplayLabel, id)})
	}
	return withContributorTwins(models)
}

// withContributorTwins adds hidden contributor builds accepted by the CLI but omitted
// from `model/list`. Already-listed twins are preserved without duplication; hidden labels are IDs.
func withContributorTwins(models []agentOption) []agentOption {
	listed := make(map[string]bool, len(models))
	for _, model := range models {
		listed[model.Value] = true
	}
	var out []agentOption
	for _, model := range models {
		out = append(out, model)
		matched := museModelRe.FindStringSubmatch(model.Value)
		if matched == nil || matched[3] != "" {
			continue
		}
		if twin := model.Value + "-contributor"; !listed[twin] {
			listed[twin] = true
			out = append(out, agentOption{Value: twin, Label: twin})
		}
	}
	return out
}

// Muse IDs may have a provider prefix and contributor suffix. Spark and Wonder are the
// families the channel has published; there is no latest alias, so compare captured
// versions to choose the default.
var museModelRe = regexp.MustCompile(`^(?:[^/]+/)?muse-(spark|wonder)-(\d+(?:\.\d+)*)(-contributor)?$`)

// Kept for callers that named the Spark-only spelling; it matches what museModelRe does.
var sparkModelRe = museModelRe

// defaultMuseModel prefers the newest contributor build, then the newest Muse model.
// Empty delegates to the caller's first option or the host default.
func defaultMuseModel(models []agentOption) string {
	if newest := newestMuseModel(models, true); newest != "" {
		return newest
	}
	return newestMuseModel(models, false)
}

// defaultMuseModelWithDefault prefers the catalogue's isDefault row (and its contributor
// twin where offered), falling back to the newest contributor and then the newest model.
// Empty delegates to the caller's first option or the host default.
func defaultMuseModelWithDefault(models []agentOption, defaultID string) string {
	if id := strings.TrimSpace(defaultID); id != "" {
		listed := make(map[string]bool, len(models))
		for _, model := range models {
			listed[model.Value] = true
		}
		if twin := id + "-contributor"; listed[twin] {
			return twin
		}
		if listed[id] {
			return id
		}
		// The default may carry a provider prefix the offered list omits, or vice versa:
		// match on the bare model ID before falling back to the newest.
		if bare := museBareID(id); bare != "" {
			if twin := bare + "-contributor"; listed[twin] {
				return twin
			}
			if listed[bare] {
				return bare
			}
			for _, model := range models {
				if museBareID(model.Value) == bare {
					// Prefer the contributor build where the catalogue names the plain ID.
					if twin := model.Value + "-contributor"; listed[twin] {
						return twin
					}
					return model.Value
				}
			}
		}
	}
	return defaultMuseModel(models)
}

// museBareID strips a provider prefix (meta/muse-spark-1.3 -> muse-spark-1.3).
// Empty where the ID is not a Muse model.
func museBareID(id string) string {
	matched := museModelRe.FindStringSubmatch(strings.TrimSpace(id))
	if matched == nil {
		return ""
	}
	bare := "muse-" + matched[1] + "-" + matched[2]
	if matched[3] != "" {
		bare += matched[3]
	}
	return bare
}

// Equal versions retain catalogue order.
func newestMuseModel(models []agentOption, contributorOnly bool) string {
	newest := ""
	for _, model := range models {
		matched := museModelRe.FindStringSubmatch(model.Value)
		if matched == nil {
			continue
		}
		if contributorOnly && matched[3] == "" {
			continue
		}
		if newest == "" || compareMuseVersions(matched[2], museVersionOf(newest)) > 0 {
			newest = model.Value
		}
	}
	return newest
}

// Kept for callers that named the Spark-only spelling.
func newestSparkModel(models []agentOption, contributorOnly bool) string {
	return newestMuseModel(models, contributorOnly)
}

// The caller must supply an ID matched by museModelRe.
func museVersionOf(id string) string {
	return museModelRe.FindStringSubmatch(id)[2]
}

// Kept for callers that named the Spark-only spelling.
func sparkVersionOf(id string) string {
	matched := museModelRe.FindStringSubmatch(id)
	if matched == nil {
		return ""
	}
	return matched[2]
}

func compareMuseVersions(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			vb, _ = strconv.Atoi(pb[i])
		}
		if va != vb {
			if va < vb {
				return -1
			}
			return 1
		}
	}
	return 0
}

// Kept for callers that named the Spark-only spelling.
func compareSparkVersions(a, b string) int {
	return compareMuseVersions(a, b)
}

// defaultModel prefers the catalogue's isDefault row where the channel names one,
// falling back to the newest contributor and then the newest model. It reads the
// catalogue fresh rather than trusting the cached options, so a stale cache cannot
// pin the default to a model the account no longer carries.
func (svc *MuseOptionsService) defaultModel() string {
	probe := svc.catalogue
	if probe == nil {
		binary := svc.binary
		probe = func() ([]byte, error) { return museModels(binary) }
	}
	raw, err := probe()
	if err != nil {
		return defaultMuseModel(svc.get().Models)
	}
	var catalogue museModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		return defaultMuseModel(svc.get().Models)
	}
	offered := svc.get().Models
	for _, model := range catalogue.Models {
		if model.IsDefault {
			if id := strings.TrimSpace(model.ModelID); id != "" {
				return defaultMuseModelWithDefault(offered, id)
			}
		}
	}
	return defaultMuseModel(offered)
}

func defaultMuseEffort(efforts []agentOption) string {
	for _, effort := range efforts {
		if effort.Value == "max" {
			return "max"
		}
	}
	return ""
}
