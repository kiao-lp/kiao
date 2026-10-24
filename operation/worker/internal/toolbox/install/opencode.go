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

// opencodeReleases is where OpenCode publishes the CLI. `latest` redirects to the current tag, and
// every release carries one tarball per platform holding the single `opencode` binary. No checksum
// is published beside them — the project's own installer downloads them unverified too — so this
// channel is verified by TLS alone, and says so in the log.
const opencodeReleases = "https://github.com/anomalyco/opencode/releases"

// installOpenCodeCLI unpacks the OpenCode tarball as <prefix>/opencode and links
// <prefix>/bin/opencode into it.
func (in *installer) installOpenCodeCLI(recipe toolcatalog.Recipe) (string, error) {
	asset, ok := opencodeTarget(in.cfg.Platform())
	if !ok {
		return "", fmt.Errorf("no OpenCode build is published for this machine")
	}

	tag := recipe.Version
	if tag == "" || tag == "latest" {
		resolved, err := in.latestOpenCodeTag()
		if err != nil {
			return "", err
		}
		tag = resolved
		in.log.printf("the current OpenCode release is %s", tag)
	}

	base := opencodeReleases + "/download/" + tag + "/"
	archive := filepath.Join(in.cfg.DownloadDir(), asset)
	in.log.printf("no checksum is published for %s; the download is verified by TLS alone", asset)
	if err := in.download(base+asset, archive, ""); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackTreeInto(archive, in.cfg.OpencodeDir()); err != nil {
		return "", err
	}
	// Relative, and to the real binary rather than to a copy of it: a relative link is what lets
	// the whole prefix be copied somewhere else, which is exactly what the image build does with
	// it.
	link := filepath.Join(in.cfg.BinDir(), "opencode")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(in.cfg.OpencodeDir()), "opencode"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, filepath.Join(in.cfg.OpencodeDir(), "opencode"))

	if in.cfg.Target != "" {
		return strings.TrimPrefix(tag, "v"), nil
	}
	return in.versionOf(link, "--version")
}

// opencodeTarget names the release asset for a platform, in the spelling the releases use. The
// libc comes from the *target* platform rather than from this machine, for the reason claudeTarget
// gives: the image is Alpine and is staged from a glibc host. macOS builds are zips, which the
// tarball unpack path does not read, and the `-baseline` builds for CPUs without AVX2 are not
// offered either — both are a host the panel reports as having no published build, where an
// `opencode` on PATH is still honoured.
func opencodeTarget(platform string) (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "arm64"
	default:
		return "", false
	}
	if runtime.GOOS != "linux" {
		return "", false
	}
	target := "linux-" + arch
	if platform == toolcatalog.PlatformAlpine {
		target += "-musl"
	}
	return "opencode-" + target + ".tar.gz", true
}

// latestOpenCodeTag asks GitHub which release is current, by following the redirect it publishes
// for exactly that question — the API would rate-limit an unauthenticated caller, for
// latestCodexTag's reason.
func (in *installer) latestOpenCodeTag() (string, error) {
	url := opencodeReleases + "/latest"
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
	tag, ok := strings.CutPrefix(landed, "/anomalyco/opencode/releases/tag/")
	if !ok || tag == "" {
		return "", fmt.Errorf("%s led to %s, which names no release", url, landed)
	}
	return tag, nil
}
