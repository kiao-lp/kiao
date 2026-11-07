package runnerhttp

import (
	"context"
	"encoding/json"
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	"kiao/worker/internal/hybridflow-runner/assembly"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// One real answer of `usage/read`, as a host that has run a turn gives it: the 5-hour-class
// window and the weekly block, with the arrival stamp and the tier. Everything the reader ignores
// is left in, because a field added beside the ones it reads must not break it.
const museObservedUsage = `{
  "usage": {
    "observedAtMs": 1789482441110,
    "tier": "27681393394859588",
    "weekly": {"resetsAtMs": 1789948800000, "usedPercent": 30},
    "window": {"resetsAtMs": 1789499596000, "usedPercent": 5, "windowDurationMins": 300}
  }
}`

func TestMuseUsageFromReadMapsBothWindows(t *testing.T) {
	observed, err := musecli.MuseUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	if observed == nil {
		t.Fatal("an answer carrying usage is an observation, not an absence")
	}
	// Tightest first, which is the order the usage panel draws.
	want := []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 5, ResetAtEpochSeconds: 1789499596},
		{WindowMinutes: 10080, PercentUsed: 30, ResetAtEpochSeconds: 1789948800},
	}
	if !reflect.DeepEqual(observed.Dto().Windows, want) {
		t.Errorf("windows = %+v, want %+v", observed.Dto().Windows, want)
	}
	if observed.ObservedAtMs != 1789482441110 {
		t.Errorf("observedAtMs = %d, want the host's arrival stamp", observed.ObservedAtMs)
	}
}

// A host that has observed nothing answers `{}`, with the usage member omitted rather than null.
// It is what a fresh host says, and the service reads it as "nothing to record" rather than as a
// failure — the quota is unavailable until a turn has run, which is the truth.
func TestMuseUsageFromReadWithNothingObservedIsNotAnError(t *testing.T) {
	observed, err := musecli.MuseUsageFromRead([]byte(`{}`))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	if observed != nil {
		t.Errorf("an empty answer is no observation, got %+v", observed)
	}
}

func TestMuseUsageFromReadRefusesAnAnswerItCannotRead(t *testing.T) {
	if _, err := musecli.MuseUsageFromRead([]byte(`{not json`)); err == nil {
		t.Error("a malformed answer should be an error, not an empty quota")
	}
}

// An observation carrying no reset at all is nothing to draw a bar from: recording it would put
// 0% beside a 1970 reset, which reads as a full quota rather than as no figures.
func TestMuseUsageWithNoResetIsNothingToRecord(t *testing.T) {
	var observed musecli.MuseSubscriptionUsage
	if err := json.Unmarshal([]byte(`{"observedAtMs":1,"tier":"x",
		"weekly":{"resetsAtMs":0,"usedPercent":0},
		"window":{"resetsAtMs":0,"usedPercent":0,"windowDurationMins":300}}`), &observed); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if !observed.IsEmpty() {
		t.Error("an observation with no reset should read as empty")
	}
	raw := struct {
		Usage musecli.MuseSubscriptionUsage `json:"usage"`
	}{}
	if err := json.Unmarshal([]byte(museObservedUsage), &raw); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if raw.Usage.IsEmpty() {
		t.Error("the observed fixture should read as something to record")
	}
}

// Before any turn has run there is nothing harvested to report: the cheap port answers an error,
// which reads as an unavailable quota — while a refresh runs one minimal turn to observe it.
func TestMuseUsageBeforeAnyTurnIsAnError(t *testing.T) {
	svc := musecli.NewMuseUsageService()
	if _, err := svc.GetUsage(); err == nil {
		t.Fatal("with no observation the quota should be an error, not an empty one")
	}
}

