package hybridflowrunner

import (
	"errors"
	"testing"
)

// The catalogue is read from the installed CLI, which is what makes the offered models the ones this
// host can actually run — the same reasoning that has the Claude service parse `claude --help`.
const codexCatalogueExcerpt = `{"models":[
  {"slug":"gpt-5.1-codex","display_name":"GPT-5.1 Codex","visibility":"list",
   "supported_reasoning_levels":[{"effort":"high"},{"effort":"low"}]},
  {"slug":"gpt-5.1-codex-mini","display_name":"GPT-5.1 Codex mini","visibility":"list",
   "supported_reasoning_levels":[{"effort":"medium"},{"effort":"xhigh"}]},
  {"slug":"an-internal-slug","display_name":"Internal","visibility":"hidden",
   "supported_reasoning_levels":[{"effort":"ultra"}]}
]}`

func codexOptionsWith(t *testing.T, bypass bool, catalogue func() ([]byte, error)) agentOptionsDto {
	t.Helper()
	svc := &CodexOptionsService{bypassEnabled: bypass, catalogue: catalogue}
	return svc.get()
}

// Only the models the CLI itself would offer, and the effort levels as the union of what they accept
// — the prompt has one effort dropdown where the catalogue has one list per model.
func TestCodexOptionsReadTheCatalogue(t *testing.T) {
	opts := codexOptionsWith(t, true, func() ([]byte, error) {
		return []byte(codexCatalogueExcerpt), nil
	})

	assertValues(t, opts.Models, []string{"gpt-5.1-codex", "gpt-5.1-codex-mini"})
	if opts.Models[0].Label != "GPT-5.1 Codex" {
		t.Errorf("label = %q, want the catalogue's display name", opts.Models[0].Label)
	}
	// Display order and not catalogue order: lowest first, whatever order the models named them in.
	assertValues(t, opts.Efforts, []string{"low", "medium", "high", "xhigh"})
}

// A level this build has never heard of is kept and shown last rather than dropped, so a CLI upgrade
// that adds one reaches the prompt without a code change.
func TestCodexOptionsKeepAnUnknownEffort(t *testing.T) {
	opts := codexOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[{"slug":"m","display_name":"M","visibility":"list",` +
			`"supported_reasoning_levels":[{"effort":"glacial"},{"effort":"low"}]}]}`), nil
	})
	assertValues(t, opts.Efforts, []string{"low", "glacial"})
}

func TestCodexOptionsOfferAdvertisedServiceTiersAndNewEfforts(t *testing.T) {
	opts := codexOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[
		 {"slug":"gpt-6.1-sol","display_name":"GPT-6.1 Sol","visibility":"list",
		  "service_tiers":[{"id":"priority","name":"Fast"},{"id":"ultrafast","name":"Ultrafast"},
		   {"id":"priority","name":"Duplicate"},{"id":"","name":"Empty"}],
		  "additional_speed_tiers":["fast"],
		  "supported_reasoning_levels":[{"effort":"persistent"},{"effort":"ultra"},{"effort":"max"},{"effort":"none"}]},
		 {"slug":"gpt-6-luna","visibility":"list","supported_reasoning_levels":[{"effort":"low"}]},
		 {"slug":"internal","visibility":"hide","service_tiers":[{"id":"private","name":"Private"}]}
		]}`), nil
	})
	assertValues(t, opts.Models, []string{"gpt-6.1-sol", "gpt-6.1-sol@priority", "gpt-6.1-sol@ultrafast", "gpt-6.1-sol@default", "gpt-6-luna"})
	if opts.Models[1].Label != "GPT-6.1 Sol · Fast" || opts.Models[2].Label != "GPT-6.1 Sol · Ultrafast" {
		t.Errorf("tier labels = %+v", opts.Models)
	}
	assertValues(t, opts.Efforts, []string{"none", "low", "max", "ultra", "persistent"})
}

func TestCodexOptionsKeepOlderSpeedCatalogues(t *testing.T) {
	opts := codexOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[{"slug":"m","visibility":"list","additional_speed_tiers":["fast","fast",""]}]}`), nil
	})
	assertValues(t, opts.Models, []string{"m", "m@fast", "m@default"})
}

// A catalogue that cannot be read leaves both lists empty, deliberately. There is no equivalent of
// the Claude aliases to fall back on — a Codex slug is whatever the account's catalogue carries — so
// a curated fallback would send the next turn to a model this host may not have.
func TestCodexOptionsWithNoCatalogueOfferNothing(t *testing.T) {
	opts := codexOptionsWith(t, true, func() ([]byte, error) { return nil, errors.New("no CLI here") })
	if len(opts.Models) != 0 || len(opts.Efforts) != 0 {
		t.Errorf("options = %+v, want nothing guessed where the catalogue could not be read", opts)
	}
	// The modes are this service's own knowledge rather than the CLI's, so they survive.
	assertValues(t, opts.PermissionModes, []string{permissionModeBypass})

	malformed := codexOptionsWith(t, true, func() ([]byte, error) { return []byte("not json"), nil })
	if len(malformed.Models) != 0 {
		t.Errorf("options = %+v, want nothing from a catalogue that could not be read", malformed)
	}
}

// Bypass is the only mode there is, so a deployment that withdraws it leaves this agent with none —
// and that is the honest outcome, not an error: an agent that can only run unsupervised has nothing
// to offer a deployment that forbids it.
func TestCodexPublishesBypassAndNothingElse(t *testing.T) {
	allowed := codexOptionsWith(t, true, func() ([]byte, error) { return []byte(codexCatalogueExcerpt), nil })
	assertValues(t, allowed.PermissionModes, []string{permissionModeBypass})

	forbidden := codexOptionsWith(t, false, func() ([]byte, error) { return []byte(codexCatalogueExcerpt), nil })
	if len(forbidden.PermissionModes) != 0 {
		t.Errorf("modes = %+v, want none where the deployment forbids running unsupervised", forbidden.PermissionModes)
	}
}
