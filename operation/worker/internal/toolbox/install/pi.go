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
	"sort"
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

// Official, pinned npm install manifests from the releases, checked against SHA256SUMS.
// npm ci verifies every dependency's integrity; no install scripts or unpinned npm resolution.
//
//go:embed pi/*.json
var piManifests embed.FS

var piReleases = map[string]struct{ Package, Lock, PackageSHA, LockSHA string }{
	"1.3.0": {"pi-coding-agent-install-package.json", "pi-coding-agent-install-package-lock.json", "efa2ca2695c003c92febb3bca40c5de5f94d43a8aa78e1ba88420b30156d5e21", "65eacda789c30e1c3859a96eee2fd53cf4a18629d27dcf2aa6d7bdb3da02d719"},
	"1.2.0": {"package-1.2.0.json", "package-lock-1.2.0.json", "327c418cefe84e2670beb748a56de0cd08c2c557d5f7c03897dfe0e489c3480e", "bc9ff0d86d27b10771bdc9c27a1620e4817e1f2749e817245af95809eabf63c3"},
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
	release, ok := piReleases[recipe.Version]
	if !ok {
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
	for _, asset := range []struct{ name, dest, sha string }{{release.Package, "package.json", release.PackageSHA}, {release.Lock, "package-lock.json", release.LockSHA}} {
		data, err := verifiedPiManifest(asset.name, asset.sha)
		if err != nil {
			return "", "", err
		}
		if err := os.WriteFile(filepath.Join(stage, asset.dest), data, 0o644); err != nil {
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

// AgentInstallations is a runner port. Discover version directories on each query, including
// image-preinstalled copies whose staging prefix differs from this running prefix.
func (s *Service) AgentInstallations() []equipment.AgentInstallation {
	var installations []equipment.AgentInstallation
	seen := map[string]bool{}
	for _, root := range []string{s.cfg.Prefix, s.cfg.BundledPath} {
		if root == "" {
			continue
		}
		for version := range piReleases {
			path := filepath.Join(root, "pi", version, "bin", "pi")
			if !seen[version] && filesystem.FileExists(path) {
				installations = append(installations, equipment.AgentInstallation{ID: "pi-" + version, Engine: "pi", Version: version, Path: path, Protocol: "pi-rpc-1.3"})
				seen[version] = true
			}
		}
	}
	sort.Slice(installations, func(i, j int) bool { return installations[i].ID > installations[j].ID })
	return installations
}

func (s *Service) OnAgentInstallationRemoval(check func(id string) []string) {
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
