package media

// Segments are saved as separate files beside the source.
type SaveSegmentsRequestDto struct {
	Path     string       `json:"path"`
	Segments []SegmentDto `json:"segments"`
}

// Name excludes the extension. Bounds span the first frame start to the last frame end,
// in fractional milliseconds.
type SegmentDto struct {
	Name   string  `json:"name"`
	FromMs float64 `json:"fromMs"`
	ToMs   float64 `json:"toMs"`
}

// A stopped save is not a failure.
const (
	MediaJobRunning = "running"
	MediaJobDone    = "done"
	MediaJobFailed  = "failed"
	MediaJobStopped = "stopped"
)

type MediaJobDto struct {
	ID    string `json:"id"`
	Path  string `json:"path"`
	State string `json:"state"`
	// Files lists output store paths in write order; Done counts completed files, Current is in progress.
	Files   []string `json:"files"`
	Done    int      `json:"done"`
	Current string   `json:"current,omitempty"`
	// Progress is 0–1 across the save, weighted by encoded duration.
	Progress  float64 `json:"progress"`
	Error     string  `json:"error,omitempty"`
	StartedAt string  `json:"startedAt"`
	EndedAt   string  `json:"endedAt,omitempty"`
}