// What one turn's host observed is what the endpoint answers, until a newer observation replaces
// it. Two turns may run at once on two hosts, so "newer" is the host's arrival stamp rather than
// the order the answers landed in: a stale one arriving late must not move the figures backwards.
func TestMuseUsageKeepsTheNewestObservation(t *testing.T) {
	svc := musecli.NewMuseUsageService()
	first, err := musecli.MuseUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	svc.Note(first.Dto(), first.ObservedAtMs)
	got, err := svc.GetUsage()
	if err != nil {
		t.Fatalf("getUsage: %v", err)
	}
	if !reflect.DeepEqual(got, first.Dto()) {
		t.Fatalf("usage = %+v, want %+v", got, first.Dto())
	}

	later := agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 6, ResetAtEpochSeconds: 1789499596}}}
	svc.Note(later, first.ObservedAtMs+1000)
	if got, _ := svc.GetUsage(); !reflect.DeepEqual(got, later) {
		t.Errorf("a newer observation should replace the figures, got %+v", got)
	}
	svc.Note(first.Dto(), first.ObservedAtMs)
	if got, _ := svc.GetUsage(); !reflect.DeepEqual(got, later) {
		t.Errorf("an older observation arriving late must not move the figures, got %+v", got)
	}
}

// The quota belongs to the agent the registry drives, not to a stub a test put in its place: a
// usage panel reads through this port, and a nil here is the 404 it used to get.
func TestMuseAgentAnswersTheQuotaPort(t *testing.T) {
	_, cfg := newTurnRegistry(t)
	registry := assembly.NewAgentRegistry(cfg)
	if registry.UsageFor(agentapi.AgentMuse) == nil {
		t.Fatal("the Muse agent should answer the quota port")
	}
	if _, ok := registry.UsageFor(agentapi.AgentMuse).(agentapi.AgentUsageRefresh); !ok {
		t.Fatal("the Muse agent should answer the refresh port: its quota has no stateless read")
	}
}

// The probe runs on the catalogue's oldest generation: the catalogue carries no price, and an
// older generation is the cheaper one.
func TestCheapestMuseModelIsTheOldestGeneration(t *testing.T) {
	raw := `{"models":[
		{"modelId":"muse-spark-1.3","displayLabel":"muse-spark-1.3"},
		{"modelId":"muse-spark-1.3-contributor","displayLabel":"muse-spark-1.3-contributor"},
		{"modelId":"muse-spark-1.2","displayLabel":"muse-spark-1.2"},
		{"modelId":"muse-spark-1.2-contributor","displayLabel":"muse-spark-1.2-contributor"}
	]}`
	if got := musecli.CheapestMuseModel([]byte(raw)); got != "muse-spark-1.2" {
		t.Errorf("cheapest = %q, want the oldest generation", got)
	}
	// Prefixed ids read the same; a row with no version in it sorts after every versioned one,
	// and a tie keeps the catalogue's order.
	prefixed := `{"models":[
		{"modelId":"meta/muse-spark-1.2","displayLabel":"x"},
		{"modelId":"meta/muse-spark-1.1","displayLabel":"x"},
		{"modelId":"meta/muse-spark-next","displayLabel":"x"}
	]}`
	if got := musecli.CheapestMuseModel([]byte(prefixed)); got != "meta/muse-spark-1.1" {
		t.Errorf("cheapest = %q, want meta/muse-spark-1.1", got)
	}
	if got := musecli.CheapestMuseModel([]byte(`{"models":[]}`)); got != "" {
		t.Errorf("cheapest of nothing = %q, want none: the probe then runs the host default", got)
	}
	if got := musecli.CheapestMuseModel([]byte(`not json`)); got != "" {
		t.Errorf("cheapest of a broken catalogue = %q, want none", got)
	}
}

