package runnerhttp

import (
	"encoding/json"
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"net/http/httptest"
	"testing"
)

// wideHelpExcerpt is `claude --help` as rendered to a wide terminal: the choice list stays on the
// `--effort` line itself.
const wideHelpExcerpt = `Options:
  --debug [filter]                  Enable debug mode with optional category filtering
  --effort <level>                  Effort level for the current session (low, medium, high, xhigh, max)
  --model <model>                   Model for the current session (e.g. 'sonnet' or 'opus').
`

// wrappedHelpExcerpt is the verbatim output of `claude --help` (2.1.218) with no TTY attached —
// which is exactly what worker sees when it spawns the CLI. The choice list is wrapped onto
// a continuation line, and the option that follows wraps too. A parser that only looked at the
// `--effort` line itself would silently find nothing here and fall back to a stale hard-coded list.
const wrappedHelpExcerpt = `Options:
  --debug [filter]                      Enable debug mode with optional
                                        category filtering
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --exclude-dynamic-system-prompt-sections
      Move per-machine sections (cwd, env info, memory paths, git status) from
      the system prompt into the first user message.
  --include-partial-messages            Include partial message chunks as they
                                        arrive (only works with --print and
                                        --output-format=stream-json)
`

// proseParenHelpExcerpt puts a descriptive aside before the real choices, so the parser must skip
// the prose group rather than read "only works with --print" as a list of effort levels.
const proseParenHelpExcerpt = `Options:
  --effort <level>                      Effort level (only works with --print)
                                        (low, medium, high)
`

func effortValues(opts []agentapi.AgentOption) []string {
	out := make([]string, 0, len(opts))
	for _, o := range opts {
		out = append(out, o.Value)
	}
	return out
}

func assertValues(t *testing.T, got []agentapi.AgentOption, want []string) {
	t.Helper()
	gotValues := effortValues(got)
	if len(gotValues) != len(want) {
		t.Fatalf("got %v, want %v", gotValues, want)
	}
	for i := range want {
		if gotValues[i] != want[i] {
			t.Fatalf("got %v, want %v", gotValues, want)
		}
	}
}

func TestParseEffortChoices(t *testing.T) {
	cases := []struct {
		name string
		help string
		want []string
	}{
		{"wide terminal", wideHelpExcerpt, []string{"low", "medium", "high", "xhigh", "max"}},
		{"wrapped (no TTY)", wrappedHelpExcerpt, []string{"low", "medium", "high", "xhigh", "max"}},
		{"prose aside before choices", proseParenHelpExcerpt, []string{"low", "medium", "high"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertValues(t, claudecli.ParseEffortChoices(tc.help), tc.want)
		})
	}
}

// TestParseEffortChoicesLabels covers the display text, including the override that keeps "xhigh"
// from rendering as "Xhigh".
func TestParseEffortChoicesLabels(t *testing.T) {
	got := claudecli.ParseEffortChoices(wrappedHelpExcerpt)
	want := map[string]string{"low": "Low", "xhigh": "X-High", "max": "Max"}
	for _, o := range got {
		if expected, ok := want[o.Value]; ok && o.Label != expected {
			t.Errorf("label for %q = %q, want %q", o.Value, o.Label, expected)
		}
	}
}

func TestParseEffortChoicesNoMatch(t *testing.T) {
	if got := claudecli.ParseEffortChoices("no effort line here"); got != nil {
		t.Errorf("expected nil for help without an --effort line, got %+v", got)
	}
}

// TestResolveEffortsFallback checks that a failing `claude --help` yields the documented defaults
// rather than an empty list, so the UI still has something to offer.
func TestResolveEffortsFallback(t *testing.T) {
	svc := &claudecli.ClaudeOptionsService{Help: func() (string, error) { return "", errors.New("not found") }}
	got := svc.ResolveEfforts()
	if len(got) != len(agentapi.DefaultEfforts) {
		t.Fatalf("resolveEfforts fallback = %+v, want defaultEfforts", got)
	}
}

// TestHandleClaudeOptions drives the endpoint end-to-end with a stubbed help command and asserts
// the JSON carries both models and the parsed efforts.
func TestHandleClaudeOptions(t *testing.T) {
	svc := &claudecli.ClaudeOptionsService{BypassEnabled: true, Help: func() (string, error) { return wrappedHelpExcerpt, nil }}
	srv := &Service{agents: &agentapi.AgentRegistry{Entries: []agentapi.AgentEntry{
		{Name: agentapi.AgentClaude, Label: "Claude", Agent: &claudecli.ClaudeAgent{OptionsService: svc}, Allowed: true},
	}}}

	req := httptest.NewRequest(http.MethodGet, "/claude/options", nil)
	rec := httptest.NewRecorder()
	srv.HandleOptions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var opts agentapi.AgentOptionsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &opts); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(opts.Models) == 0 {
		t.Error("expected at least one model")
	}
	assertValues(t, opts.Efforts, []string{"low", "medium", "high", "xhigh", "max"})
	// Permission modes are curated rather than parsed: only these are modes this service knows how
	// to drive over the socket, whatever else `--permission-mode` accepts — and `manualLive` is one
	// it accepts nowhere, being a client behaviour this service only stores and relays.
	assertValues(t, opts.PermissionModes,
		[]string{runnerconfig.PermissionModeManual, runnerconfig.PermissionModeManualLive, runnerconfig.PermissionModeBypass})
	for _, mode := range opts.PermissionModes {
		if mode.Label == "" {
			t.Errorf("permission mode %q has no label to display", mode.Value)
		}
	}
}

// TestClaudeOptionsWithoutBypass: a service that does not allow `bypassPermissions` must not offer
// it either. The refusal at the prompt is the gate; this is what keeps the toolbar from showing a
// choice whose only outcome is that refusal.
func TestClaudeOptionsWithoutBypass(t *testing.T) {
	svc := &claudecli.ClaudeOptionsService{Help: func() (string, error) { return wrappedHelpExcerpt, nil }}
	assertValues(t, svc.Get().PermissionModes, []string{runnerconfig.PermissionModeManual, runnerconfig.PermissionModeManualLive})
}
