package media

import (
	"kiao/worker/internal/core/errors"
)

var ErrNoSegments = faults.Invalid("no segment to save")

// Segment names must be nonempty, nonhidden basenames.
var ErrSegmentName = faults.Invalid("a segment's name cannot be a file name")

var ErrSegmentTwice = faults.Invalid("two segments would be saved as the same file")

var ErrSegmentIsSource = faults.Invalid("a segment would be saved over the file it is cut from")

var ErrSegmentLength = faults.Invalid("a segment has no length")

var errNotMedia = faults.Invalid("not a video or a recording ffmpeg can read")

// Only one encoder runs at a time because it uses every core.
var ErrSaveRunning = faults.Invalid("a save is already running")

// Only the last save is retained.
var errNoSave = faults.Invalid("unknown save")
