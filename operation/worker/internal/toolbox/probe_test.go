package toolbox

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"kiao/worker/internal/core"
)

// TestProbeVersionAsksFFmpegItsOwnWay: ffmpeg exits 8 on `--version` and answers only `-version`, so
// asking the one way every other runtime answers left a machine's own ffmpeg on a row with no version.
func TestProbeVersionAsksFFmpegItsOwnWay(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in for ffmpeg is a shell script")
	}
	bin := filepath.Join(t.TempDir(), "ffmpeg")
	script := `#!/bin/sh
[ "$1" = -version ] || { echo "Unrecognized option '$1'." >&2; exit 8; }
echo 'ffmpeg version n9.0.1 Copyright (c) 2000-2026 the FFmpeg developers'
echo 'built with gcc 16.2.0'
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := probeVersion(&Config{Config: &core.Config{}}, bin); got != "ffmpeg version n9.0.1" {
		t.Errorf("probeVersion = %q, want the version ffmpeg answers -version with", got)
	}
}

// TestProbeVersionAsksDotItsOwnWay: dot answers only `-V`, and on stderr — asking the two
// spellings every other runtime knows left a machine's own Graphviz on a row with no version.
func TestProbeVersionAsksDotItsOwnWay(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in for dot is a shell script")
	}
	bin := filepath.Join(t.TempDir(), "dot")
	script := `#!/bin/sh
[ "$1" = -V ] || { echo "unrecognized option '$1'" >&2; exit 1; }
echo 'dot - graphviz version 2.43.0 (0)' >&2
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := probeVersion(&Config{Config: &core.Config{}}, bin); got != "dot - graphviz version 2.43.0 (0)" {
		t.Errorf("probeVersion = %q, want the version dot answers -V with", got)
	}
}

// TestVersionLine: a row shows what a tool says it is, and nothing of the copyright ffmpeg puts on the
// same line.
func TestVersionLine(t *testing.T) {
	cases := map[string]string{
		"ffmpeg version n9.0.1-27-g9b0578816c-20260910 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with gcc": "ffmpeg version n9.0.1-27-g9b0578816c-20260910",
		"Temurin OpenJDK 21.0.5\nOpenJDK Runtime Environment":                                                         "Temurin OpenJDK 21.0.5",
		"v22.11.0\n": "v22.11.0",
		"":           "",
	}
	for said, want := range cases {
		if got := versionLine(said); got != want {
			t.Errorf("versionLine(%q) = %q, want %q", said, got, want)
		}
	}
}
