package hybridflowrunner

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// The choices the prompt offers for a Codex conversation: which models, which reasoning efforts, and
// which permission modes.
//
// The shape is the Claude one (claude_options.go) and deliberately so — the panel these fill is the
// same panel, and an agent that answered in a shape of its own would be asking the client to grow a
// second renderer for the same three dropdowns. What differs is where the values come from and, in
// the case of the modes, how few of them there are.

// codexAllPermissionModes is the whole of what this driver offers: one mode, and the unsupervised
// one at that.
//
// `codex exec` has no approval channel. It never asks — there is no control protocol to ask on and
// no flag that would open one — and what stands in for the human is the sandbox
// (`--sandbox read-only | workspace-write | danger-full-access`). A sandbox is a different promise
// from a permission prompt: it bounds what a turn can reach, it does not put a decision to anybody.
// So `manual` and `manualLive` are not offered rather than being offered and quietly meaning
// something else, because a mode named Manual that asked nothing would be a lie told in a dropdown.
//
// The consequence is worth stating plainly: a deployment with bypass switched off publishes *no*
// mode for this agent, and every attempt to use it is refused. That is the honest outcome — an
// agent that can only run unsupervised has nothing to offer a deployment that forbids it.
var codexAllPermissionModes = []agentOption{
	{Value: permissionModeBypass, Label: "Bypass permissions"},
}

// codexEffortOrder is the order the reasoning levels are offered in, lowest first. It is a display
// order and nothing more: what a given model actually accepts comes from the catalogue, and a level
// this list has never heard of is kept and shown last rather than dropped, so a CLI upgrade that
// adds one reaches the prompt without a code change.
var codexEffortOrder = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"}

