package pi

import (
	"encoding/json"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"testing"
)

func TestPiUsageDeltaIncludesCacheAndExcludesPreviousTurns(t *testing.T) {
	var before, after map[string]json.RawMessage
	if err := json.Unmarshal([]byte(`{"tokens":{"input":100,"output":20,"cacheRead":80,"cacheWrite":10,"total":210},"cost":0.01}`), &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"tokens":{"input":150,"output":30,"cacheRead":100,"cacheWrite":15,"total":295},"cost":0.03}`), &after); err != nil {
		t.Fatal(err)
	}
	usage, ok := piUsageDelta(before, after)
	if !ok || usage.InputTokens != 75 || usage.OutputTokens != 10 ||
		usage.CacheReadTokens != 20 || usage.CacheWriteTokens != 5 ||
		usage.TotalCostUSD < 0.019999 || usage.TotalCostUSD > 0.020001 || usage.Scope != harnessapi.UsageScopeTurn {
		t.Fatalf("usage = %+v/%v, want only this turn's 85 tokens", usage, ok)
	}
	if usage, ok := piUsageDelta(after, after); ok || usage != nil {
		t.Fatalf("unchanged stats = %+v/%v, want no bill", usage, ok)
	}
}

func TestPiUsageDeltaRetainsAnUnclassifiedTotal(t *testing.T) {
	var before, after map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"tokens":{"total":100}}`), &before)
	_ = json.Unmarshal([]byte(`{"tokens":{"total":175}}`), &after)
	usage, ok := piUsageDelta(before, after)
	if !ok || usage.InputTokens != 75 {
		t.Fatalf("usage = %+v/%v, want the reported total even without a split", usage, ok)
	}
}

func TestPiCompletedMessageUsageSurvivesAProcessCrash(t *testing.T) {
	cfg, profiles, _, meta := piTestSetup(t, "")
	events := collectPi(t, NewPiHarness(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, meta, "usage-crash"), nil)
	terminalPi(t, events, 1)
	var usage *harnessapi.TurnUsage
	for _, event := range events {
		if event.Kind == harnessapi.EventUsage {
			usage = event.Usage
		}
	}
	if usage == nil || usage.InputTokens != 140 || usage.OutputTokens != 20 ||
		usage.CacheReadTokens != 30 || usage.CacheWriteTokens != 10 || usage.TotalCostUSD != 0.003 {
		t.Fatalf("usage after crash = %+v, want every reported message token", usage)
	}
}
