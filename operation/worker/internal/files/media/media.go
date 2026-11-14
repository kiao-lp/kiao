package media

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	"kiao/worker/internal/core/process"
	"kiao/worker/internal/files/search"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ffmpegStatus is what a save answers when this machine has no ffmpeg able to do it: 424, which is
// Dashboard's cue to offer to install one. Not a caller's mistake — the request was sound, and it is
// the machine that is not ready for it.
const ffmpegStatus = http.StatusFailedDependency

// segmentExtension is what every segment is saved as.
const segmentExtension = ".mkv"

// cutMarginMs is how far both ends of a span are drawn in before ffmpeg is asked for it. A span runs
// from the start of its first image to the start of the image after its last, and ffmpeg keeps an
// image that starts inside the window it is given: drawn in by half a millisecond, the window keeps
// the first image — whose start a Matroska file may have rounded up to the millisecond it stores —
// and leaves out the next one, whichever way either was rounded. Half a millisecond is less than
// half of any image, at any rate a camera records at.
const cutMarginMs = 0.5

// probeTimeout bounds the two quick questions asked of ffmpeg before a save starts: which encoders
// it has, and what the file to cut holds.
const probeTimeout = 30 * time.Second

// errSaveStopped is how a segment ends when its save was stopped: not a failure, and never shown.
var errSaveStopped = errors.New("the save was stopped")

// encoderChoice is one encoder a save may use, with the arguments that make it one worth waiting for.
type encoderChoice struct {
	Name string
	args []string
}

// av1Encoders, the preferred first. SVT-AV1 is the one fast enough to wait for; libaom is the
// reference, several times slower for the same quality; rav1e is the last resort. Each is asked for
// a constant quality rather than a bitrate, because a segment is kept rather than streamed.
var Av1Encoders = []encoderChoice{
	{"libsvtav1", []string{"-c:v", "libsvtav1", "-preset", "8", "-crf", "32"}},
	{"libaom-av1", []string{"-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-crf", "32", "-b:v", "0"}},
	{"librav1e", []string{"-c:v", "librav1e", "-speed", "8", "-qp", "100"}},
}

// opusEncoders, the preferred first: libopus, then the one FFmpeg carries itself and still calls
// experimental.
var OpusEncoders = []encoderChoice{
	{"libopus", []string{"-c:a", "libopus", "-b:a", "128k"}},
	{"opus", []string{"-c:a", "opus", "-strict", "experimental", "-b:a", "128k"}},
}

// mediaCutter is the one save slot, and what a save needs: the store, and where ffmpeg is.
type MediaCutter struct {
	storage *filesystem.Storage
	// ffmpeg answers where ffmpeg is, right now: the toolbox's answer in a running service (see
	// UseFFmpeg), the PATH's in every test and every service assembled without one.
	Ffmpeg func() (string, bool)

	mu      sync.Mutex
	current *MediaJob
}

func NewMediaCutter(storage *filesystem.Storage) *MediaCutter {
	return &MediaCutter{storage: storage, Ffmpeg: ffmpegOnPath}
}

func ffmpegOnPath() (string, bool) {
	found, err := exec.LookPath("ffmpeg")
	return found, err == nil
}

// save checks what was asked, asks ffmpeg whether it can do it, and starts the job. Everything that
// can be refused is refused here, before a file is touched: a save that stopped on its third segment
// over a name would already have replaced the first two.
func (m *MediaCutter) Save(req SaveSegmentsRequestDto) (*MediaJobDto, error) {
	rel := filesystem.NormaliseVirtual(req.Path)
	abs, err := m.storage.Resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%w: %s", search.ErrNotADocument, rel)
	}
	files, spans, err := SegmentFiles(rel, req.Segments)
	if err != nil {
		return nil, err
	}

	ffmpeg, ok := m.Ffmpeg()
	if !ok {
		return nil, &httpkit.HTTPError{Status: ffmpegStatus,
			Msg: "FFmpeg is not installed on this machine, and saving segments needs it"}
	}
	codecs, err := chooseCodecs(ffmpeg, abs)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current != nil && m.current.running() {
		return nil, ErrSaveRunning
	}
	ctx, stop := context.WithCancel(context.Background())
	job := &MediaJob{
		id:        "save-" + idgen.NowMillisStr() + "-" + idgen.RandID(),
		path:      rel,
		Files:     files,
		Spans:     spans,
		stop:      stop,
		State:     MediaJobRunning,
		startedAt: mediaStamp(),
	}
	m.current = job
	go m.run(ctx, job, ffmpeg, abs, req.Segments, codecs)
	return job.Dto(), nil
}

