package install

import (
	"fmt"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"kiao/worker/internal/toolbox/mcp"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// ffmpegBuilds is where the static FFmpeg builds are published: the `latest` release of
// BtbN/FFmpeg-Builds, which is where FFmpeg's own download page sends Linux. It is rebuilt every
// day, and each rebuild replaces its `checksums.sha256` along with the archives — so the digest read
// first is the one published with the archive fetched straight after it, and the rare install that
// straddles a rebuild fails on the mismatch rather than keeping a file nobody vouched for.
const ffmpegBuilds = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"

// ffmpegExecutables are what the driver takes out of the archive: the one a save runs, and the
// prober that comes with it wherever else FFmpeg is installed.
var ffmpegExecutables = []string{"ffmpeg", "ffprobe"}

// installFFmpeg puts ffmpeg and ffprobe at <prefix>/bin.
func (in *installer) installFFmpeg(recipe toolcatalog.Recipe) (string, error) {
	target, ok := ffmpegTarget()
	if !ok {
		return "", fmt.Errorf("no FFmpeg build is published for this machine")
	}
	// **A release branch, and never `master`.** There is no build of a tag to pin: every build is of
	// a branch's newest commit, so `9.0` means 9.0 and its fixes, and master would mean whatever was
	// merged the day before.
	if !ffmpegBranch.MatchString(recipe.Version) {
		return "", fmt.Errorf("%q is not an FFmpeg release branch", recipe.Version)
	}

	asset := ffmpegAsset(recipe.Version, target)
	sum, err := in.checksumFromSHASUMS(ffmpegBuilds+"checksums.sha256", asset)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.DownloadDir(), asset)
	if err := in.download(ffmpegBuilds+asset, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	// The archive unpacks to half a gigabyte, of which ffplay and the manuals are for somebody else
	// — so tar is asked for the two files by name, into a directory of the download area that goes
	// when they have been moved out of it.
	top := strings.TrimSuffix(asset, ".tar.xz")
	staging := filepath.Join(in.cfg.DownloadDir(), top)
	if err := os.RemoveAll(staging); err != nil {
		return "", fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)
	command := []string{"tar", "-xJf", archive, "-C", in.cfg.DownloadDir()}
	for _, name := range ffmpegExecutables {
		command = append(command, top+"/bin/"+name)
	}
	if err := in.run(command, in.cfg.Prefix); err != nil {
		return "", err
	}
	for _, name := range ffmpegExecutables {
		dest := filepath.Join(in.cfg.BinDir(), name)
		if err := os.Rename(filepath.Join(staging, "bin", name), dest); err != nil {
			return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
		}
		in.log.printf("installed %s (%s)", dest, target)
	}

	if in.cfg.Target != "" {
		return recipe.Version, nil
	}
	version, err := in.versionOf(filepath.Join(in.cfg.BinDir(), "ffmpeg"), "-version")
	return mcp.VersionLine(version), err
}

// ffmpegAsset is the archive a release branch is published as, for one target:
// `ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz`. The GPL build, because that is the one carrying the
// encoders a save uses — libsvtav1 is in both, libx264 and its kind only in this one, and a turn
// handed this ffmpeg may well want them.
func ffmpegAsset(branch, target string) string {
	return "ffmpeg-n" + branch + "-latest-" + target + "-gpl-" + branch + ".tar.xz"
}

// ffmpegTarget names the build for this machine, in the spelling the archives use. Linux on glibc
// only: that is what the builds link against, and it is why Alpine has a recipe of its own.
func ffmpegTarget() (string, bool) {
	if runtime.GOOS != "linux" {
		return "", false
	}
	switch runtime.GOARCH {
	case "amd64":
		return "linux64", true
	case "arm64":
		return "linuxarm64", true
	}
	return "", false
}

// ffmpegBranch is the shape a release branch has — `9.0`, `8.1` — before it is put in a file name.
var ffmpegBranch = regexp.MustCompile(`^[0-9]+\.[0-9]+$`)
