package toolbox

import (
	"runtime"
	"testing"
)

// The opencode channel: the asset naming, per platform and per libc.

// The releases spell assets `opencode-<os>-<arch>[-musl].tar.gz`, and the libc comes from the
// target platform rather than from this machine — the image is Alpine and is staged from a glibc
// host, for the reason claudeTarget gives.
func TestOpenCodeTargetNamesTheReleaseAsset(t *testing.T) {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("the naming is per platform; this asserts the one the image is built on")
	}
	if got, _ := opencodeTarget(platformDebian); got != "opencode-linux-x64.tar.gz" {
		t.Errorf("glibc got %q, want opencode-linux-x64.tar.gz", got)
	}
	if got, _ := opencodeTarget(platformAlpine); got != "opencode-linux-x64-musl.tar.gz" {
		t.Errorf("alpine got %q, want opencode-linux-x64-musl.tar.gz", got)
	}
}

// The catalogue entry the panel installs from: the channel above, recognised by the binary.
func TestOpenCodeCatalogueEntryIsTheChannel(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	comp, ok := catalog.Get("opencode-cli")
	if !ok {
		t.Fatal("the catalogue declares no opencode-cli")
	}
	if comp.Agent != "opencode" {
		t.Errorf("agent = %q, want opencode", comp.Agent)
	}
	recipe, ok := comp.RecipeFor(platformGeneric)
	if !ok {
		t.Fatal("opencode-cli has no generic recipe, so no machine can install it")
	}
	if recipe.Channel != channelOpenCodeRelease || recipe.Bin != "opencode" {
		t.Errorf("recipe = %+v, want the opencode-release channel recognised by opencode", recipe)
	}
}
