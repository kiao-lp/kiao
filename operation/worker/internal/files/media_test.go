package files

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"kiao/worker/internal/core"
)

// ── what may be saved ─────────────────────────────────────────────────────────

func TestSegmentFiles(t *testing.T) {
	files, spans, err := segmentFiles("films/clip.mp4", []SegmentDto{
		{Name: "Intro", FromMs: 0, ToMs: 700},
		{Name: "Le vrai début", FromMs: 700, ToMs: 1500},
	})
	if err != nil {
		t.Fatalf("segmentFiles: %v", err)
	}
	if want := []string{"films/Intro.mkv", "films/Le vrai début.mkv"}; !reflect.DeepEqual(files, want) {
		t.Errorf("files = %v, want %v", files, want)
	}
	if want := []float64{0.7, 0.8}; !reflect.DeepEqual(spans, want) {
		t.Errorf("spans = %v, want %v", spans, want)
	}

	// A video at the root of the store has its segments at the root too.
	files, _, _ = segmentFiles("clip.mp4", []SegmentDto{{Name: "Intro", ToMs: 700}})
	if want := []string{"Intro.mkv"}; !reflect.DeepEqual(files, want) {
		t.Errorf("files = %v, want %v", files, want)
	}
}

func TestSegmentFilesRefuses(t *testing.T) {
	one := func(name string, from, to float64) []SegmentDto {
		return []SegmentDto{{Name: name, FromMs: from, ToMs: to}}
	}
	cases := []struct {
		name     string
		source   string
		segments []SegmentDto
		want     error
	}{
		{"no segment", "clip.mp4", nil, errNoSegments},
		{"an empty name", "clip.mp4", one("", 0, 700), errSegmentName},
		{"a path", "clip.mp4", one("../clip", 0, 700), errSegmentName},
		{"a Windows path", "clip.mp4", one(`a\b`, 0, 700), errSegmentName},
		{"a hidden file", "clip.mp4", one(".intro", 0, 700), errSegmentName},
		{"a space a Windows disk would drop", "clip.mp4", one("Intro ", 0, 700), errSegmentName},
		// Whatever the case, as a Drive or a Windows disk compares names.
		{"the source itself", "films/Clip.mkv", one("clip", 0, 700), errSegmentIsSource},
		{"one file twice", "clip.mp4", []SegmentDto{
			{Name: "Intro", ToMs: 700}, {Name: "intro", FromMs: 700, ToMs: 900},
		}, errSegmentTwice},
		{"no length", "clip.mp4", one("Intro", 700, 700), errSegmentLength},
		{"backwards", "clip.mp4", one("Intro", 700, 600), errSegmentLength},
		{"before the start", "clip.mp4", one("Intro", -100, 600), errSegmentLength},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, _, err := segmentFiles(c.source, c.segments); !errors.Is(err, c.want) {
				t.Errorf("err = %v, want %v", err, c.want)
			}
		})
	}
}

// ── what ffmpeg is asked ──────────────────────────────────────────────────────

func TestSegmentArgs(t *testing.T) {
	args := strings.Join(segmentArgs("/store/clip.mp4", "/store/.Intro.mkv.saving",
		SegmentDto{Name: "Intro", FromMs: 700, ToMs: 1500}, []string{"-c:v", "libsvtav1"}), " ")
	for _, want := range []string{
		// The window, drawn in by half a millisecond at both ends: the image at 0.7 is in, the one
		// at 1.5 is out.
		"-ss 0.699500 -i /store/clip.mp4 -t 0.800000",
		// The picture that is not a cover, every sound, and no chapter of the whole file.
		"-map 0:V:0? -map 0:a? -map_chapters -1",
		"-c:v libsvtav1",
		"-f matroska -y /store/.Intro.mkv.saving",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("args = %q, want %q in it", args, want)
		}
	}

	// At the very start there is nothing to draw in, and the end still stops short of the next image.
	args = strings.Join(segmentArgs("/store/clip.mp4", "/store/.a.mkv.saving",
		SegmentDto{Name: "a", FromMs: 0, ToMs: 100}, nil), " ")
	if want := "-ss 0.000000 -i /store/clip.mp4 -t 0.099500"; !strings.Contains(args, want) {
		t.Errorf("args = %q, want %q in it", args, want)
	}
}

