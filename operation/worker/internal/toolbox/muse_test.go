package toolbox

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// The muse channel: the platform naming, the pin rewriting, and the whole install against a local
// server standing in for the channel — the layout it produces is the launcher's own, and the test
// asserts every file of it.

// The manifest spells platforms `arch_os`, and Linux is one entry for every distribution: the
// binary is statically linked, so there is no libc to take from the platform.
func TestMuseTargetNamesTheManifestEntry(t *testing.T) {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("the naming is per platform; this asserts the one the image is built on")
	}
	if got, _ := museTarget(); got != "x86_linux" {
		t.Errorf("muse got %q, want x86_linux", got)
	}
}

// A pin rewrites the version the channel's manifest URL names; the current release reads the
// channel's URL as it stands. Either way the manifest names the version it is of, so a rewrite the
// server answered with anything else is refused by the caller.
func TestMuseManifestURLRewritesThePin(t *testing.T) {
	channel := "https://example.test/download/?channel=muse&version=9.9&file=manifest.json"
	if got, err := museManifestURL(channel, "1.1.1-R2514.1"); err != nil ||
		!strings.Contains(got, "version=1.1.1-R2514.1") || !strings.Contains(got, "file=manifest.json") {
		t.Errorf("pinned = %q/%v, want the channel's URL with the version rewritten", got, err)
	}
	// The current release sets the version it already names: the query may be re-encoded, but it
	// still says the same thing.
	if got, err := museManifestURL(channel, "9.9"); err != nil ||
		!strings.Contains(got, "version=9.9") || !strings.Contains(got, "file=manifest.json") {
		t.Errorf("current = %q/%v, want the channel's URL still naming its own release", got, err)
	}
	if _, err := museManifestURL("", "1.0"); err == nil {
		t.Error("an empty channel URL must be refused rather than fetched")
	}
}

