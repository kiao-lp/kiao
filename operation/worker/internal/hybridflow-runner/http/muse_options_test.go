package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"testing"
)

// The catalogue is read from the installed CLI, which is what makes the offered models the ones this
// host can actually run — the same reasoning that has the Codex service ask `codex debug models`.
const museCatalogueExcerpt = `{"models":[
  {"modelId":"meta/muse-spark-1.2","displayLabel":"Muse Spark 1.2","isDefault":true},
  {"modelId":"meta/muse-spark-1.1","displayLabel":"Muse Spark 1.1","isDefault":false},
  {"modelId":"","displayLabel":"Nameless","isDefault":false}
]}`

func museOptionsWith(t *testing.T, bypass bool, catalogue func() ([]byte, error)) agentapi.AgentOptionsDto {
	t.Helper()
	svc := &musecli.MuseOptionsService{BypassEnabled: bypass, Catalogue: catalogue}
	return svc.Get()
}

// The catalogue's rows in the catalogue's order, each plain Spark beside its `-contributor`
// twin, and under the labels the catalogue carries. A row without an id is not something a turn
// could name, so it is left out rather than offered.
func TestMuseOptionsReadTheCatalogue(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(museCatalogueExcerpt), nil
	})

	assertValues(t, opts.Models, []string{"meta/muse-spark-1.2", "meta/muse-spark-1.2-contributor",
		"meta/muse-spark-1.1", "meta/muse-spark-1.1-contributor"})
	if opts.Models[0].Label != "Muse Spark 1.2" {
		t.Errorf("label = %q, want the catalogue's display name", opts.Models[0].Label)
	}
}

// The efforts are the protocol's closed tier vocabulary, less `none`: asking for no reasoning is
// what the Thinking switch already says, and the driver maps it there at spawn time.
func TestMuseOptionsPublishTheEffortTiers(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(museCatalogueExcerpt), nil
	})
	assertValues(t, opts.Efforts,
		[]string{"minimal", "low", "medium", "high", "xhigh", "max", "ultra"})
}

// A catalogue that cannot be read leaves the models empty, deliberately. A Muse model id is
// whatever the account's catalogue happens to carry, so a curated fallback would send the next
// turn to a model this host may not have.
func TestMuseOptionsWithNoCatalogueOfferNoModel(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) { return nil, errors.New("no CLI here") })
	if len(opts.Models) != 0 {
		t.Errorf("models = %+v, want nothing guessed where the catalogue could not be read", opts.Models)
	}
	// The efforts and the modes are this service's own knowledge rather than the CLI's, so they
	// survive.
	if len(opts.Efforts) == 0 || len(opts.PermissionModes) == 0 {
		t.Errorf("options = %+v, want the efforts and the modes kept", opts)
	}

	malformed := museOptionsWith(t, true, func() ([]byte, error) { return []byte("not json"), nil })
	if len(malformed.Models) != 0 {
		t.Errorf("models = %+v, want nothing from a catalogue that could not be read", malformed.Models)
	}
}

// All three modes, like Claude: the host asks over its own wire and the driver relays both the
// calls and the questions, so `manual` and `manualLive` mean here what they mean there. A
// deployment that withdraws bypass keeps the first two.
func TestMusePublishesEveryMode(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(museCatalogueExcerpt), nil
	})
	assertValues(t, opts.PermissionModes,
		[]string{runnerconfig.PermissionModeManual, runnerconfig.PermissionModeManualLive, runnerconfig.PermissionModeBypass})

	withdrawn := museOptionsWith(t, false, func() ([]byte, error) {
		return []byte(museCatalogueExcerpt), nil
	})
	assertValues(t, withdrawn.PermissionModes,
		[]string{runnerconfig.PermissionModeManual, runnerconfig.PermissionModeManualLive})
}

// The catalogue carries no pointer to "the latest" — every row is a versioned id — so the default
// model is the newest Spark contributor build, found by comparing versions rather than by
// following an alias.
func TestDefaultMuseModelIsTheNewestContributor(t *testing.T) {
	models := []agentapi.AgentOption{
		{Value: "muse-spark-1.2-contributor"},
		{Value: "muse-spark-1.3"},
		{Value: "muse-spark-1.3-contributor"},
		{Value: "meta/muse-spark-1.2"},
	}
	if got := agentapi.DefaultMuseModel(models); got != "muse-spark-1.3-contributor" {
		t.Errorf("default = %q, want the newest contributor build", got)
	}
}

// Versions compare numerically: 1.10 is newer than 1.3, and a lexical comparison would say the
// reverse.
func TestDefaultMuseModelComparesVersionsNumerically(t *testing.T) {
	models := []agentapi.AgentOption{
		{Value: "muse-spark-1.3-contributor"},
		{Value: "muse-spark-1.10-contributor"},
		{Value: "muse-spark-1.3.1-contributor"},
	}
	if got := agentapi.DefaultMuseModel(models); got != "muse-spark-1.10-contributor" {
		t.Errorf("default = %q, want 1.10 over 1.3.1 and 1.3", got)
	}
}

// A provider prefix is packaging, not a different model: `meta/muse-spark-1.3-contributor` is the
// same build as the bare id, and wins over an older one without a prefix.
func TestDefaultMuseModelSeesThroughTheProviderPrefix(t *testing.T) {
	models := []agentapi.AgentOption{
		{Value: "muse-spark-1.2-contributor"},
		{Value: "meta/muse-spark-1.3-contributor"},
	}
	if got := agentapi.DefaultMuseModel(models); got != "meta/muse-spark-1.3-contributor" {
		t.Errorf("default = %q, want the prefixed 1.3 contributor", got)
	}
}

