package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	codexcli "kiao/worker/internal/hybridflow-runner/agents/codex"
	"reflect"
	"testing"
	"time"
)

// One real answer of `account/rateLimits/read`, as a paid plan gives it: two windows, the tighter
// one first. Everything the reader ignores is left in, because a field added beside the ones it
// reads must not break it.
const codexPaidRateLimits = `{
  "rateLimits": {
    "limitId": "codex",
    "limitName": null,
    "primary": {"usedPercent": 12, "windowDurationMins": 300, "resetsAt": 1791148787},
    "secondary": {"usedPercent": 58, "windowDurationMins": 10080, "resetsAt": 1791500000},
    "credits": {"hasCredits": false, "unlimited": false, "balance": null},
    "planType": "plus",
    "rateLimitReachedType": null
  },
  "accountId": "an-account"
}`

// And one as a free plan gives it: a single thirty-day window, and no second at all. It is the case
// the old `fiveHour`/`weekly` payload could not say — which is why the wire carries a list whose
// windows name their own length.
const codexFreeRateLimits = `{
  "rateLimits": {
    "primary": {"usedPercent": 34, "windowDurationMins": 43200, "resetsAt": 1791148787},
    "secondary": null,
    "planType": "free"
  }
}`

func TestCodexUsageFromReadsBothWindows(t *testing.T) {
	dto, err := codexcli.CodexUsageFrom([]byte(codexPaidRateLimits))
	if err != nil {
		t.Fatalf("codexUsageFrom: %v", err)
	}
	want := []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 12, ResetAtEpochSeconds: 1791148787},
		{WindowMinutes: 10080, PercentUsed: 58, ResetAtEpochSeconds: 1791500000},
	}
	if !reflect.DeepEqual(dto.Windows, want) {
		t.Errorf("windows = %+v, want %+v", dto.Windows, want)
	}
}

// A plan with one window answers one bar, not two — and certainly not one thirty-day window drawn
// under a label saying five hours, which is what mapping `primary` onto a fixed pair would give.
func TestCodexUsageFromKeepsAPlanWithOneWindowAtOne(t *testing.T) {
	dto, err := codexcli.CodexUsageFrom([]byte(codexFreeRateLimits))
	if err != nil {
		t.Fatalf("codexUsageFrom: %v", err)
	}
	want := []agentapi.AgentWindow{{WindowMinutes: 43200, PercentUsed: 34, ResetAtEpochSeconds: 1791148787}}
	if !reflect.DeepEqual(dto.Windows, want) {
		t.Errorf("windows = %+v, want %+v", dto.Windows, want)
	}
}

// An account the CLI reports no window for is an account with no window, not a service that failed:
// the usage panel reads it as unavailable rather than as a failure, which is the truth.
func TestCodexUsageFromAnAccountWithNoWindowIsNotAnError(t *testing.T) {
	dto, err := codexcli.CodexUsageFrom([]byte(`{"rateLimits":{}}`))
	if err != nil {
		t.Fatalf("codexUsageFrom: %v", err)
	}
	if len(dto.Windows) != 0 {
		t.Errorf("windows = %+v, want none", dto.Windows)
	}
}

func TestCodexUsageFromRefusesAnAnswerItCannotRead(t *testing.T) {
	if _, err := codexcli.CodexUsageFrom([]byte(`{not json`)); err == nil {
		t.Error("a malformed answer should be an error, not an empty quota")
	}
}

// The cache is what keeps a panel of four columns from spawning four app servers: the second read
// inside the TTL never reaches the CLI at all.
func TestCodexUsageIsCachedForTheWindowTheClaudeSideCachesFor(t *testing.T) {
	asked := 0
	svc := &codexcli.CodexUsageService{Probe: func() ([]byte, error) {
		asked++
		return []byte(codexPaidRateLimits), nil
	}}

	first, err := svc.GetUsage()
	if err != nil {
		t.Fatalf("first read: %v", err)
	}
	second, err := svc.GetUsage()
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if asked != 1 {
		t.Errorf("the app server was asked %d times, want once", asked)
	}
	if !reflect.DeepEqual(first, second) {
		t.Errorf("the cached answer differs from the first: %+v vs %+v", second, first)
	}

	// Aged past the TTL, the next read goes back to the CLI.
	svc.CachedAt = time.Now().Add(-agentapi.UsageCacheTTL - time.Second)
	if _, err := svc.GetUsage(); err != nil {
		t.Fatalf("third read: %v", err)
	}
	if asked != 2 {
		t.Errorf("the app server was asked %d times after the TTL, want twice", asked)
	}
}

// A probe that failed is reported rather than cached: the next read tries again, and the panel keeps
// whatever figures it already had.
func TestCodexUsageDoesNotCacheAFailure(t *testing.T) {
	svc := &codexcli.CodexUsageService{Probe: func() ([]byte, error) { return nil, errors.New("signed out") }}
	if _, err := svc.GetUsage(); err == nil {
		t.Fatal("a failed probe should be an error")
	}
	if svc.Cached != nil {
		t.Error("a failed probe must not be cached")
	}
}
