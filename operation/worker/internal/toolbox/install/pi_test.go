package install

import (
	"encoding/json"
	"io"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/equipment"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"kiao/worker/internal/toolbox/inventory"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiPinnedManifestsAndMinimumNode(t *testing.T) {
	catalog, err := toolcatalog.LoadCatalog("")
	if err != nil {
		t.Fatal(err)
	}
	qualified := 0
	for _, comp := range catalog.All() {
		if recipe, ok := comp.RecipeFor(toolcatalog.PlatformGeneric); ok && recipe.Channel == toolcatalog.ChannelPiRelease {
			qualified++
			if comp.ID != "pi-cli" || recipe.Version != equipment.PiVersion {
				t.Fatalf("unexpected Pi catalogue entry: %+v", comp)
			}
		}
	}
	if qualified != 1 {
		t.Fatalf("expected one qualified Pi release, got %d", qualified)
	}
	for _, asset := range piInstallManifests {
		data, err := verifiedPiManifest(asset.name, asset.sha256)
		if err != nil {
			t.Fatal(err)
		}
		if asset.destination == "package.json" {
			var pkg struct {
				Version      string            `json:"version"`
				Dependencies map[string]string `json:"dependencies"`
			}
			if json.Unmarshal(data, &pkg) != nil || pkg.Version != equipment.PiVersion || pkg.Dependencies["@earendil-works/pi-coding-agent"] != equipment.PiVersion {
				t.Fatal("Pi package manifest does not pin the supported runtime")
			}
		}
	}
	for version, want := range map[string]bool{"v22.18.0": false, "v22.19.0": true, "v23.6.0": false, "v23.7.0": false, "v23.8.0": true, "v24.0.0": true, "v20.19.0": false, "v24.invalid.0": false} {
		if piNodeCompatible(version) != want {
			t.Fatalf("Node %s", version)
		}
	}
	if _, err := verifiedPiManifest(piInstallManifests[0].name, "invalid"); err == nil {
		t.Fatal("integrity mismatch accepted")
	}
}

func TestPiNodeGuardChecksTheSelectedRuntime(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is not installed")
	}
	for _, scenario := range []struct {
		version, zstd string
		valid         bool
	}{
		{"23.6.0", "() => {}", false},
		{"24.0.0", "undefined", false},
		{"22.19.0", "() => {}", true},
		{"24.0.0", "() => {}", true},
	} {
		script := `Object.defineProperty(process.versions, "node", {value: "` + scenario.version + `"}); Object.defineProperty(require("node:zlib"), "createZstdDecompress", {value: ` + scenario.zstd + "});\n" + piNodeCheck
		output, err := exec.Command(node, "--eval", script).CombinedOutput()
		if scenario.valid && err != nil {
			t.Fatalf("valid runtime rejected: %s", output)
		}
		if !scenario.valid && (err == nil || !strings.Contains(string(output), "Install or update Node.js LTS")) {
			t.Fatalf("incompatible runtime accepted: %s", output)
		}
	}
}

