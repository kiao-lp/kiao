package install

import (
	"fmt"
	"io"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// codexReleases is where OpenAI publishes the CLI. `latest` redirects to the current tag, and every
// release carries a codex-package_SHA256SUMS listing a digest per asset — the same arrangement
// nodejs.org's SHASUMS256.txt has, and read by the same helper.
const codexReleases = "https://github.com/openai/codex/releases"

// codexChecksums is the asset that lists the others' digests.
const codexChecksums = "codex-package_SHA256SUMS"

// installCodexCLI unpacks the Codex package as <prefix>/codex and links <prefix>/bin/codex into it.
func (in *installer) installCodexCLI(recipe toolcatalog.Recipe) (string, error) {
	target, ok := CodexTarget()
	if !ok {
		return "", fmt.Errorf("no Codex build is published for this machine")
	}

	tag := recipe.Version
	if tag == "" || tag == "latest" {
		resolved, err := in.latestCodexTag()
		if err != nil {
			return "", err
		}
		tag = resolved
		in.log.printf("the current Codex release is %s", tag)
	} else if !strings.HasPrefix(tag, "rust-v") {
		// Preinstall pins are ordinary versions (codex-cli@0.162.1); release URLs use rust-v.
		tag = "rust-v" + strings.TrimPrefix(tag, "v")
	}

	base := codexReleases + "/download/" + tag + "/"
	asset := "codex-package-" + target + ".tar.gz"
	sum, err := in.checksumFromSHASUMS(base+codexChecksums, asset)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.DownloadDir(), asset)
	if err := in.download(base+asset, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackTreeInto(archive, in.cfg.CodexDir()); err != nil {
		return "", err
	}
	// Relative, and to the real binary rather than to a copy of it: codex resolves its ripgrep and
	// its sandbox helper from where the executable actually is, so bin/codex has to stay inside the
	// tree — and a relative link is what lets that whole prefix be copied somewhere else, which is
	// exactly what the image build does with it.
	link := filepath.Join(in.cfg.BinDir(), "codex")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(in.cfg.CodexDir()), "bin", "codex"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, filepath.Join(in.cfg.CodexDir(), "bin", "codex"))

	if in.cfg.Target != "" {
		return strings.TrimPrefix(tag, "rust-v"), nil
	}
	return in.versionOf(link, "--version")
}

// codexTarget names the build for this machine, in the spelling the release assets use. Linux is
// always the musl build — statically linked, so it runs on Alpine and on a glibc distribution
// alike, which is the choice OpenAI's own installer makes and the reason this channel needs no
// libc of its own.
func CodexTarget() (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	default:
		return "", false
	}
	switch runtime.GOOS {
	case "linux":
		return arch + "-unknown-linux-musl", true
	case "darwin":
		return arch + "-apple-darwin", true
	}
	return "", false
}

// latestCodexTag asks GitHub which release is current, by following the redirect it publishes for
// exactly that question. The API would answer it too, and rate-limits an unauthenticated caller to
// sixty questions an hour — which a build host behind one address shares with everything else on it.
func (in *installer) latestCodexTag() (string, error) {
	url := codexReleases + "/latest"
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	landed := resp.Request.URL.Path
	tag, ok := strings.CutPrefix(landed, "/openai/codex/releases/tag/")
	if !ok || tag == "" {
		return "", fmt.Errorf("%s led to %s, which names no release", url, landed)
	}
	return tag, nil
}
