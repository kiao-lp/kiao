package toolbox

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// Redirect the installer's GitHub requests to a fixture without changing the production URLs.
type codexReleaseTransport struct{ server *url.URL }

func (tr codexReleaseTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	copy := req.Clone(req.Context())
	copy.URL.Scheme, copy.URL.Host = tr.server.Scheme, tr.server.Host
	return http.DefaultTransport.RoundTrip(copy)
}

func codexReleaseInstaller(t *testing.T, corrupt bool) (*installer, string) {
	t.Helper()
	target, ok := codexTarget()
	if !ok {
		t.Skip("no Codex release for this platform")
	}
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tarball := tar.NewWriter(gz)
	// The helpers must survive installation beside the binary: the current models use Code Mode.
	for _, path := range []string{"bin/codex", "bin/codex-app-server", "bin/codex-code-mode-host", "codex-path/rg", "codex-resources/instructions.md"} {
		data := []byte("fixture: " + path)
		if err := tarball.WriteHeader(&tar.Header{Name: path, Mode: 0o755, Size: int64(len(data))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarball.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarball.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(archive.Bytes())
	asset := "codex-package-" + target + ".tar.gz"
	mux := http.NewServeMux()
	mux.HandleFunc("/openai/codex/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/openai/codex/releases/tag/rust-v0.162.1", http.StatusFound)
	})
	mux.HandleFunc("/openai/codex/releases/tag/rust-v0.162.1", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "release")
	})
	mux.HandleFunc("/openai/codex/releases/download/rust-v0.162.1/"+codexChecksums, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%x  %s\n", digest, asset)
	})
	mux.HandleFunc("/openai/codex/releases/download/rust-v0.162.1/"+asset, func(w http.ResponseWriter, r *http.Request) {
		if corrupt {
			fmt.Fprint(w, "corrupt archive")
			return
		}
		w.Write(archive.Bytes())
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	prefix := t.TempDir()
	cfg := &Config{Config: &core.Config{}, Prefix: prefix, Target: platformAlpine}
	if err := cfg.ensureLayout(); err != nil {
		t.Fatal(err)
	}
	in := newInstaller(cfg, &jobLog{})
	in.client.Transport = codexReleaseTransport{server: serverURL}
	return in, prefix
}

func TestInstallCodexLatestAndVersionPinsKeepTheWholePackage(t *testing.T) {
	for _, version := range []string{"", "latest", "0.162.1", "v0.162.1", "rust-v0.162.1"} {
		name := version
		if name == "" {
			name = "unspecified"
		}
		t.Run(name, func(t *testing.T) {
			in, prefix := codexReleaseInstaller(t, false)
			// An upgrade replaces the old package instead of leaving old helpers behind.
			if err := os.MkdirAll(in.cfg.codexDir(), 0o755); err != nil {
				t.Fatal(err)
			}
			old := filepath.Join(in.cfg.codexDir(), "old-helper")
			if err := os.WriteFile(old, []byte("old"), 0o755); err != nil {
				t.Fatal(err)
			}
			installed, err := in.installCodexCLI(Recipe{Version: version})
			if err != nil {
				t.Fatalf("install: %v\n%s", err, in.log.String())
			}
			if installed != "0.162.1" {
				t.Errorf("version = %q, want the resolved release", installed)
			}
			for _, path := range []string{"bin/codex", "bin/codex-app-server", "bin/codex-code-mode-host", "codex-path/rg", "codex-resources/instructions.md"} {
				data, err := os.ReadFile(filepath.Join(in.cfg.codexDir(), path))
				if err != nil || string(data) != "fixture: "+path {
					t.Errorf("package file %s = %q/%v", path, data, err)
				}
			}
			if _, err := os.Stat(old); !os.IsNotExist(err) {
				t.Errorf("obsolete helper survived the upgrade: %v", err)
			}
			link, err := os.Readlink(filepath.Join(prefix, "bin", "codex"))
			if err != nil || link != filepath.Join("..", "codex", "bin", "codex") {
				t.Errorf("link = %q/%v", link, err)
			}
		})
	}
}

func TestInstallCodexRefusesACorruptReleaseBeforeReplacingThePackage(t *testing.T) {
	in, _ := codexReleaseInstaller(t, true)
	if err := os.MkdirAll(in.cfg.codexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(in.cfg.codexDir(), "installed")
	if err := os.WriteFile(old, []byte("keep"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := in.installCodexCLI(Recipe{Version: "latest"}); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("install = %v, want a checksum failure", err)
	}
	if data, err := os.ReadFile(old); err != nil || string(data) != "keep" {
		t.Errorf("previous install = %q/%v, want it preserved", data, err)
	}
}

func TestCodexCatalogueInstallsLatest(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatal(err)
	}
	component, ok := catalog.Get("codex-cli")
	if !ok {
		t.Fatal("no Codex component")
	}
	recipe, ok := component.RecipeFor(platformGeneric)
	if !ok || recipe.Channel != channelCodexRelease || recipe.Version != "latest" {
		t.Errorf("Codex recipe = %+v, want the latest official release", recipe)
	}
}
