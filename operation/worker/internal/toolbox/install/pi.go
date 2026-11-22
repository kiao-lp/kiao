package install

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// The image build runs this same check against its own Alpine Node runtime.
//
//go:embed pi/kiao-node-check.cjs
var piNodeCheck string

const piLauncher = `#!/bin/sh
pi_node="$(dirname "$0")/../../../node/bin/node"
if [ ! -x "$pi_node" ]; then pi_node=node; fi
exec "$pi_node" --require "$(dirname "$0")/../kiao-node-check.cjs" "$(dirname "$0")/../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" "$@"
`

func writePiLauncher(command string) error {
	if err := filesystem.WriteFileAtomic(filepath.Join(filepath.Dir(command), "..", "kiao-node-check.cjs"), []byte(piNodeCheck), 0o644); err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(command, []byte(piLauncher), 0o755)
}

// Official, pinned npm install manifests checked against the release's SHA256SUMS.
// npm ci verifies every dependency's integrity; no install scripts or unpinned npm resolution.
//
//go:embed pi/pi-coding-agent-install-package.json pi/pi-coding-agent-install-package-lock.json
var piManifests embed.FS

var piInstallManifests = [...]struct{ name, destination, sha256 string }{
	{"pi-coding-agent-install-package.json", "package.json", "6c433244d03aa280f1aa298035ba59f54afd0c486566771ef83cc5aef318c4cc"},
	{"pi-coding-agent-install-package-lock.json", "package-lock.json", "57e3b475e52f630cf903f73b0d2a02c405875af61ce4a845f481dcc798f58005"},
}

func verifiedPiManifest(name, expected string) ([]byte, error) {
	data, err := piManifests.ReadFile("pi/" + name)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != expected {
		return nil, fmt.Errorf("Pi install manifest integrity mismatch: %s", name)
	}
	return data, nil
}

func piNodeCompatible(version string) bool {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(version), "v"), ".")
	if len(parts) < 2 {
		return false
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	return majorErr == nil && minorErr == nil && (major >= 24 || (major == 23 && minor >= 8) || (major == 22 && minor >= 19))
}

func (in *installer) installPiCLI(recipe toolcatalog.Recipe) (string, string, error) {
	if recipe.Version != equipment.PiVersion {
		return "", "", fmt.Errorf("Pi %s has not passed RPC qualification", recipe.Version)
	}
	npm, err := in.npmCommand()
	if err != nil {
		return "", "", err
	}
	// A cross-target build stages portable npm files, never the host's Node.
	// Qualify the image's runtime in the Dockerfile and again in the launcher.
	stagingForTarget := in.cfg.Target != "" && in.cfg.Target != toolconfig.DetectPlatform()
	if !stagingForTarget {
		node := filepath.Join(in.cfg.NodeDir(), "bin", "node")
		if !filesystem.FileExists(node) {
			node = "node"
		}
		version, err := in.output([]string{node, "--version"})
		if err != nil {
			return "", "", err
		}
		if !piNodeCompatible(version) {
			return "", "", fmt.Errorf("Pi requires Node.js 22.19+, 23.8+ or 24+ with Zstandard support; found %s. Install or update Node.js LTS in Configuration", strings.TrimSpace(version))
		}
		if _, err := in.output([]string{node, "--eval", piNodeCheck}); err != nil {
			return "", "", err
		}
	}
	target := filepath.Join(in.cfg.Prefix, "pi", recipe.Version)
	command := filepath.Join(target, "bin", "pi")
	if filesystem.FileExists(command) {
		cached := false
		if stagingForTarget {
			// Cached target executables need not run on the build host.
			module := filepath.Join(target, "node_modules", "@earendil-works", "pi-coding-agent")
			data, err := os.ReadFile(filepath.Join(module, "package.json"))
			var pkg struct{ Version string }
			cached = err == nil && json.Unmarshal(data, &pkg) == nil && pkg.Version == recipe.Version && filesystem.FileExists(filepath.Join(module, "dist", "bundle", "cli.js"))
		} else {
			current, err := in.output([]string{command, "--version"})
			cached = err == nil && strings.TrimSpace(current) == recipe.Version
		}
		if cached {
			if err := writePiLauncher(command); err != nil {
				return "", "", err
			}
			return command, recipe.Version, nil
		}
	}
	root := filepath.Dir(target)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", "", err
	}
	stage, err := os.MkdirTemp(root, ".install-")
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(stage)
	for _, asset := range piInstallManifests {
		data, err := verifiedPiManifest(asset.name, asset.sha256)
		if err != nil {
			return "", "", err
		}
		if err := os.WriteFile(filepath.Join(stage, asset.destination), data, 0o644); err != nil {
			return "", "", err
		}
	}
	if err := in.run(append(npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", stage), stage); err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Join(stage, "bin"), 0o755); err != nil {
		return "", "", err
	}
	if err := writePiLauncher(filepath.Join(stage, "bin", "pi")); err != nil {
		return "", "", err
	}
	backup := ""
	if _, err := os.Stat(target); err == nil {
		backup = stage + "-previous"
		if err := os.Rename(target, backup); err != nil {
			return "", "", err
		}
	}
	if err := os.Rename(stage, target); err != nil {
		if backup != "" {
			_ = os.Rename(backup, target)
		}
		return "", "", err
	}
	if backup != "" {
		_ = os.RemoveAll(backup)
	}
	in.log.printf("installed Pi %s at %s", recipe.Version, command)
	return command, recipe.Version, nil
}

// HarnessInstallations resolves the qualified runtime, preferring the writable toolbox.
func (s *Service) HarnessInstallations() []equipment.HarnessInstallation {
	for _, root := range []string{s.cfg.Prefix, s.cfg.BundledPath} {
		if root == "" {
			continue
		}
		path := filepath.Join(root, "pi", equipment.PiVersion, "bin", "pi")
		if filesystem.FileExists(path) {
			return []equipment.HarnessInstallation{{ID: "pi-" + equipment.PiVersion, Engine: "pi", Version: equipment.PiVersion, Path: path, Protocol: equipment.PiRPCProtocol}}
		}
	}
	return nil
}

func (s *Service) OnHarnessInstallationRemoval(check func(id string) []string) {
	s.installationRemoval = check
}

func (s *Service) piRemovalRefusal(version string) error {
	if s.installationRemoval != nil {
		if profiles := s.installationRemoval("pi-" + version); len(profiles) > 0 {
			return faults.Invalid("Pi version is used by: " + strings.Join(profiles, ", ") + ". Select another installation in these profiles before removing it")
		}
	}
	return nil
}