// encodersListing is the head of what `ffmpeg -encoders` says, trimmed to the lines that matter.
const encodersListing = `Encoders:
 V..... = Video
 A..... = Audio
 .F.... = Frame-level multithreading
 ...X.. = Codec is experimental
 ------
 V....D libaom-av1           libaom AV1 (codec av1)
 V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)
 A..X.D opus                 Opus
 A....D libopus              libopus Opus (codec opus)
`

func TestEncodersArePickedInOrder(t *testing.T) {
	have := encodersOf(encodersListing)
	if video, _ := pickEncoder(av1Encoders, have); video.name != "libsvtav1" {
		t.Errorf("video = %q, want libsvtav1", video.name)
	}
	if audio, _ := pickEncoder(opusEncoders, have); audio.name != "libopus" {
		t.Errorf("audio = %q, want libopus", audio.name)
	}

	// Without SVT-AV1, libaom; without libopus, FFmpeg's own.
	delete(have, "libsvtav1")
	delete(have, "libopus")
	if video, _ := pickEncoder(av1Encoders, have); video.name != "libaom-av1" {
		t.Errorf("video = %q, want libaom-av1", video.name)
	}
	if audio, _ := pickEncoder(opusEncoders, have); audio.name != "opus" {
		t.Errorf("audio = %q, want opus", audio.name)
	}

	// A graphics card's encoder is not one a save can count on.
	if _, ok := pickEncoder(av1Encoders, encodersOf(" V....D av1_nvenc  NVIDIA NVENC av1 encoder")); ok {
		t.Errorf("an ffmpeg with only a hardware AV1 encoder was taken as able to save")
	}
}

func TestStreamsOf(t *testing.T) {
	cases := []struct {
		name           string
		probe          string
		picture, sound bool
	}{
		{"a video", `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 22 kb/s
  Stream #0:0[0x1](und): Video: vp9 (Profile 0) (vp09 / 0x39307076), yuv420p(tv), 64x64, 10 fps (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp (default)
At least one output file must be specified`, true, true},
		// The album art of an MP3 is a picture, and not a video to encode.
		{"a recording with its cover", `Input #0, mp3, from 'talk.mp3':
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 128 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 300x300 [SAR 1:1 DAR 1:1], 90k tbn (attached pic)`, false, true},
		{"a silent video", `Input #0, matroska,webm, from 'screen.webm':
  Stream #0:0: Video: vp8, yuv420p(tv, progressive), 1280x720, 30 fps`, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			picture, sound := streamsOf(c.probe)
			if picture != c.picture || sound != c.sound {
				t.Errorf("streamsOf = (%v, %v), want (%v, %v)", picture, sound, c.picture, c.sound)
			}
		})
	}
}

// ── the job ───────────────────────────────────────────────────────────────────

func TestSaveProgressIsMeasuredByLength(t *testing.T) {
	job := &mediaJob{files: []string{"a.mkv", "b.mkv"}, spans: []float64{1, 3}, state: MediaJobRunning}
	job.advance(0.5)
	if got := job.dto(); got.Progress != 0.125 || got.Current != "a.mkv" {
		t.Errorf("halfway through the first: progress %v, current %q", got.Progress, got.Current)
	}
	job.saved()
	job.advance(1.5)
	if got := job.dto(); got.Progress != 0.625 || got.Current != "b.mkv" || got.Done != 1 {
		t.Errorf("halfway through the second: %+v", got)
	}
	// ffmpeg may report a little past the end it was given.
	job.advance(9)
	if got := job.dto(); got.Progress != 1 {
		t.Errorf("past the end of the last: progress %v, want 1", got.Progress)
	}
	job.saved()
	job.finish(nil)
	if got := job.dto(); got.State != MediaJobDone || got.Progress != 1 || got.Current != "" {
		t.Errorf("done: %+v", got)
	}
}

