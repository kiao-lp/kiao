package cli

import (
	"io"
	coreconfig "kiao/worker/internal/core/config"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"kiao/worker/internal/toolbox/install"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The four agent CLIs are catalogue components like any other. This is the rule the panel depends on
// — a row per CLI, recognised by a binary — and the one the build script depends on: `preinstall
// claude-cli` has to name something.
func TestTheAgentCLIsAreRuntimesWithABinary(t *testing.T) {
	catalog, err := toolcatalog.LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for id, bin := range map[string]string{
		"claude-cli": "claude", "codex-cli": "codex", "muse-cli": "muse", "opencode-cli": "opencode",
	} {
		comp, ok := catalog.Get(id)
		if !ok {
			t.Errorf("the catalogue declares no %s", id)
			continue
		}
		if comp.Kind != toolcatalog.KindRuntime {
			t.Errorf("%s is a %q; a CLI on the machine is a runtime", id, comp.Kind)
		}
		recipe, ok := comp.RecipeFor(toolcatalog.PlatformGeneric)
		if !ok {
			t.Errorf("%s has no generic recipe, so no machine can install it", id)
			continue
		}
		if recipe.Bin != bin {
			t.Errorf("%s is recognised by %q, want %q", id, recipe.Bin, bin)
		}
	}
}

// The libc comes from the target, not from the machine: this is the whole of what lets a glibc
// build host stage an Alpine image, and getting it wrong produces an image whose CLI cannot start.
func TestClaudeTargetTakesItsLibcFromThePlatform(t *testing.T) {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("the naming is per platform; this asserts the one the image is built on")
	}
	if got, _ := install.ClaudeTarget(toolcatalog.PlatformAlpine); got != "linux-x64-musl" {
		t.Errorf("alpine got %q, want linux-x64-musl", got)
	}
	if got, _ := install.ClaudeTarget(toolcatalog.PlatformDebian); got != "linux-x64" {
		t.Errorf("debian got %q, want linux-x64", got)
	}
	// Codex publishes one static build for every Linux, which is why its driver reads no platform
	// at all — and why staging it for the image needs nothing said.
	if got, _ := install.CodexTarget(); got != "x86_64-unknown-linux-musl" {
		t.Errorf("codex got %q, want x86_64-unknown-linux-musl", got)
	}
}

// Target is what makes a prefix belong to a platform that is not this one. Nothing reads it from
// the environment, so this is the only way it is ever set.
func TestTargetOverridesTheDetectedPlatform(t *testing.T) {
	if got := (&toolconfig.Config{}).Platform(); got != toolconfig.DetectPlatform() {
		t.Errorf("no target got %q, want this machine's %q", got, toolconfig.DetectPlatform())
	}
	if got := (&toolconfig.Config{Target: toolcatalog.PlatformAlpine}).Platform(); got != toolcatalog.PlatformAlpine {
		t.Errorf("target alpine got %q", got)
	}
}

// `id@version` is what `--claude-version` became: said on the component rather than as a flag per
// component in every build script.
func TestParseWantedReadsThePin(t *testing.T) {
	if w := install.ParseWanted("claude-cli"); w.Id != "claude-cli" || w.Version != "" {
		t.Errorf("unpinned read as %+v", w)
	}
	if w := install.ParseWanted("claude-cli@2.1.259"); w.Id != "claude-cli" || w.Version != "2.1.259" {
		t.Errorf("pinned read as %+v", w)
	}
}

// A mistyped id is refused before anything is downloaded, and the refusal says what there was.
func TestPreinstallRefusesAnUnknownComponent(t *testing.T) {
	prefix := t.TempDir()
	cfg := &toolconfig.Config{Config: &coreconfig.Config{}, Prefix: prefix}

	if err := install.Preinstall(cfg, []string{"claude-code"}, false, io.Discard); err == nil {
		t.Fatal("an unknown id was accepted")
	}
	// And nothing was created on the way to finding that out.
	if _, err := os.Stat(filepath.Join(prefix, "bin")); err == nil {
		t.Error("the prefix was laid out for an install that could never run")
	}
}