// codexModelCatalogue is the shape this service reads out of `codex debug models`. The command
// renders the whole catalogue, base instructions and all; everything not named here is ignored.
type codexModelCatalogue struct {
	Models []struct {
		Slug        string `json:"slug"`
		DisplayName string `json:"display_name"`
		// Visibility is `list` for a model the CLI offers in its own picker. Anything else is a model
		// the catalogue carries for its own reasons — a deprecated slug, an internal one — and is not
		// something to put in front of a user.
		Visibility string `json:"visibility"`
		// Service tiers are model-specific and account-specific. Keep the CLI's ids rather than
		// guessing which models or plans have Fast or Ultrafast access.
		ServiceTiers []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"service_tiers"`
		// Older catalogues advertised only speed aliases, before service_tiers named request ids.
		AdditionalSpeedTiers []string `json:"additional_speed_tiers"`
		// SupportedReasoningLevels is what this model accepts for `model_reasoning_effort`. It is per
		// model in the catalogue and one list in the prompt, so the union is what is offered.
		SupportedReasoningLevels []struct {
			Effort string `json:"effort"`
		} `json:"supported_reasoning_levels"`
	} `json:"models"`
}

// CodexOptionsService resolves what the prompt offers for Codex. The catalogue is read from the
// installed CLI so that the offered models are the ones this host can actually run — the same
// reasoning that has the Claude service parse `claude --help` for its effort levels — and cached,
// because a catalogue only changes on a CLI upgrade or a re-login.
type CodexOptionsService struct {
	mu       sync.Mutex
	cached   *agentOptionsDto
	cachedAt time.Time
	ttl      time.Duration
	// bypassEnabled is Config.BypassEnabled. It cannot change while the service runs, so the
	// cache needs no key for it.
	bypassEnabled bool
	// catalogue runs `codex debug models` and returns its stdout; a field so tests can substitute it.
	catalogue func() ([]byte, error)
}

func newCodexOptionsService(cfg *Config) *CodexOptionsService {
	return &CodexOptionsService{
		ttl:           optionsCacheTTL,
		bypassEnabled: cfg.BypassEnabled,
		catalogue:     codexModels,
	}
}

// codexModels runs `codex debug models` and returns its stdout. The timeout is longer than the
// Claude help probe's because the catalogue can be fetched rather than read.
func codexModels() ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, codexBinaryName, "debug", "models").Output()
}

// get returns the cached options when fresh, otherwise re-resolves them. The lock is held across the
// (rare, cache-miss) probe so a burst of first-load requests spawns it once.
func (svc *CodexOptionsService) get() agentOptionsDto {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && time.Since(svc.cachedAt) < svc.ttl {
		return *svc.cached
	}
	models, efforts := svc.resolveCatalogue()
	opts := agentOptionsDto{
		Models:          models,
		Efforts:         efforts,
		PermissionModes: permissionModesFrom(codexAllPermissionModes, svc.bypassEnabled),
	}
	svc.cached = &opts
	svc.cachedAt = time.Now()
	return opts
}

// resolveCatalogue reads the models and the effort levels out of the installed CLI.
//
// A catalogue that cannot be read leaves **both lists empty**, and that is the deliberate answer
// rather than a guess. There is no equivalent of the Claude aliases here — `opus` and `sonnet` are
// stable names by design, where a Codex slug is whatever the account's catalogue happens to carry —
// so a curated fallback would be a list of models this host may well not have. An empty list says
// "ask the CLI, this service could not"; a wrong one sends the user's next turn to a model that does
// not exist.
func (svc *CodexOptionsService) resolveCatalogue() (models, efforts []agentOption) {
	raw, err := svc.catalogue()
	if err != nil {
		logClaudeWS.Warn("codex debug models failed; the prompt offers no Codex model", "error", err)
		return nil, nil
	}
	var catalogue codexModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		logClaudeWS.Warn("could not read the Codex model catalogue", "error", err)
		return nil, nil
	}

	seenEffort := map[string]bool{}
	var offered []string
	for _, model := range catalogue.Models {
		slug := strings.TrimSpace(model.Slug)
		if slug == "" || model.Visibility != "list" {
			continue
		}
		label := orDefault(model.DisplayName, slug)
		models = append(models, agentOption{Value: slug, Label: label})
		seenTier := map[string]bool{}
		addTier := func(id, name string) {
			id = strings.TrimSpace(id)
			if id == "" || seenTier[id] {
				return
			}
			seenTier[id] = true
			models = append(models, agentOption{Value: slug + "@" + id, Label: label + " · " + name})
		}
		if len(model.ServiceTiers) > 0 {
			for _, tier := range model.ServiceTiers {
				addTier(tier.ID, orDefault(tier.Name, tier.ID))
			}
		} else {
			for _, tier := range model.AdditionalSpeedTiers {
				addTier(tier, effortLabel(tier))
			}
		}
		if len(seenTier) > 0 && !seenTier["default"] {
			// A plain slug retains the host's configured speed. Offer an explicit Standard choice
			// too, so a user can return from Fast even when the host defaults to it.
			addTier("default", "Standard")
		}
		for _, level := range model.SupportedReasoningLevels {
			effort := strings.TrimSpace(level.Effort)
			if effort == "" || seenEffort[effort] {
				continue
			}
			seenEffort[effort] = true
			offered = append(offered, effort)
		}
	}
	return models, codexEfforts(offered)
}

// codexEfforts puts the levels the catalogue offered into display order: the ones this service knows
// the place of first, then anything it does not, in the order the catalogue named them.
func codexEfforts(offered []string) []agentOption {
	if len(offered) == 0 {
		return nil
	}
	has := map[string]bool{}
	for _, effort := range offered {
		has[effort] = true
	}
	efforts := make([]agentOption, 0, len(offered))
	for _, effort := range codexEffortOrder {
		if has[effort] {
			delete(has, effort)
			efforts = append(efforts, agentOption{Value: effort, Label: effortLabel(effort)})
		}
	}
	for _, effort := range offered {
		if has[effort] {
			delete(has, effort)
			efforts = append(efforts, agentOption{Value: effort, Label: effortLabel(effort)})
		}
	}
	return efforts
}