// ── over HTTP, with a stand-in for ffmpeg ─────────────────────────────────────

// fakeFFmpeg writes a stand-in for ffmpeg and answers its path. It lists an AV1 and an Opus encoder,
// reads any file as a video with a sound, and "encodes" by reporting its progress and writing a few
// bytes where its last argument says. Told to hang, it sleeps in place of the encoding until it is
// killed — `exec`, so that the process killed is the one holding ffmpeg's end of the pipes.
func fakeFFmpeg(t *testing.T, hang bool) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in for ffmpeg is a shell script")
	}
	encode := `printf 'segment' > "$last"`
	if hang {
		encode = "exec sleep 30"
	}
	script := `#!/bin/sh
case "$*" in
*-encoders*)
	printf ' V..... libsvtav1  SVT-AV1\n A....D libopus  libopus Opus\n'
	exit 0 ;;
*-progress*) ;;
*)
	printf "Input #0, mov,mp4, from 'x':\n  Stream #0:0: Video: h264\n  Stream #0:1: Audio: aac\n" >&2
	exit 1 ;;
esac
for last; do :; done
printf 'out_time_us=250000\nprogress=continue\n'
` + encode + `
printf 'out_time_us=700000\nprogress=end\n'
`
	file := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(file, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return file
}

func saveRequest(t *testing.T, body SaveSegmentsRequestDto) *http.Request {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/media/saveSegments", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func startSave(t *testing.T, s *Service, body SaveSegmentsRequestDto) MediaJobDto {
	t.Helper()
	rec := do(s, saveRequest(t, body))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /media/saveSegments = %d %s, want 202", rec.Code, rec.Body.String())
	}
	var job MediaJobDto
	if err := json.Unmarshal(rec.Body.Bytes(), &job); err != nil {
		t.Fatal(err)
	}
	return job
}

