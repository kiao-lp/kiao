package install

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"net/http"
	pkgUrl "net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// museChannelURL is the stable channel document: the current version and the manifest that lists
// its artifacts. museLauncherURL is the launcher script itself — `muse` as the user runs it —
// which manages the versioned binary beside it. Variables rather than constants so tests can point
// the channel at a local server; production never changes them.
var (
	museChannelURL  = "https://api.meta.ai/muse-code/channels/muse-stable"
	museLauncherURL = "https://api.meta.ai/muse-launcher.sh"
)

// museChannelDoc is the channel document: the current release and where its manifest lives.
type museChannelDoc struct {
	Channel     string `json:"channel"`
	Version     string `json:"version"`
	ManifestURL string `json:"manifest_url"`
}

// museManifest is one release's manifest: the version it is of, and one artifact per platform.
type museManifest struct {
	Version   string `json:"version"`
	Artifacts map[string]struct {
		URL      string `json:"url"`
		Checksum string `json:"checksum"`
		Size     int64  `json:"size"`
	} `json:"artifacts"`
}

// installMuseCLI lays out <prefix>/muse as the launcher expects it — the launcher script, the
// versioned binary beside it, and the version file that says the binary is that version — and links
// <prefix>/bin/muse at it.
//
// The layout is the launcher's own doing, reproduced rather than invented: a hand-installed `muse`
// is a directory holding `muse`, `muse-bin-<version>` and `.muse-version`, and the binary the
// driver spawns is the launcher, which resolves the link to find its own directory. Reproducing it
// keeps what the launcher does — update checks, release notices — working as documented, and the
// version file written here is what keeps the first run from downloading the binary this install
// already fetched.
func (in *installer) installMuseCLI(recipe toolcatalog.Recipe) (string, error) {
	target, ok := museTarget()
	if !ok {
		return "", fmt.Errorf("no Muse build is published for this machine")
	}

	var channel museChannelDoc
	if err := in.getJSON(museChannelURL, &channel); err != nil {
		return "", err
	}
	version := recipe.Version
	if version == "" || version == "latest" {
		version = channel.Version
		in.log.printf("the current Muse release is %s", version)
	}
	manifestURL, err := museManifestURL(channel.ManifestURL, version)
	if err != nil {
		return "", err
	}
	var manifest museManifest
	if err := in.getJSON(manifestURL, &manifest); err != nil {
		return "", err
	}
	// The manifest names the version it is of, which is what a pinned install is checked against:
	// the URL for an older release is the channel's with the version rewritten, and a rewrite that
	// landed anywhere else is refused here rather than installed under the wrong name.
	if manifest.Version != version {
		return "", fmt.Errorf("the manifest at %s is for Muse %s rather than %s", manifestURL, manifest.Version, version)
	}
	artifact, ok := manifest.Artifacts[target]
	if !ok {
		return "", fmt.Errorf("the manifest for Muse %s has no %s entry", version, target)
	}

	dir := in.cfg.MuseDir()
	staged := filepath.Join(in.cfg.DownloadDir(), "muse-bin-"+version+"-"+target)
	if err := in.download(artifact.URL, staged, artifact.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(staged)
	if artifact.Size > 0 {
		info, err := os.Stat(staged)
		if err != nil {
			os.Remove(staged)
			return "", fmt.Errorf("cannot stat %s: %w", staged, err)
		}
		if info.Size() != artifact.Size {
			os.Remove(staged)
			return "", fmt.Errorf("%s downloaded %d bytes rather than the published %d", artifact.URL, info.Size(), artifact.Size)
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", dir, err)
	}
	// Downloaded beside its destination and moved onto it, so a failed or interrupted fetch never
	// leaves half a binary where the agent half will find one and spawn it.
	dest := filepath.Join(dir, "muse-bin-"+version)
	if err := os.Chmod(staged, 0o755); err != nil {
		return "", fmt.Errorf("cannot make %s executable: %w", staged, err)
	}
	if err := os.Rename(staged, dest); err != nil {
		return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
	}

	launcher := filepath.Join(dir, "muse")
	if err := in.downloadLauncher(museLauncherURL, launcher); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, ".muse-version"), []byte(version+"\n"), 0o644); err != nil {
		return "", fmt.Errorf("cannot write the Muse version file: %w", err)
	}

	// Relative, for the codex channel's reason: the launcher resolves the link to find the
	// directory it manages, and a relative link is what lets the whole prefix be copied somewhere
	// else, which is exactly what the image build does with it.
	link := filepath.Join(in.cfg.BinDir(), "muse")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(dir), "muse"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, launcher)

	if in.cfg.Target != "" {
		return version, nil
	}
	return in.versionOf(link, "--version")
}

// museManifestURL is the manifest to read for one version: the channel's own for the current
// release, and the channel's with the version rewritten for a pin. The manifest names the version
// it is of, so a rewrite the server answered with anything else is refused by the caller.
func museManifestURL(channelURL, version string) (string, error) {
	parsed, err := pkgUrl.Parse(channelURL)
	if err != nil || channelURL == "" {
		return "", fmt.Errorf("the Muse channel points at no manifest (%q)", channelURL)
	}
	query := parsed.Query()
	if query.Get("version") != "" {
		query.Set("version", version)
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

// downloadLauncher fetches the launcher script and checks it against the checksum the server
// advertises for it in the x-content-sha256 header — the same verification the launcher applies to
// itself when it updates, and the only one this script's publisher offers.
func (in *installer) downloadLauncher(source, dest string) error {
	in.log.printf("downloading %s", source)
	resp, err := in.client.Get(source)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", source, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading %s: the server answered %s", source, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("downloading %s: %w", source, err)
	}
	if advertised := strings.TrimSpace(resp.Header.Get("x-content-sha256")); advertised != "" {
		if got := sha256.Sum256(body); !strings.EqualFold(hex.EncodeToString(got[:]), advertised) {
			return fmt.Errorf("%s does not match its advertised checksum", source)
		}
		in.log.printf("checksum verified (%d bytes)", len(body))
	} else {
		in.log.printf("downloaded %d bytes unverified: the server advertised no checksum", len(body))
	}
	if err := os.WriteFile(dest, body, 0o755); err != nil {
		return fmt.Errorf("cannot write %s: %w", dest, err)
	}
	return nil
}

// museTarget names the build for this machine, in the spelling the release manifest uses. The
// binary is statically linked, so there is no libc to take from anywhere — Linux is one entry for
// every distribution, which is why staging it for the image needs nothing said.
func museTarget() (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86"
	case "arm64":
		arch = "aarch64"
	default:
		return "", false
	}
	switch runtime.GOOS {
	case "linux":
		return arch + "_linux", true
	case "darwin":
		return arch + "_macos", true
	}
	return "", false
}