// run is the job: each segment in turn, its file put in place as soon as it is whole, so a save that
// fails or is stopped on the fourth segment has saved three.
func (m *MediaCutter) run(ctx context.Context, job *MediaJob, ffmpeg, source string, segments []SegmentDto, codecs []string) {
	defer job.stop()
	started := time.Now()
	logMedia.Info("segments save started", "job", job.id, "path", job.path, "segments", len(segments))
	for i, segment := range segments {
		dest, err := m.storage.Resolve(job.Files[i])
		if err == nil {
			err = cutSegment(ctx, ffmpeg, source, dest, segment, codecs, job.Advance)
		}
		if err != nil {
			job.Finish(err)
			if errors.Is(err, errSaveStopped) {
				logMedia.Info("segments save stopped", "job", job.id, "saved", i, "duration", time.Since(started))
			} else {
				logMedia.Error("segments save failed", "job", job.id, "segment", job.Files[i], "error", err)
			}
			return
		}
		job.Saved()
	}
	job.Finish(nil)
	logMedia.Info("segments save finished", "job", job.id, "saved", len(segments), "duration", time.Since(started))
}

// job answers the save with this id, which is only ever the one in hand.
func (m *MediaCutter) Job(id string) (*MediaJobDto, error) {
	job, err := m.find(id)
	if err != nil {
		return nil, err
	}
	return job.Dto(), nil
}

// stopJob stops the save with this id where it stands. ffmpeg is killed and the file it was writing
// goes with it; the segments already saved stay. Stopping a save that has ended changes nothing.
func (m *MediaCutter) StopJob(id string) (*MediaJobDto, error) {
	job, err := m.find(id)
	if err != nil {
		return nil, err
	}
	job.stop()
	return job.Dto(), nil
}

func (m *MediaCutter) find(id string) (*MediaJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil || m.current.id != id {
		return nil, fmt.Errorf("%w: %s", errNoSave, id)
	}
	return m.current, nil
}

// segmentFiles is where each segment is saved — `<the source's folder>/<name>.mkv` — and how long
// each is, in seconds. It refuses whatever would not make a file of its own: a name that cannot be
// one, two segments landing on the same file, one landing on the source itself, a segment with no
// length.
func SegmentFiles(source string, segments []SegmentDto) ([]string, []float64, error) {
	if len(segments) == 0 {
		return nil, nil, ErrNoSegments
	}
	folder := path.Dir(source)
	// Compared without case, because the store may be a Drive or a Windows disk, where `Intro.mkv`
	// and `intro.mkv` are one file.
	sourceKey := strings.ToLower(path.Base(source))
	taken := map[string]string{}
	files := make([]string, 0, len(segments))
	spans := make([]float64, 0, len(segments))
	for _, segment := range segments {
		if !isPlainName(segment.Name) {
			return nil, nil, fmt.Errorf("%w: %q", ErrSegmentName, segment.Name)
		}
		file := segment.Name + segmentExtension
		key := strings.ToLower(file)
		if key == sourceKey {
			return nil, nil, fmt.Errorf("%w: %s", ErrSegmentIsSource, file)
		}
		if other, twice := taken[key]; twice {
			return nil, nil, fmt.Errorf("%w: %q and %q are both %s", ErrSegmentTwice, other, segment.Name, file)
		}
		taken[key] = segment.Name
		if !(segment.FromMs >= 0 && segment.ToMs > segment.FromMs) || math.IsInf(segment.ToMs, 0) {
			return nil, nil, fmt.Errorf("%w: %q", ErrSegmentLength, segment.Name)
		}
		files = append(files, path.Join(folder, file))
		spans = append(spans, (segment.ToMs-segment.FromMs)/1000)
	}
	return files, spans, nil
}

// isPlainName reports whether name can be a file of the source's folder and nothing else: not
// empty, not a path, not hidden, and without the spaces at either end a Windows disk drops. Dashboard
// names a segment's file as the store names a file after a title (toStoreName), which never makes
// one of these — this is the boundary for a caller that does not.
func isPlainName(name string) bool {
	return name != "" && strings.TrimSpace(name) == name && !strings.HasPrefix(name, ".") &&
		!strings.ContainsAny(name, "/\\\x00")
}