// waitForSave polls the job as Dashboard does, until it has ended.
func waitForSave(t *testing.T, s *Service, id string) MediaJobDto {
	t.Helper()
	deadline := time.Now().Add(2 * time.Minute)
	for {
		rec := do(s, httptest.NewRequest(http.MethodGet, "/media/jobs/"+id, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /media/jobs/%s = %d %s", id, rec.Code, rec.Body.String())
		}
		var job MediaJobDto
		if err := json.Unmarshal(rec.Body.Bytes(), &job); err != nil {
			t.Fatal(err)
		}
		if job.State != MediaJobRunning {
			return job
		}
		if time.Now().After(deadline) {
			t.Fatalf("the save is still running: %+v", job)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestSaveSegmentsSavesEachBesideTheVideo(t *testing.T) {
	s, root := newFileTestServer(t)
	ffmpeg := fakeFFmpeg(t, false)
	s.UseFFmpeg(func() (string, bool) { return ffmpeg, true })
	mustWriteBytes(t, filepath.Join(root, "films", "clip.mp4"), []byte("video"))
	// An earlier save of the first segment, which this one replaces.
	mustWriteBytes(t, filepath.Join(root, "films", "Intro.mkv"), []byte("earlier"))

	job := startSave(t, s, SaveSegmentsRequestDto{Path: "/films/clip.mp4", Segments: []SegmentDto{
		{Name: "Intro", FromMs: 0, ToMs: 700},
		{Name: "Outro", FromMs: 700, ToMs: 1500},
	}})
	if want := []string{"films/Intro.mkv", "films/Outro.mkv"}; !reflect.DeepEqual(job.Files, want) {
		t.Errorf("files = %v, want %v", job.Files, want)
	}

	done := waitForSave(t, s, job.ID)
	if done.State != MediaJobDone || done.Done != 2 || done.Progress != 1 || done.Error != "" {
		t.Fatalf("the save ended as %+v", done)
	}
	for _, name := range []string{"Intro.mkv", "Outro.mkv"} {
		if got := string(mustReadBytes(t, filepath.Join(root, "films", name))); got != "segment" {
			t.Errorf("%s holds %q, want what ffmpeg wrote", name, got)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(root, "films"))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".saving") {
			t.Errorf("%s was left behind", entry.Name())
		}
	}
}

func TestStoppingASaveLeavesTheFileAsItWas(t *testing.T) {
	s, root := newFileTestServer(t)
	hanging := fakeFFmpeg(t, true)
	s.UseFFmpeg(func() (string, bool) { return hanging, true })
	mustWriteBytes(t, filepath.Join(root, "clip.mp4"), []byte("video"))
	mustWriteBytes(t, filepath.Join(root, "Intro.mkv"), []byte("earlier"))
	body := SaveSegmentsRequestDto{Path: "clip.mp4", Segments: []SegmentDto{{Name: "Intro", ToMs: 700}}}

	job := startSave(t, s, body)

	// One save at a time: an encoder already uses every core.
	if rec := do(s, saveRequest(t, body)); rec.Code != http.StatusBadRequest ||
		!strings.Contains(rec.Body.String(), errSaveRunning.Error()) {
		t.Errorf("a second save while one runs = %d %s, want 400", rec.Code, rec.Body.String())
	}

	if rec := do(s, httptest.NewRequest(http.MethodDelete, "/media/jobs/"+job.ID, nil)); rec.Code != http.StatusOK {
		t.Fatalf("DELETE /media/jobs/%s = %d %s", job.ID, rec.Code, rec.Body.String())
	}
	stopped := waitForSave(t, s, job.ID)
	if stopped.State != MediaJobStopped || stopped.Error != "" || stopped.Done != 0 {
		t.Errorf("the stopped save reads %+v", stopped)
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "Intro.mkv"))); got != "earlier" {
		t.Errorf("Intro.mkv holds %q, want the earlier save it had", got)
	}
	if _, err := os.Stat(filepath.Join(root, ".Intro.mkv.saving")); !os.IsNotExist(err) {
		t.Errorf("the half-written segment was left behind: %v", err)
	}

	// And the slot is free again.
	finishing := fakeFFmpeg(t, false)
	s.UseFFmpeg(func() (string, bool) { return finishing, true })
	if again := waitForSave(t, s, startSave(t, s, body).ID); again.State != MediaJobDone {
		t.Errorf("the save after a stopped one ended as %+v", again)
	}
}

func TestSaveSegmentsWithoutFFmpegIs424(t *testing.T) {
	s, root := newFileTestServer(t)
	s.UseFFmpeg(func() (string, bool) { return "", false })
	mustWriteBytes(t, filepath.Join(root, "clip.mp4"), []byte("video"))

	rec := do(s, saveRequest(t, SaveSegmentsRequestDto{Path: "clip.mp4",
		Segments: []SegmentDto{{Name: "Intro", ToMs: 700}}}))
	if rec.Code != http.StatusFailedDependency || !strings.Contains(rec.Body.String(), "FFmpeg is not installed") {
		t.Errorf("a save with no ffmpeg = %d %s, want 424 saying so", rec.Code, rec.Body.String())
	}
}

// TestSaveSegmentsRefusesBeforeAnythingRuns: what is refused is refused whether or not there is an
// ffmpeg to run — a caller learns about a bad name before it is offered an install.
func TestSaveSegmentsRefusesBeforeAnythingRuns(t *testing.T) {
	s, root := newFileTestServer(t)
	s.UseFFmpeg(func() (string, bool) { return "", false })
	mustWriteBytes(t, filepath.Join(root, "clip.mp4"), []byte("video"))
	mustMkdir(t, root, "films")

	cases := []struct {
		name   string
		body   SaveSegmentsRequestDto
		status int
	}{
		{"a name that is a path", SaveSegmentsRequestDto{Path: "clip.mp4",
			Segments: []SegmentDto{{Name: "../x", ToMs: 1}}}, http.StatusBadRequest},
		{"a folder", SaveSegmentsRequestDto{Path: "films",
			Segments: []SegmentDto{{Name: "x", ToMs: 1}}}, http.StatusBadRequest},
		{"a file that is not there", SaveSegmentsRequestDto{Path: "gone.mp4",
			Segments: []SegmentDto{{Name: "x", ToMs: 1}}}, http.StatusNotFound},
		{"outside the store", SaveSegmentsRequestDto{Path: "../clip.mp4",
			Segments: []SegmentDto{{Name: "x", ToMs: 1}}}, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if rec := do(s, saveRequest(t, c.body)); rec.Code != c.status {
				t.Errorf("status = %d %s, want %d", rec.Code, rec.Body.String(), c.status)
			}
		})
	}

	if rec := do(s, httptest.NewRequest(http.MethodGet, "/media/jobs/save-nothing", nil)); rec.Code != http.StatusBadRequest {
		t.Errorf("an unknown save = %d, want 400", rec.Code)
	}
}