func TestPiLauncherPrefersItsManagedNodeAndPreservesArguments(t *testing.T) {
	root := filepath.Join(t.TempDir(), "toolbox with spaces")
	command := filepath.Join(root, "pi", "1.5.2", "bin", "pi")
	node := filepath.Join(root, "node", "bin", "node")
	for _, path := range []string{command, node} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(node, []byte("#!/bin/sh\nprintf '%s\\n' managed-node \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writePiLauncher(command); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command(command, "--mode", "rpc", "an argument with spaces").CombinedOutput()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(output), "managed-node\n--require\n") || !strings.HasSuffix(string(output), "--mode\nrpc\nan argument with spaces\n") {
		t.Fatalf("launcher changed runtime or arguments: %s", output)
	}
	guard, err := os.ReadFile(filepath.Join(root, "pi", "1.5.2", "kiao-node-check.cjs"))
	if err != nil || string(guard) != piNodeCheck {
		t.Fatalf("runtime guard missing: %v", err)
	}
}

func TestPiCrossTargetStagingDoesNotQualifyTheHostRuntime(t *testing.T) {
	for _, cached := range []bool{false, true} {
		name := "fresh"
		if cached {
			name = "cached"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			tools := filepath.Join(root, "host-tools")
			if err := os.MkdirAll(tools, 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", tools+string(os.PathListSeparator)+os.Getenv("PATH"))
			nodeCalled := filepath.Join(root, "host-node-called")
			t.Setenv("KIAO_TEST_PI_NODE_CALLED", nodeCalled)
			// This Node can stage npm files but cannot run Pi's HTTP client.
			if err := os.WriteFile(filepath.Join(tools, "node"), []byte("#!/bin/sh\necho called > \"$KIAO_TEST_PI_NODE_CALLED\"\nprintf 'v23.6.0\\n'\n"), 0o755); err != nil {
				t.Fatal(err)
			}
			npm := `#!/bin/sh
while [ "$#" -gt 0 ]; do
    if [ "$1" = --prefix ]; then shift; pi_stage="$1"; fi
    shift
done
mkdir -p "$pi_stage/node_modules/@earendil-works/pi-coding-agent/dist/bundle"
printf '{"version":"1.5.2"}\n' > "$pi_stage/node_modules/@earendil-works/pi-coding-agent/package.json"
printf 'console.log("1.5.2");\n' > "$pi_stage/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
`
			if err := os.WriteFile(filepath.Join(tools, "npm"), []byte(npm), 0o755); err != nil {
				t.Fatal(err)
			}
			prefix := filepath.Join(root, "target")
			command := filepath.Join(prefix, "pi", "1.5.2", "bin", "pi")
			if cached {
				module := filepath.Join(prefix, "pi", "1.5.2", "node_modules", "@earendil-works", "pi-coding-agent")
				for path, contents := range map[string]string{
					command:                               "#!/bin/sh\nexit 99\n", // A target executable need not run here.
					filepath.Join(module, "package.json"): `{"version":"1.5.2"}`,
					filepath.Join(module, "dist", "bundle", "cli.js"): "",
				} {
					if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte(contents), 0o755); err != nil {
						t.Fatal(err)
					}
				}
			}
			target := toolcatalog.PlatformAlpine
			if target == toolconfig.DetectPlatform() {
				target = toolcatalog.PlatformDebian
			}
			cfg := &toolconfig.Config{Config: &coreconfig.Config{}, Prefix: prefix, Target: target}
			if err := Preinstall(cfg, []string{"pi-cli"}, false, io.Discard); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(nodeCalled); !os.IsNotExist(err) {
				t.Fatal("cross-target build tried to qualify the host Node")
			}
			guard, err := os.ReadFile(filepath.Join(prefix, "pi", "1.5.2", "kiao-node-check.cjs"))
			if err != nil || string(guard) != piNodeCheck {
				t.Fatalf("target runtime guard was not staged: %v", err)
			}
			launcher, err := os.ReadFile(command)
			if err != nil || string(launcher) != piLauncher {
				t.Fatalf("target launcher was not refreshed: %v", err)
			}
			// The same host must still be refused when installing Pi to run here.
			cfg.Target = ""
			_, _, err = newInstaller(cfg, &jobLog{}).installPiCLI(toolcatalog.Recipe{Version: "1.5.2"})
			if err == nil || !strings.Contains(err.Error(), "found v23.6.0") {
				t.Fatalf("native installation accepted an incompatible Node: %v", err)
			}
		})
	}
}