// A refresh with nothing fresh to answer probes, and records what the probe observed like any
// turn's — the account as of this minute rather than as of the last turn.
func TestMuseRefreshProbesWhenNothingIsFresh(t *testing.T) {
	observed, err := musecli.MuseUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	var calls int
	var probedModel string
	svc := musecli.NewMuseUsageService()
	svc.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"modelId":"muse-spark-1.2"},{"modelId":"muse-spark-1.3"}]}`), nil
	}
	svc.Probe = func(ctx context.Context, binary, model string) (*musecli.MuseSubscriptionUsage, error) {
		calls++
		probedModel = model
		return observed, nil
	}
	dto, err := svc.Refresh()
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !reflect.DeepEqual(dto, observed.Dto()) {
		t.Errorf("refresh = %+v, want the probe's observation", dto)
	}
	if probedModel != "muse-spark-1.2" {
		t.Errorf("probe model = %q, want the catalogue's cheapest", probedModel)
	}
	// Recorded: the cheap port answers it without probing, and a second refresh is served from
	// the figures rather than from a second turn.
	if got, err := svc.GetUsage(); err != nil || !reflect.DeepEqual(got, dto) {
		t.Errorf("getUsage = %+v, %v, want the refreshed figures probed once", got, err)
	}
	if _, err := svc.Refresh(); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if calls != 1 {
		t.Errorf("the probe ran %d times, want once: fresh figures are answered, not re-read", calls)
	}
}

// A probe that fails is an error, and keeps whatever an older turn recorded.
func TestMuseRefreshFailureKeepsTheHarvestedFigures(t *testing.T) {
	svc := musecli.NewMuseUsageService()
	older := agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 41, ResetAtEpochSeconds: 1789499596}}}
	svc.Note(older, 1789482441110)
	// Freshly noted figures would be answered without probing; age them past the cache.
	svc.CachedAt = time.Now().Add(-time.Hour)
	svc.Probe = func(ctx context.Context, binary, model string) (*musecli.MuseSubscriptionUsage, error) {
		return nil, errors.New("signed out")
	}
	if _, err := svc.Refresh(); err == nil {
		t.Fatal("a failed probe should be an error, not an empty quota")
	}
	if kept, err := svc.GetUsage(); err != nil || !reflect.DeepEqual(kept, older) {
		t.Errorf("quota = %+v, %v, want the older turn's figures kept", kept, err)
	}
}

// A probe that observed nothing is an error rather than an empty quota.
func TestMuseRefreshWithNothingObservedIsAnError(t *testing.T) {
	svc := musecli.NewMuseUsageService()
	svc.Probe = func(ctx context.Context, binary, model string) (*musecli.MuseSubscriptionUsage, error) {
		return nil, nil
	}
	if _, err := svc.Refresh(); err == nil {
		t.Fatal("a probe that observed nothing should be an error")
	}
}

// The probe over a stub host: one session, one one-word turn at no reasoning effort, then the
// question — and the observation that comes back.
func TestMuseProbeRunsOneMinimalTurn(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "stub.log")
	t.Setenv("GO_WANT_MUSE_STUB", "1")
	t.Setenv("MUSE_STUB_SCRIPT", "turn")
	t.Setenv("MUSE_STUB_LOG", logPath)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	observed, err := musecli.MuseProbeUsage(ctx, os.Args[0], "stub-model")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if observed == nil || observed.IsEmpty() {
		t.Fatalf("the probe observed nothing: %+v", observed)
	}
	if got := observed.Dto().Windows; len(got) != 2 || got[0].PercentUsed != 5 || got[1].PercentUsed != 30 {
		t.Errorf("probed windows = %+v, want the host's observation", got)
	}

	calls := museStubCalls(t, logPath)
	named := museStubCall(t, calls, "session/setModel")
	if model, _ := named["model"].(map[string]any); model["modelId"] != "stub-model" {
		t.Errorf("setModel = %+v, want the probe's cheapest model named", named)
	}
	turn := museStubCall(t, calls, "turn/start")
	if turn["reasoningEffort"] != "none" {
		t.Errorf("turn/start effort = %+v, want none: the probe is not a turn to think in", turn)
	}
	inputs, _ := turn["input"].([]any)
	if len(inputs) != 1 {
		t.Fatalf("turn/start input = %+v, want the one word", turn["input"])
	}
	if part, _ := inputs[0].(map[string]any); part["text"] != musecli.MuseProbeInput {
		t.Errorf("probe input = %+v, want %q", part, musecli.MuseProbeInput)
	}
	museStubCall(t, calls, "usage/read")
}