// chooseCodecs asks ffmpeg what it can encode and what the source holds, and answers the codec
// arguments of every segment of it — or 424 when this ffmpeg cannot make what a save makes. A
// recording needs no AV1 encoder, since it has no picture to encode.
func chooseCodecs(ffmpeg, source string) ([]string, error) {
	listing := process.RunProc([]string{ffmpeg, "-hide_banner", "-encoders"}, "", probeTimeout, nil)
	if !listing.OK() {
		return nil, &httpkit.HTTPError{Status: ffmpegStatus,
			Msg: fmt.Sprintf("the FFmpeg at %s does not answer: %s", ffmpeg, lastLine(listing.Combined()))}
	}
	have := EncodersOf(listing.Stdout)

	// Always exits 1, since no output is named, and says what it read on stderr.
	probe := process.RunProc([]string{ffmpeg, "-hide_banner", "-nostdin", "-i", source}, "", probeTimeout, nil)
	if !strings.Contains(probe.Stderr, "Input #0") {
		return nil, fmt.Errorf("%w: %s", errNotMedia, lastLine(probe.Combined()))
	}
	picture, sound := StreamsOf(probe.Stderr)
	if !picture && !sound {
		return nil, fmt.Errorf("%w: it holds neither a picture nor a sound", errNotMedia)
	}

	var codecs []string
	if picture {
		video, ok := PickEncoder(Av1Encoders, have)
		if !ok {
			return nil, &httpkit.HTTPError{Status: ffmpegStatus, Msg: fmt.Sprintf(
				"the FFmpeg at %s cannot encode AV1: it has none of libsvtav1, libaom-av1 and librav1e", ffmpeg)}
		}
		codecs = append(codecs, video.args...)
	}
	if sound {
		audio, ok := PickEncoder(OpusEncoders, have)
		if !ok {
			return nil, &httpkit.HTTPError{Status: ffmpegStatus,
				Msg: fmt.Sprintf("the FFmpeg at %s cannot encode Opus", ffmpeg)}
		}
		codecs = append(codecs, audio.args...)
	}
	return codecs, nil
}

// encoderFlags is the column `ffmpeg -encoders` opens every line with: six characters, a letter or
// a dot each.
var encoderFlags = regexp.MustCompile(`^[A-Z.]{6}$`)

// encodersOf reads the names out of `ffmpeg -encoders` — a legend, a rule, then one line per
// encoder: its flags, its name, and what it is.
func EncodersOf(listing string) map[string]bool {
	have := map[string]bool{}
	for _, line := range strings.Split(listing, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && encoderFlags.MatchString(fields[0]) {
			have[fields[1]] = true
		}
	}
	return have
}

func PickEncoder(choices []encoderChoice, have map[string]bool) (encoderChoice, bool) {
	for _, choice := range choices {
		if have[choice.Name] {
			return choice, true
		}
	}
	return encoderChoice{}, false
}

// streamsOf reads which kinds of stream `ffmpeg -i` found — its `Stream #0:0…: Video: …` lines —
// with a picture marked `(attached pic)` counting as none: that is an MP3's album art, not a video.
func StreamsOf(probe string) (picture, sound bool) {
	for _, line := range strings.Split(probe, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Stream #") {
			continue
		}
		switch {
		case strings.Contains(line, ": Video: ") && !strings.Contains(line, "(attached pic)"):
			picture = true
		case strings.Contains(line, ": Audio: "):
			sound = true
		}
	}
	return picture, sound
}

// segmentArgs is the command line for one segment. The window is seeked on the input, so ffmpeg
// decodes from the key image before it and keeps from the first image inside it — a cut to the
// image, which a copy of the stream could only make on a key image. Then the first video stream that
// is a picture rather than a cover, `0:V`, and every audio stream; no chapters, whose times belong to
// the whole file; and Matroska, whatever the temporary name says.
func SegmentArgs(source, dest string, segment SegmentDto, codecs []string) []string {
	from := math.Max(0, segment.FromMs-cutMarginMs)
	until := segment.ToMs - cutMarginMs
	args := []string{
		"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
		"-ss", seconds(from), "-i", source, "-t", seconds(until - from),
		"-map", "0:V:0?", "-map", "0:a?", "-map_chapters", "-1",
	}
	args = append(args, codecs...)
	return append(args, "-f", "matroska", "-y", dest)
}

// seconds writes milliseconds as the seconds ffmpeg reads, to the microsecond it counts in.
func seconds(ms float64) string { return strconv.FormatFloat(ms/1000, 'f', 6, 64) }

