package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// What the worker is handed as PATH decides which agents the agent tab offers: an agent is
// offered when its CLI resolves there, and the panel installs those CLIs into the toolbox prefix
// and nowhere else. So these are about a Muse installed from the panel being a Muse the tab offers.

func TestPathWithToolboxPutsItsBinFirst(t *testing.T) {
	t.Setenv("PATH", "/usr/bin"+string(os.PathListSeparator)+"/bin")

	path := pathWithToolbox("/home/someone/.local/share/kiao/toolbox")

	want := filepath.Join("/home/someone/.local/share/kiao/toolbox", "bin")
	if first := filepath.SplitList(path)[0]; first != want {
		t.Fatalf("PATH starts with %q, want %q (whole: %q)", first, want, path)
	}
	// The machine's own is kept behind it: git, node and the agent CLIs installed some other way
	// are all still found.
	if !strings.HasSuffix(path, "/usr/bin"+string(os.PathListSeparator)+"/bin") {
		t.Fatalf("PATH %q dropped the inherited entries", path)
	}
}

// A prefix the deployment emptied is a panel with nowhere to write, which is a PATH with nothing to
// add rather than a bare "bin" ahead of everything.
func TestPathWithToolboxLeavesPathAloneWithoutAPrefix(t *testing.T) {
	t.Setenv("PATH", "/usr/bin")

	if path := pathWithToolbox(""); path != "/usr/bin" {
		t.Fatalf("PATH is %q, want it untouched", path)
	}
}

// What the worker is handed as KIAO_WORKER_MCP_PATH decides whether the bundled
// kiao servers are installable from the panel at all: a path names the bundle this install
// staged beside the executable, and no path leaves those rows unavailable.

// An install carries the bundle beside its binaries, and that is what the service is pointed at.
func TestDefaultMCPPathNamesTheInstalledBundle(t *testing.T) {
	install := t.TempDir()
	if err := os.Mkdir(filepath.Join(install, "kiao-mcp"), 0o755); err != nil {
		t.Fatalf("cannot stage a bundle: %v", err)
	}

	if got := defaultMCPPath(install); got != filepath.Join(install, "kiao-mcp") {
		t.Fatalf("MCP path is %q, want the installed bundle", got)
	}
}

// An install from before the bundle shipped — or the launcher run outside one — starts the
// service without it, and the turns run as they always did, rather than failing the start.
func TestDefaultMCPPathIsEmptyWithoutABundle(t *testing.T) {
	if got := defaultMCPPath(t.TempDir()); got != "" {
		t.Fatalf("MCP path is %q, want nothing named", got)
	}
}

// This executable opens any folder, so it offers the two generic servers — files and boards — and
// leaves units and CV unavailable, which is the inverse of the service default.
func TestDefaultMCPServersOffersFilesAndBoards(t *testing.T) {
	if got := defaultMCPServers(); got != "files,hybridflow" {
		t.Fatalf("MCP servers = %q, want the files and boards halves", got)
	}
}

// An install carries the toolbox catalogue beside its binaries, and that is what the service is
// pointed at.
func TestDefaultCatalogPathNamesTheInstalledCatalog(t *testing.T) {
	install := t.TempDir()
	if err := os.Mkdir(filepath.Join(install, "catalog"), 0o755); err != nil {
		t.Fatalf("cannot stage a catalog: %v", err)
	}

	if got := defaultCatalogPath(install); got != filepath.Join(install, "catalog") {
		t.Fatalf("catalog path is %q, want the installed directory", got)
	}
}

// An install from before the catalogue shipped as files — or the launcher run outside one —
// starts the service without it, on the embedded pub.json, rather than failing the start.
func TestDefaultCatalogPathIsEmptyWithoutACatalog(t *testing.T) {
	if got := defaultCatalogPath(t.TempDir()); got != "" {
		t.Fatalf("catalog path is %q, want nothing named", got)
	}
}
