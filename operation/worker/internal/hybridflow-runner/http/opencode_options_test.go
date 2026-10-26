package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	opencodecli "kiao/worker/internal/hybridflow-runner/agents/opencode"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"testing"
)

func opencodeOptionsWith(t *testing.T, bypass bool, catalogue func() ([]byte, error)) agentapi.AgentOptionsDto {
	t.Helper()
	svc := &opencodecli.OpenCodeOptionsService{BypassEnabled: bypass, Catalogue: catalogue}
	return svc.Get()
}

// The curated two head the list, and the host's own ids follow — each once, in the order the CLI
// named them. Anything that is not an id is not offered.
func TestOpenCodeOptionsHeadTheCuratedTwo(t *testing.T) {
	opts := opencodeOptionsWith(t, true, func() ([]byte, error) {
		return []byte("opencode/big-pickle\ndeepseek/deepseek-v4-pro\n\nnot-an-id\n"), nil
	})
	assertValues(t, opts.Models, []string{
		"deepseek/deepseek-v4-pro", "mistral/mistral-large-4", "opencode/big-pickle",
	})
	if opts.Models[0].Label != "DeepSeek V4 Pro" {
		t.Errorf("label = %q, want the curated display name", opts.Models[0].Label)
	}
	assertValues(t, opts.Efforts, []string{"low", "medium", "high", "max"})
}

// A catalogue that cannot be read leaves the curated two alone, deliberately. They are verified
// ids rather than a guess, and an empty list here would make the two models this agent exists to
// run unnameable on exactly the host being set up.
func TestOpenCodeOptionsWithNoCatalogueKeepTheCuratedTwo(t *testing.T) {
	opts := opencodeOptionsWith(t, true, func() ([]byte, error) { return nil, errors.New("no CLI here") })
	assertValues(t, opts.Models, []string{"deepseek/deepseek-v4-pro", "mistral/mistral-large-4"})
	// The efforts and the modes are this service's own knowledge rather than the CLI's, so they
	// survive.
	assertValues(t, opts.Efforts, []string{"low", "medium", "high", "max"})
	assertValues(t, opts.PermissionModes, []string{runnerconfig.PermissionModeBypass})
}

// Bypass and nothing else, like Codex: `opencode run` auto-rejects without `--auto`, so the
// manual modes would be a lie told in a dropdown. A deployment with bypass switched off publishes
// no mode at all.
func TestOpenCodePublishesBypassAndNothingElse(t *testing.T) {
	opts := opencodeOptionsWith(t, true, func() ([]byte, error) { return nil, errors.New("no CLI here") })
	assertValues(t, opts.PermissionModes, []string{runnerconfig.PermissionModeBypass})

	off := opencodeOptionsWith(t, false, func() ([]byte, error) { return nil, errors.New("no CLI here") })
	if len(off.PermissionModes) != 0 {
		t.Errorf("modes = %+v, want none where the deployment forbids bypass", off.PermissionModes)
	}
}
