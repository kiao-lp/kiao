package install

import (
	"fmt"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"os"
	"path/filepath"
	"runtime"
)

// claudeReleases is Anthropic's release service. Under it, `latest` is a bare version string and
// `<version>/manifest.json` is that release's own record of what each platform's binary is — which
// is why no digest is pinned here. A copy in this file could only go stale; what pinning means is
// choosing *which* record is consulted, and that is Recipe.Version.
const claudeReleases = "https://downloads.claude.ai/claude-code-releases"

// installClaudeCLI puts the Claude Code binary at <prefix>/bin/claude.
func (in *installer) installClaudeCLI(recipe toolcatalog.Recipe) (string, error) {
	target, ok := ClaudeTarget(in.cfg.Platform())
	if !ok {
		return "", fmt.Errorf("no Claude Code build is published for this machine")
	}

	version := recipe.Version
	if version == "" || version == "latest" {
		resolved, err := in.text(claudeReleases + "/latest")
		if err != nil {
			return "", fmt.Errorf("%w; the release service is either unreachable or not available "+
				"in this region (https://www.anthropic.com/supported-countries)", err)
		}
		version = resolved
		in.log.printf("the current Claude Code release is %s", version)
	}
	if !releaseVersion.MatchString(version) {
		return "", fmt.Errorf("%q is not a Claude Code version", version)
	}

	var manifest struct {
		Platforms map[string]struct {
			Binary   string `json:"binary"`
			Checksum string `json:"checksum"`
		} `json:"platforms"`
	}
	if err := in.getJSON(claudeReleases+"/"+version+"/manifest.json", &manifest); err != nil {
		return "", err
	}
	build, ok := manifest.Platforms[target]
	if !ok {
		return "", fmt.Errorf("the manifest for Claude Code %s has no %s entry", version, target)
	}
	name := build.Binary
	if name == "" {
		name = "claude"
	}

	// Downloaded beside its destination and moved onto it, so a failed or interrupted fetch never
	// leaves half a binary where the agent half will find one and spawn it.
	dest := filepath.Join(in.cfg.BinDir(), "claude")
	staged := filepath.Join(in.cfg.DownloadDir(), "claude-"+version+"-"+target)
	if err := in.download(claudeReleases+"/"+version+"/"+target+"/"+name, staged, build.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(staged)
	if err := os.Chmod(staged, 0o755); err != nil {
		return "", fmt.Errorf("cannot make %s executable: %w", staged, err)
	}
	if err := os.Rename(staged, dest); err != nil {
		return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("installed %s (%s)", dest, target)

	// The version is what the manifest said, not what the binary answers: a cross-built binary — the
	// image's musl one, staged from a glibc build host — cannot be run here to be asked.
	if in.cfg.Target != "" {
		return version, nil
	}
	return in.versionOf(dest, "--version")
}

// claudeTarget names the build for a platform, in the spelling the release service uses. The libc
// comes from the *target* platform rather than from this machine, which is the whole of what
// Config.Target is for: the image is Alpine and is staged from a glibc host.
func ClaudeTarget(platform string) (string, bool) {
	arch, ok := toolconfig.HostArch()
	if !ok {
		return "", false
	}
	switch runtime.GOOS {
	case "darwin":
		return "darwin-" + arch, true
	case "linux":
		if platform == toolcatalog.PlatformAlpine {
			return "linux-" + arch + "-musl", true
		}
		return "linux-" + arch, true
	}
	return "", false
}
