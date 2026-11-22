package pi

import (
	"encoding/json"
	"kiao/worker/internal/core/equipment"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiProfilesRejectUnsupportedInstallations(t *testing.T) {
	for _, scenario := range []struct{ version, protocol string }{
		{"1.2.0", "pi-rpc-1.3"},
		{"1.3.0", "pi-rpc-1.3"},
		{"1.3.0", equipment.PiRPCProtocol},
		{equipment.PiVersion, "pi-rpc-1.3"},
		{"latest", equipment.PiRPCProtocol},
	} {
		t.Run(scenario.version+"/"+scenario.protocol, func(t *testing.T) {
			_, profiles, _, _ := piTestSetup(t, "")
			before := mustRead(t, profiles.path())
			doc, err := profiles.ReadProfiles()
			if err != nil {
				t.Fatal(err)
			}
			doc.Installations[0].Version = scenario.version
			doc.Installations[0].Protocol = scenario.protocol
			if err := profiles.WriteProfiles(doc); err == nil || !strings.Contains(err.Error(), equipment.PiVersion) {
				t.Fatalf("unsupported installation was not refused: %v", err)
			}
			if after := mustRead(t, profiles.path()); after != before {
				t.Fatal("refused installation changed the stored profiles")
			}
			if installations := profiles.Installations(doc); len(installations) != 0 {
				t.Fatalf("unsupported installations offered: %+v", installations)
			}
		})
	}
}

func TestPiProfileUpgradeRequiresSelectingTheQualifiedInstallation(t *testing.T) {
	cfg, profiles, _, _ := piTestSetup(t, "")
	doc, err := profiles.ReadProfiles()
	if err != nil {
		t.Fatal(err)
	}
	installation := doc.Installations[0]
	installation.ID, installation.External = "pi-"+equipment.PiVersion, false
	cfg.PiInstallations = func() []equipment.HarnessInstallation { return []equipment.HarnessInstallation{installation} }
	doc.Installations = nil
	doc.Profiles[0].InstallationID = "pi-1.3.0"
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.ResolveProfile("work", "", ""); err == nil || !strings.Contains(err.Error(), "pi-1.3.0") {
		t.Fatalf("profile silently switched installation: %v", err)
	}
	doc.Profiles[0].InstallationID = installation.ID
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	resolved, err := profiles.ResolveProfile("work", "", "")
	if err != nil || resolved.Installation.Version != equipment.PiVersion || resolved.Profile.DefaultModel != doc.Profiles[0].DefaultModel {
		t.Fatalf("profile did not retain its settings after selecting Pi: %+v %v", resolved, err)
	}
}

func TestPiRejectsAnExternalExecutableWithAnOlderVersion(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "old-pi")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nprintf '1.3.0\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg, profiles, _, meta := piTestSetup(t, binary)
	driver := NewPiHarness(cfg, profiles).Driver()
	if err := driver.Spawn(piTestRun(cfg, meta, "test")); err == nil || !strings.Contains(err.Error(), "version differs") {
		t.Fatalf("an older external executable started: %v", err)
	}
}

func TestPiThinkingLevelMapIsDeclaredToPi(t *testing.T) {
	_, profiles, _, _ := piTestSetup(t, "")
	doc, err := profiles.ReadProfiles()
	if err != nil {
		t.Fatal(err)
	}
	doc.Profiles[0].Connections[0].Models[0].ThinkingLevelMap = map[string]any{"minimal": nil, "low": "low", "medium": nil, "high": "high", "max": "max"}
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	resolved, err := profiles.ResolveProfile("work", "", "")
	if err != nil {
		t.Fatal(err)
	}
	dir, _, _, err := materializePi(resolved, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	var written struct {
		Providers map[string]struct{ Models []harnessapi.PiModel } `json:"providers"`
	}
	if err := json.Unmarshal([]byte(mustRead(t, filepath.Join(dir, "models.json"))), &written); err != nil {
		t.Fatal(err)
	}
	levels := written.Providers["openai"].Models[0].ThinkingLevelMap
	value, present := levels["minimal"]
	if len(levels) != 5 || !present || value != nil || levels["max"] != "max" || levels["high"] != "high" {
		t.Fatalf("thinking levels missing from Pi's models.json: %v", levels)
	}
}

func TestPiThinkingLevelMapRejectsUnsupportedDeclarations(t *testing.T) {
	for _, levels := range []map[string]any{
		{"ultra": "ultra"},
		{"max": 3},
		{"max": true},
	} {
		_, profiles, _, _ := piTestSetup(t, "")
		doc, err := profiles.ReadProfiles()
		if err != nil {
			t.Fatal(err)
		}
		doc.Profiles[0].Connections[0].Models[0].ThinkingLevelMap = levels
		if err := profiles.WriteProfiles(doc); err == nil || !strings.Contains(err.Error(), "thinkingLevelMap") {
			t.Fatalf("accepted %v: %v", levels, err)
		}
	}
}