// ── the real thing ────────────────────────────────────────────────────────────

// realFFmpeg is an ffmpeg to run, or a skip: KIAO_TEST_FFMPEG names one — the toolbox's, say — and
// the PATH is looked in otherwise.
func realFFmpeg(t *testing.T) string {
	t.Helper()
	if named := os.Getenv("KIAO_TEST_FFMPEG"); named != "" {
		return named
	}
	found, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("no ffmpeg on this machine; set KIAO_TEST_FFMPEG to one to run this")
	}
	return found
}

// TestSaveSegmentsWithFFmpeg cuts a real clip with a real ffmpeg, and reads what it wrote back with
// ffmpeg itself: Matroska, AV1 and Opus — and exactly the images the segment names, starting on one
// that is not a key image.
func TestSaveSegmentsWithFFmpeg(t *testing.T) {
	ffmpeg := realFFmpeg(t)
	s, root := newFileTestServer(t)
	s.UseFFmpeg(func() (string, bool) { return ffmpeg, true })

	// Two seconds, ten images a second and a key image every seventh, with a tone under them. mpeg4
	// and aac, because every build of ffmpeg carries those two encoders.
	mustMkdir(t, root, "films")
	made := core.RunProc([]string{ffmpeg, "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=128x96:rate=10:duration=2",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:v", "mpeg4", "-g", "7", "-c:a", "aac", "-shortest", filepath.Join(root, "films", "clip.mp4"),
	}, root, time.Minute, nil)
	if !made.OK() {
		t.Fatalf("making the clip: %s", made.Combined())
	}

	// The seventh image to the fifteenth: from 0.6 s to the end of the image that starts at 1.4.
	job := startSave(t, s, SaveSegmentsRequestDto{Path: "films/clip.mp4",
		Segments: []SegmentDto{{Name: "Middle", FromMs: 600, ToMs: 1500}}})
	if done := waitForSave(t, s, job.ID); done.State != MediaJobDone {
		t.Fatalf("the save ended as %+v", done)
	}

	saved := filepath.Join(root, "films", "Middle.mkv")
	read := core.RunProc([]string{ffmpeg, "-hide_banner", "-i", saved}, root, time.Minute, nil)
	for _, want := range []string{"matroska", ": Video: av1", ": Audio: opus"} {
		if !strings.Contains(read.Stderr, want) {
			t.Errorf("%s is not what a save makes — %q is not in:\n%s", saved, want, read.Stderr)
		}
	}

	counted := core.RunProc([]string{ffmpeg, "-hide_banner", "-loglevel", "error", "-i", saved,
		"-map", "0:v:0", "-f", "null", "-progress", "pipe:1", "-"}, root, time.Minute, nil)
	frames := ""
	for _, line := range strings.Split(counted.Stdout, "\n") {
		if value, ok := strings.CutPrefix(line, "frame="); ok {
			frames = strings.TrimSpace(value)
		}
	}
	if frames != "9" {
		t.Errorf("the segment has %q images, want 9 (%s)", frames, counted.Combined())
	}
}
