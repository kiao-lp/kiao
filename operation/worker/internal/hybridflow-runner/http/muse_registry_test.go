package runnerhttp

import (
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	musecli "kiao/worker/internal/hybridflow-runner/harnesses/muse"
	"testing"
)

// museHarnessAt is the Muse harness pointed at a binary of the test's choosing — the same seam
// codexHarnessAt is, and for the same reason.
func museHarnessAt(cfg *runnerconfig.Config, binary string) *musecli.MuseHarness {
	harness := &musecli.MuseHarness{Cfg: cfg, Binary: binary,
		OptionsService: musecli.NewMuseOptionsService(cfg), Quota: musecli.NewMuseUsageService(),
		Login: musecli.NewMuseLoginService(cfg)}
	harness.OptionsService.Binary = binary
	harness.Login.Binary = binary
	harness.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"modelId":"meta/muse-spark-1.2","displayLabel":"Muse Spark 1.2"}]}`), nil
	}
	harness.Quota.Binary = binary
	return harness
}

// The usage endpoint reads the quota port of the registered Muse harness.
func TestMuseHarnessAnswersTheQuotaPort(t *testing.T) {
	_, cfg := newTurnRegistry(t)
	registry := assembly.NewHarnessRegistry(cfg)
	if registry.UsageFor(harnessapi.HarnessMuse) == nil {
		t.Fatal("the Muse harness should answer the quota port")
	}
	if _, ok := registry.UsageFor(harnessapi.HarnessMuse).(harnessapi.HarnessUsageRefresh); !ok {
		t.Fatal("the Muse harness should answer the refresh port: its quota has no stateless read")
	}
}
