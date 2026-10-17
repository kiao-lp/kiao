package hybridflowrunner

import (
	"context"
	"encoding/json"
	"errors"
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
	observed, err := museUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	if observed == nil {
		t.Fatal("an answer carrying usage is an observation, not an absence")
	}
	// Tightest first, which is the order the usage panel draws.
	want := []agentWindow{
		{WindowMinutes: 300, PercentUsed: 5, ResetAtEpochSeconds: 1789499596},
		{WindowMinutes: 10080, PercentUsed: 30, ResetAtEpochSeconds: 1789948800},
	}
	if !reflect.DeepEqual(observed.dto().Windows, want) {
		t.Errorf("windows = %+v, want %+v", observed.dto().Windows, want)
	}
	if observed.ObservedAtMs != 1789482441110 {
		t.Errorf("observedAtMs = %d, want the host's arrival stamp", observed.ObservedAtMs)
	}
}

// A host that has observed nothing answers `{}`, with the usage member omitted rather than null.
// It is what a fresh host says, and the service reads it as "nothing to record" rather than as a
// failure — the quota is unavailable until a turn has run, which is the truth.
func TestMuseUsageFromReadWithNothingObservedIsNotAnError(t *testing.T) {
	observed, err := museUsageFromRead([]byte(`{}`))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	if observed != nil {
		t.Errorf("an empty answer is no observation, got %+v", observed)
	}
}

func TestMuseUsageFromReadRefusesAnAnswerItCannotRead(t *testing.T) {
	if _, err := museUsageFromRead([]byte(`{not json`)); err == nil {
		t.Error("a malformed answer should be an error, not an empty quota")
	}
}

// An observation carrying no reset at all is nothing to draw a bar from: recording it would put
// 0% beside a 1970 reset, which reads as a full quota rather than as no figures.
func TestMuseUsageWithNoResetIsNothingToRecord(t *testing.T) {
	var observed museSubscriptionUsage
	if err := json.Unmarshal([]byte(`{"observedAtMs":1,"tier":"x",
		"weekly":{"resetsAtMs":0,"usedPercent":0},
		"window":{"resetsAtMs":0,"usedPercent":0,"windowDurationMins":300}}`), &observed); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if !observed.isEmpty() {
		t.Error("an observation with no reset should read as empty")
	}
	raw := struct {
		Usage museSubscriptionUsage `json:"usage"`
	}{}
	if err := json.Unmarshal([]byte(museObservedUsage), &raw); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if raw.Usage.isEmpty() {
		t.Error("the observed fixture should read as something to record")
	}
}

// Before any turn has run there is nothing harvested to report: the cheap port answers an error,
// which reads as an unavailable quota — while a refresh runs one minimal turn to observe it.
func TestMuseUsageBeforeAnyTurnIsAnError(t *testing.T) {
	svc := newMuseUsageService()
	if _, err := svc.getUsage(); err == nil {
		t.Fatal("with no observation the quota should be an error, not an empty one")
	}
}

// What one turn's host observed is what the endpoint answers, until a newer observation replaces
// it. Two turns may run at once on two hosts, so "newer" is the host's arrival stamp rather than
// the order the answers landed in: a stale one arriving late must not move the figures backwards.
func TestMuseUsageKeepsTheNewestObservation(t *testing.T) {
	svc := newMuseUsageService()
	first, err := museUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	svc.note(first.dto(), first.ObservedAtMs)
	got, err := svc.getUsage()
	if err != nil {
		t.Fatalf("getUsage: %v", err)
	}
	if !reflect.DeepEqual(got, first.dto()) {
		t.Fatalf("usage = %+v, want %+v", got, first.dto())
	}

	later := AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: 6, ResetAtEpochSeconds: 1789499596}}}
	svc.note(later, first.ObservedAtMs+1000)
	if got, _ := svc.getUsage(); !reflect.DeepEqual(got, later) {
		t.Errorf("a newer observation should replace the figures, got %+v", got)
	}
	svc.note(first.dto(), first.ObservedAtMs)
	if got, _ := svc.getUsage(); !reflect.DeepEqual(got, later) {
		t.Errorf("an older observation arriving late must not move the figures, got %+v", got)
	}
}