// museChannel serves a channel document, a manifest, an artifact and a launcher: the four answers
// an install reads.
func museChannel(t *testing.T, version string) *httptest.Server {
	t.Helper()
	artifact := []byte("#!/bin/sh\necho muse-stub\n")
	digest := sha256.Sum256(artifact)
	launcher := []byte("#!/usr/bin/env bash\necho launcher-stub\n")
	launcherDigest := sha256.Sum256(launcher)
	mux := http.NewServeMux()
	var server *httptest.Server
	mux.HandleFunc("/channels/muse-stable", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"channel":"muse-stable","version":%q,"manifest_url":%q}`,
			version, server.URL+"/download/?channel=muse&version="+version+"&file=manifest.json")
	})
	mux.HandleFunc("/download/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("file") != "manifest.json" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprintf(w, `{"version":%q,"checksum_algorithm":"sha256","artifacts":{%q:{"url":%q,"checksum":%q,"size":%d}}}`,
			r.URL.Query().Get("version"), "x86_linux",
			server.URL+"/artifact", hex.EncodeToString(digest[:]), len(artifact))
	})
	mux.HandleFunc("/artifact", func(w http.ResponseWriter, r *http.Request) {
		w.Write(artifact)
	})
	mux.HandleFunc("/muse-launcher.sh", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-content-sha256", hex.EncodeToString(launcherDigest[:]))
		w.Write(launcher)
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)
	museChannelURL = server.URL + "/channels/muse-stable"
	museLauncherURL = server.URL + "/muse-launcher.sh"
	t.Cleanup(func() {
		museChannelURL = "https://api.meta.ai/muse-code/channels/muse-stable"
		museLauncherURL = "https://api.meta.ai/muse-launcher.sh"
	})
	return server
}

// The whole install: the launcher's directory laid out as the launcher expects it — the script,
// the versioned binary, the version file — and bin/muse linked at it. Target is set so the staged
// binary is never run to be asked its version, which is exactly how the image build stages it.
func TestInstallMuseCLILaysOutTheLaunchersDirectory(t *testing.T) {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("the fixture serves the x86_linux artifact")
	}
	museChannel(t, "1.1.1-R2514.1")
	prefix := t.TempDir()
	cfg := &Config{Config: &core.Config{}, Prefix: prefix, Target: platformAlpine}
	if err := cfg.ensureLayout(); err != nil {
		t.Fatalf("ensureLayout: %v", err)
	}
	in := newInstaller(cfg, &jobLog{})

	entry, err := in.install(compileMuseComponent(t), Recipe{Channel: channelMuseRelease})
	if err != nil {
		t.Fatalf("install = %v\n%s", err, in.log.String())
	}
	if entry.Version != "1.1.1-R2514.1" {
		t.Errorf("version = %q, want the channel's release recorded", entry.Version)
	}

	dir := filepath.Join(prefix, "muse")
	if info, err := os.Stat(filepath.Join(dir, "muse-bin-1.1.1-R2514.1")); err != nil || info.Mode().Perm()&0o111 == 0 {
		t.Errorf("the versioned binary is missing or not executable: %v", err)
	}
	launcher, err := os.ReadFile(filepath.Join(dir, "muse"))
	if err != nil || !strings.HasPrefix(string(launcher), "#!/usr/bin/env bash") {
		t.Errorf("the launcher was not staged: %v", err)
	}
	stamped, err := os.ReadFile(filepath.Join(dir, ".muse-version"))
	if err != nil || strings.TrimSpace(string(stamped)) != "1.1.1-R2514.1" {
		t.Errorf("the version file = %q/%v, want the installed version", stamped, err)
	}
	link, err := os.Readlink(filepath.Join(prefix, "bin", "muse"))
	if err != nil || link != filepath.Join("..", "muse", "muse") {
		t.Errorf("bin/muse = %q/%v, want the relative link into the launcher's directory", link, err)
	}

	// And uninstall takes the link and the directory, leaving the prefix otherwise alone.
	if err := in.uninstall(compileMuseComponent(t), Recipe{Channel: channelMuseRelease}, Entry{}); err != nil {
		t.Fatalf("uninstall = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(prefix, "bin", "muse")); !os.IsNotExist(err) {
		t.Errorf("bin/muse survived the uninstall (%v)", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the launcher's directory survived the uninstall (%v)", err)
	}
}

// A manifest for another version than the pin is refused rather than installed under the wrong
// name: the URL for an older release is the channel's with the version rewritten, and a rewrite
// that landed anywhere else fails closed here.
func TestInstallMuseCLIRefusesAManifestForAnotherVersion(t *testing.T) {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("the fixture serves the x86_linux artifact")
	}
	// The channel only knows 2.0; the pin asks for 1.0, and the fixture answers every manifest
	// with the version it was asked for — except it cannot, because the pin's rewrite names a
	// release the channel never published. So this fixture answers the pin with the current
	// release's manifest, which is what a CDN that ignored the rewrite would do.
	mux := http.NewServeMux()
	var server *httptest.Server
	mux.HandleFunc("/channels/muse-stable", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"channel":"muse-stable","version":"2.0","manifest_url":%q}`,
			server.URL+"/download/?channel=muse&version=2.0&file=manifest.json")
	})
	mux.HandleFunc("/download/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"version":"2.0","artifacts":{"x86_linux":{"url":%q,"checksum":"x","size":1}}}`,
			server.URL+"/artifact")
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)
	museChannelURL = server.URL + "/channels/muse-stable"
	t.Cleanup(func() { museChannelURL = "https://api.meta.ai/muse-code/channels/muse-stable" })

	prefix := t.TempDir()
	cfg := &Config{Config: &core.Config{}, Prefix: prefix, Target: platformAlpine}
	if err := cfg.ensureLayout(); err != nil {
		t.Fatalf("ensureLayout: %v", err)
	}
	in := newInstaller(cfg, &jobLog{})
	if _, err := in.install(compileMuseComponent(t), Recipe{Channel: channelMuseRelease, Version: "1.0"}); err == nil {
		t.Fatal("a manifest for another version than the pin was accepted")
	}
}

// compileMuseComponent is the catalogue row the driver installs: the component as the panel names
// it, rather than a struct literal that could drift from the catalogue.
func compileMuseComponent(t *testing.T) Component {
	t.Helper()
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	comp, ok := catalog.Get("muse-cli")
	if !ok {
		t.Fatal("the catalogue declares no muse-cli")
	}
	return comp
}