// cutSegment runs ffmpeg for one segment. The file is written beside its destination under a dotted
// name — hidden from every listing, and on the same filesystem, so that the rename putting it in
// place is atomic — and renamed over the destination only once ffmpeg has finished it: a save that
// fails or is stopped halfway leaves the file of that name as it was.
func cutSegment(ctx context.Context, ffmpeg, source, dest string, segment SegmentDto, codecs []string, progress func(float64)) error {
	temp := filepath.Join(filepath.Dir(dest), "."+filepath.Base(dest)+".saving")
	cmd := exec.CommandContext(ctx, ffmpeg, SegmentArgs(source, temp, segment, codecs)...)
	report, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	complaint := &stderrTail{}
	cmd.Stderr = complaint
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg would not start: %w", err)
	}
	followProgress(report, progress)
	if err := cmd.Wait(); err != nil {
		os.Remove(temp)
		if ctx.Err() != nil {
			return errSaveStopped
		}
		return fmt.Errorf("ffmpeg could not save %s: %s", filepath.Base(dest), complaint.said(err))
	}
	if err := os.Rename(temp, dest); err != nil {
		os.Remove(temp)
		return fmt.Errorf("cannot put %s in place: %w", filepath.Base(dest), err)
	}
	return nil
}

// followProgress reads ffmpeg's `-progress` report — blocks of `key=value` lines, one every half
// second — and hands on how far into the segment it has written, in seconds. It returns when ffmpeg
// closes its end, which is when it exits.
func followProgress(report io.Reader, progress func(float64)) {
	scanner := bufio.NewScanner(report)
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), "=")
		if !ok || key != "out_time_us" {
			continue
		}
		if us, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil && us >= 0 {
			progress(float64(us) / 1e6)
		}
	}
	// Whatever is left unread would stall ffmpeg on a full pipe.
	_, _ = io.Copy(io.Discard, report)
}

// stderrTail keeps the end of what ffmpeg says, which with `-loglevel error` is its complaint and
// nothing else.
type stderrTail struct {
	mu   sync.Mutex
	text []byte
}

const stderrTailBytes = 4 << 10

func (t *stderrTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.text = append(t.text, p...)
	if len(t.text) > stderrTailBytes {
		t.text = t.text[len(t.text)-stderrTailBytes:]
	}
	return len(p), nil
}

// said is the complaint as one line, or how ffmpeg ended when it said nothing.
func (t *stderrTail) said(exit error) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if line := lastLine(string(t.text)); line != "" {
		return line
	}
	return exit.Error()
}

// lastLine is the last line of a tool's output that says anything.
func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return ""
}

// mediaJob is one save. There is at most one running, and the last one is kept once it has ended,
// so the panel that started it can read how it ended — until the next save replaces it.
type MediaJob struct {
	id    string
	path  string
	Files []string
	Spans []float64 // each segment's length in seconds, which is what the progress is measured by
	stop  context.CancelFunc

	mu        sync.Mutex
	State     string
	done      int
	written   float64 // how many seconds of the segment in hand ffmpeg has written
	err       string
	startedAt string
	endedAt   string
}

func (j *MediaJob) Advance(seconds float64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.written = seconds
}

func (j *MediaJob) Saved() {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done++
	j.written = 0
}

func (j *MediaJob) Finish(err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.endedAt = mediaStamp()
	switch {
	case err == nil:
		j.State = MediaJobDone
	case errors.Is(err, errSaveStopped):
		j.State = MediaJobStopped
	default:
		j.State, j.err = MediaJobFailed, err.Error()
	}
}

func (j *MediaJob) running() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.State == MediaJobRunning
}

func (j *MediaJob) Dto() *MediaJobDto {
	j.mu.Lock()
	defer j.mu.Unlock()
	dto := &MediaJobDto{
		ID:        j.id,
		Path:      j.path,
		State:     j.State,
		Files:     append([]string{}, j.Files...),
		Done:      j.done,
		Error:     j.err,
		StartedAt: j.startedAt,
		EndedAt:   j.endedAt,
	}
	if j.State == MediaJobRunning && j.done < len(j.Files) {
		dto.Current = j.Files[j.done]
	}
	var total, behind float64
	for i, span := range j.Spans {
		total += span
		switch {
		case i < j.done:
			behind += span
		case i == j.done:
			behind += math.Min(j.written, span)
		}
	}
	if j.State == MediaJobDone || total <= 0 {
		dto.Progress = 1
	} else {
		dto.Progress = math.Min(1, behind/total)
	}
	return dto
}

func mediaStamp() string { return time.Now().UTC().Format(time.RFC3339) }