func TestPiInstallationsPreferWritableRuntimeAndIgnoreUnsupportedVersions(t *testing.T) {
	root := t.TempDir()
	state := t.TempDir()
	cfg := &toolconfig.Config{Config: &coreconfig.Config{StatePath: state}, Prefix: root, BundledPath: t.TempDir()}
	write := func(prefix, version string) string {
		t.Helper()
		path := filepath.Join(prefix, "pi", version, "bin", "pi")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	for _, prefix := range []string{root, cfg.BundledPath} {
		write(prefix, "1.2.0")
		write(prefix, "1.3.0")
	}
	service, err := Start(cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if installations := service.HarnessInstallations(); len(installations) != 0 {
		t.Fatalf("unsupported installations offered: %+v", installations)
	}
	bundled := write(cfg.BundledPath, equipment.PiVersion)
	check := func(path string) {
		t.Helper()
		installations := service.HarnessInstallations()
		if len(installations) != 1 || installations[0].Path != path || installations[0].Version != equipment.PiVersion || installations[0].Protocol != equipment.PiRPCProtocol {
			t.Fatalf("unexpected Pi installations: %+v", installations)
		}
	}
	check(bundled)
	writable := write(root, equipment.PiVersion)
	check(writable)
	service.OnHarnessInstallationRemoval(func(id string) []string {
		if id == "pi-"+equipment.PiVersion {
			return []string{"Pi work", "Pi review"}
		}
		return nil
	})
	if _, err := service.Uninstall([]string{"pi-cli"}); err == nil || !strings.Contains(err.Error(), "Pi work, Pi review") {
		t.Fatalf("removal did not identify the profiles using Pi: %v", err)
	}
	if _, err := os.Stat(writable); err != nil {
		t.Fatal("profile data or executable removed during refusal")
	}
	if err := os.Remove(writable); err != nil {
		t.Fatal(err)
	}
	check(bundled)
}

func TestPiInstallerRejectsUnsupportedVersions(t *testing.T) {
	for _, version := range []string{"1.2.0", "1.3.0", "latest"} {
		t.Run(version, func(t *testing.T) {
			in := newInstaller(&toolconfig.Config{}, &jobLog{})
			if _, _, err := in.installPiCLI(toolcatalog.Recipe{Version: version}); err == nil || !strings.Contains(err.Error(), "has not passed RPC qualification") {
				t.Fatalf("unsupported Pi installation: %v", err)
			}
		})
	}
}

func TestPiOutdatedLedgerOffersInstallationOfTheSupportedRuntime(t *testing.T) {
	for _, version := range []string{"1.2.0", "1.3.0"} {
		t.Run(version, func(t *testing.T) {
			cfg := &toolconfig.Config{Config: &coreconfig.Config{StatePath: t.TempDir()}, Prefix: t.TempDir()}
			service, err := Start(cfg, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := service.ledger.Put("pi-cli", inventory.Entry{Installed: true, Version: version}); err != nil {
				t.Fatal(err)
			}
			comp, _ := service.catalog.Get("pi-cli")
			row := service.rowFor(comp, toolcatalog.PlatformGeneric, nil)
			if row.State != StateMissing || !strings.Contains(row.Reason, equipment.PiVersion) {
				t.Fatalf("older Pi installation hides the upgrade: %+v", row)
			}
		})
	}
}

func TestPiUninstallOnlyRemovesTheRecordedQualifiedRuntime(t *testing.T) {
	prefix := t.TempDir()
	command := filepath.Join(prefix, "pi", equipment.PiVersion, "bin", "pi")
	if err := os.MkdirAll(filepath.Dir(command), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(command, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	in := newInstaller(&toolconfig.Config{Prefix: prefix}, &jobLog{})
	recipe := toolcatalog.Recipe{Channel: toolcatalog.ChannelPiRelease, Version: equipment.PiVersion}
	for _, version := range []string{"1.2.0", "1.3.0"} {
		if err := in.uninstall(toolcatalog.Component{}, recipe, inventory.Entry{Version: version}); err == nil {
			t.Fatalf("Pi %s ledger entry removed a different runtime", version)
		}
		if _, err := os.Stat(command); err != nil {
			t.Fatal("qualified runtime was removed by an outdated ledger entry")
		}
	}
	if err := in.uninstall(toolcatalog.Component{}, recipe, inventory.Entry{Version: equipment.PiVersion}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(command); !os.IsNotExist(err) {
		t.Fatal("qualified runtime was not removed")
	}
}