// The quota belongs to the agent the registry drives, not to a stub a test put in its place: a
// usage panel reads through this port, and a nil here is the 404 it used to get.
func TestMuseAgentAnswersTheQuotaPort(t *testing.T) {
	_, cfg := newTurnRegistry(t)
	registry := newAgentRegistry(cfg)
	if registry.usageFor(agentMuse) == nil {
		t.Fatal("the Muse agent should answer the quota port")
	}
	if _, ok := registry.usageFor(agentMuse).(AgentUsageRefresh); !ok {
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
	if got := cheapestMuseModel([]byte(raw)); got != "muse-spark-1.2" {
		t.Errorf("cheapest = %q, want the oldest generation", got)
	}
	// Prefixed ids read the same; a row with no version in it sorts after every versioned one,
	// and a tie keeps the catalogue's order.
	prefixed := `{"models":[
		{"modelId":"meta/muse-spark-1.2","displayLabel":"x"},
		{"modelId":"meta/muse-spark-1.1","displayLabel":"x"},
		{"modelId":"meta/muse-spark-next","displayLabel":"x"}
	]}`
	if got := cheapestMuseModel([]byte(prefixed)); got != "meta/muse-spark-1.1" {
		t.Errorf("cheapest = %q, want meta/muse-spark-1.1", got)
	}
	if got := cheapestMuseModel([]byte(`{"models":[]}`)); got != "" {
		t.Errorf("cheapest of nothing = %q, want none: the probe then runs the host default", got)
	}
	if got := cheapestMuseModel([]byte(`not json`)); got != "" {
		t.Errorf("cheapest of a broken catalogue = %q, want none", got)
	}
}

// A refresh with nothing fresh to answer probes, and records what the probe observed like any
// turn's — the account as of this minute rather than as of the last turn.
func TestMuseRefreshProbesWhenNothingIsFresh(t *testing.T) {
	observed, err := museUsageFromRead([]byte(museObservedUsage))
	if err != nil {
		t.Fatalf("museUsageFromRead: %v", err)
	}
	var calls int
	var probedModel string
	svc := newMuseUsageService()
	svc.catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"modelId":"muse-spark-1.2"},{"modelId":"muse-spark-1.3"}]}`), nil
	}
	svc.probe = func(ctx context.Context, binary, model string) (*museSubscriptionUsage, error) {
		calls++
		probedModel = model
		return observed, nil
	}
	dto, err := svc.refresh()
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !reflect.DeepEqual(dto, observed.dto()) {
		t.Errorf("refresh = %+v, want the probe's observation", dto)
	}
	if probedModel != "muse-spark-1.2" {
		t.Errorf("probe model = %q, want the catalogue's cheapest", probedModel)
	}
	// Recorded: the cheap port answers it without probing, and a second refresh is served from
	// the figures rather than from a second turn.
	if got, err := svc.getUsage(); err != nil || !reflect.DeepEqual(got, dto) {
		t.Errorf("getUsage = %+v, %v, want the refreshed figures probed once", got, err)
	}
	if _, err := svc.refresh(); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if calls != 1 {
		t.Errorf("the probe ran %d times, want once: fresh figures are answered, not re-read", calls)
	}
}

// A probe that fails is an error, and keeps whatever an older turn recorded.
func TestMuseRefreshFailureKeepsTheHarvestedFigures(t *testing.T) {
	svc := newMuseUsageService()
	older := AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: 41, ResetAtEpochSeconds: 1789499596}}}
	svc.note(older, 1789482441110)
	// Freshly noted figures would be answered without probing; age them past the cache.
	svc.cachedAt = time.Now().Add(-time.Hour)
	svc.probe = func(ctx context.Context, binary, model string) (*museSubscriptionUsage, error) {
		return nil, errors.New("signed out")
	}
	if _, err := svc.refresh(); err == nil {
		t.Fatal("a failed probe should be an error, not an empty quota")
	}
	if kept, err := svc.getUsage(); err != nil || !reflect.DeepEqual(kept, older) {
		t.Errorf("quota = %+v, %v, want the older turn's figures kept", kept, err)
	}
}

// A probe that observed nothing is an error rather than an empty quota.
func TestMuseRefreshWithNothingObservedIsAnError(t *testing.T) {
	svc := newMuseUsageService()
	svc.probe = func(ctx context.Context, binary, model string) (*museSubscriptionUsage, error) {
		return nil, nil
	}
	if _, err := svc.refresh(); err == nil {
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
	observed, err := museProbeUsage(ctx, os.Args[0], "stub-model")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if observed == nil || observed.isEmpty() {
		t.Fatalf("the probe observed nothing: %+v", observed)
	}
	if got := observed.dto().Windows; len(got) != 2 || got[0].PercentUsed != 5 || got[1].PercentUsed != 30 {
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
	if part, _ := inputs[0].(map[string]any); part["text"] != museProbeInput {
		t.Errorf("probe input = %+v, want %q", part, museProbeInput)
	}
	museStubCall(t, calls, "usage/read")
}
