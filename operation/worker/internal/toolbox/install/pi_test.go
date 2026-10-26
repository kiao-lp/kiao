package install

import (
	"encoding/json"
	"io"
	coreconfig "kiao/worker/internal/core/config"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiPinnedManifestsAndMinimumNode(t *testing.T) {
	for version, release := range piReleases {
		data, err := verifiedPiManifest(release.Package, release.PackageSHA)
		if err != nil {
			t.Fatal(err)
		}
		var pkg struct {
			Dependencies map[string]string `json:"dependencies"`
		}
		if json.Unmarshal(data, &pkg) != nil {
			t.Fatal("bad package manifest")
		}
		if pkg.Dependencies["@earendil-works/pi-coding-agent"] != version {
			t.Fatalf("unlocked Pi %s", version)
		}
		if _, err := verifiedPiManifest(release.Lock, release.LockSHA); err != nil {
			t.Fatal(err)
		}
	}
	for version, want := range map[string]bool{"v22.18.0": false, "v22.19.0": true, "v23.6.0": false, "v23.7.0": false, "v23.8.0": true, "v24.0.0": true, "v20.19.0": false, "v24.invalid.0": false} {
		if piNodeCompatible(version) != want {
			t.Fatalf("Node %s", version)
		}
	}
	if _, err := verifiedPiManifest(piReleases["1.3.0"].Package, "invalid"); err == nil {
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
		script := `Object.defineProperty(process.versions, "node", {value: "` + scenario.version + `"}); require("node:zlib").createZstdDecompress = ` + scenario.zstd + ";\n" + piNodeCheck
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
	command := filepath.Join(root, "pi", "1.3.0", "bin", "pi")
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
	guard, err := os.ReadFile(filepath.Join(root, "pi", "1.3.0", "kiao-node-check.cjs"))
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
printf '{"version":"1.3.0"}\n' > "$pi_stage/node_modules/@earendil-works/pi-coding-agent/package.json"
printf 'console.log("1.3.0");\n' > "$pi_stage/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
`
			if err := os.WriteFile(filepath.Join(tools, "npm"), []byte(npm), 0o755); err != nil {
				t.Fatal(err)
			}
			prefix := filepath.Join(root, "target")
			command := filepath.Join(prefix, "pi", "1.3.0", "bin", "pi")
			if cached {
				module := filepath.Join(prefix, "pi", "1.3.0", "node_modules", "@earendil-works", "pi-coding-agent")
				for path, contents := range map[string]string{
					command:                               "#!/bin/sh\nexit 99\n", // A target executable need not run here.
					filepath.Join(module, "package.json"): `{"version":"1.3.0"}`,
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
			guard, err := os.ReadFile(filepath.Join(prefix, "pi", "1.3.0", "kiao-node-check.cjs"))
			if err != nil || string(guard) != piNodeCheck {
				t.Fatalf("target runtime guard was not staged: %v", err)
			}
			launcher, err := os.ReadFile(command)
			if err != nil || string(launcher) != piLauncher {
				t.Fatalf("target launcher was not refreshed: %v", err)
			}
			// The same host must still be refused when installing Pi to run here.
			cfg.Target = ""
			_, _, err = newInstaller(cfg, &jobLog{}).installPiCLI(toolcatalog.Recipe{Version: "1.3.0"})
			if err == nil || !strings.Contains(err.Error(), "found v23.6.0") {
				t.Fatalf("native installation accepted an incompatible Node: %v", err)
			}
		})
	}
}

func TestPiInstallationsAreVersionedAndRemovalNamesProfiles(t *testing.T) {
	root := t.TempDir()
	state := t.TempDir()
	cfg := &toolconfig.Config{Config: &coreconfig.Config{StatePath: state}, Prefix: root, BundledPath: t.TempDir()}
	for i, version := range []string{"1.3.0", "1.2.0"} {
		prefix := root
		if i == 1 {
			prefix = cfg.BundledPath
		}
		path := filepath.Join(prefix, "pi", version, "bin", "pi")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	service, err := Start(cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	installations := service.AgentInstallations()
	if len(installations) != 2 || installations[0].Path == installations[1].Path {
		t.Fatal("Pi versions were conflated")
	}
	service.OnAgentInstallationRemoval(func(id string) []string {
		if id == "pi-1.3.0" {
			return []string{"Pi work", "Pi review"}
		}
		return nil
	})
	if _, err := service.Uninstall([]string{"pi-cli"}); err == nil {
		t.Fatal("used version was removed")
	}
	if _, err := os.Stat(installations[0].Path); err != nil {
		t.Fatal("profile data or executable removed during refusal")
	}
}