// Where the account carries no contributor tier, the newest plain Spark is closer to the intent
// than no opinion at all.
func TestDefaultMuseModelFallsBackToPlainSpark(t *testing.T) {
	models := []agentapi.AgentOption{
		{Value: "meta/muse-spark-1.2"},
		{Value: "muse-spark-1.1"},
	}
	if got := agentapi.DefaultMuseModel(models); got != "meta/muse-spark-1.2" {
		t.Errorf("default = %q, want the newest Spark where no contributor build exists", got)
	}
}

// A catalogue with no Spark in it — or none read at all — is no opinion, and the caller falls
// back to whatever it offers first.
func TestDefaultMuseModelWithNoSparkIsEmpty(t *testing.T) {
	if got := agentapi.DefaultMuseModel([]agentapi.AgentOption{{Value: "something-else-2.0"}}); got != "" {
		t.Errorf("default = %q, want no opinion where no Spark is offered", got)
	}
	if got := agentapi.DefaultMuseModel(nil); got != "" {
		t.Errorf("default = %q, want no opinion where no catalogue was read", got)
	}
}

// `model/list` only answers the visible rows, and the contributor builds are hidden rows in
// the provider catalogue — real ids the CLI accepts, but which the list never names. Every
// plain Spark model is therefore offered beside its `-contributor` twin, in place, so the
// chat can offer what the agent definitions name. Anything that is no plain Spark is left
// alone.
func TestMuseOptionsOfferContributorTwins(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[
  {"modelId":"muse-spark-1.3","displayLabel":"muse-spark-1.3"},
  {"modelId":"muse-spark-1.2","displayLabel":"muse-spark-1.2"},
  {"modelId":"something-else-2.0","displayLabel":"Something Else"}
]}`), nil
	})

	assertValues(t, opts.Models, []string{
		"muse-spark-1.3", "muse-spark-1.3-contributor",
		"muse-spark-1.2", "muse-spark-1.2-contributor",
		"something-else-2.0",
	})
	if opts.Models[1].Label != "muse-spark-1.3-contributor" {
		t.Errorf("twin label = %q, want the id the hidden rows carry as their own label",
			opts.Models[1].Label)
	}
}

// A twin already listed is not added twice: a catalogue that starts answering the contributor
// builds needs no change here.
func TestMuseOptionsKeepListedContributors(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[
  {"modelId":"muse-spark-1.3","displayLabel":"muse-spark-1.3"},
  {"modelId":"muse-spark-1.3-contributor","displayLabel":"muse-spark-1.3-contributor"}
]}`), nil
	})

	assertValues(t, opts.Models, []string{"muse-spark-1.3", "muse-spark-1.3-contributor"})
}

// Wonder models carry the same hidden contributor builds as Spark ones: the channel
// omits both from `model/list`, and the CLI accepts both.
func TestMuseOptionsOfferWonderContributorTwins(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(`{"models":[
  {"modelId":"muse-wonder-1.0","displayLabel":"muse-wonder-1.0"},
  {"modelId":"muse-spark-1.3","displayLabel":"muse-spark-1.3"}
]}`), nil
	})

	assertValues(t, opts.Models, []string{
		"muse-wonder-1.0", "muse-wonder-1.0-contributor",
		"muse-spark-1.3", "muse-spark-1.3-contributor",
	})
}

// The channel names its default with isDefault: the default is that row's contributor
// twin where offered, so new conversations start on what the CLI itself would run.
func TestMuseDefaultFollowsCatalogueIsDefault(t *testing.T) {
	svc := &musecli.MuseOptionsService{BypassEnabled: true, Catalogue: func() ([]byte, error) {
		return []byte(`{"models":[
  {"modelId":"muse-wonder-1.0","displayLabel":"muse-wonder-1.0","isDefault":true},
  {"modelId":"muse-spark-1.3","displayLabel":"muse-spark-1.3","isDefault":false},
  {"modelId":"muse-spark-1.2","displayLabel":"muse-spark-1.2","isDefault":false}
]}`), nil
	}}
	opts := svc.Get()
	assertValues(t, opts.Models, []string{
		"muse-wonder-1.0", "muse-wonder-1.0-contributor",
		"muse-spark-1.3", "muse-spark-1.3-contributor",
		"muse-spark-1.2", "muse-spark-1.2-contributor",
	})
	if got := svc.DefaultModel(); got != "muse-wonder-1.0-contributor" {
		t.Errorf("default = %q, want the isDefault row's contributor twin", got)
	}
}

// With the twins offered, a catalogue naming no contributor build still defaults to one: the
// newest contributor at `max`, as the service advertises and the chat shows.
func TestMuseDefaultIsTheTwinnedContributor(t *testing.T) {
	opts := museOptionsWith(t, true, func() ([]byte, error) {
		return []byte(museCatalogueExcerpt), nil
	})

	if got := agentapi.DefaultMuseModel(opts.Models); got != "meta/muse-spark-1.2-contributor" {
		t.Errorf("default = %q, want the newest twin", got)
	}
}

// The default effort is `max` where the tiers carry it, and no opinion where they do not.
func TestDefaultMuseEffort(t *testing.T) {
	if got := agentapi.DefaultMuseEffort(musecli.MuseEfforts); got != "max" {
		t.Errorf("effort = %q, want max", got)
	}
	tiers := []agentapi.AgentOption{{Value: "low"}, {Value: "high"}}
	if got := agentapi.DefaultMuseEffort(tiers); got != "" {
		t.Errorf("effort = %q, want no opinion where max is not offered", got)
	}
}
