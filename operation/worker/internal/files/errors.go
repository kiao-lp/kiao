package files

import "kiao/worker/internal/core"

// These errors map to HTTP 400; their text is shown to the user.
var (
	// Invalid regex or a query containing only negations.
	errBadPattern = core.Invalid("invalid search pattern")
	// Reject recursive copies into their source before writing anything.
	errCopyIntoSelf = core.Invalid("cannot copy an entry into itself")
	errNotADocument = core.Invalid("not a document")
	errNoSegments = core.Invalid("no segment to save")
	// Segment names must be nonempty, nonhidden basenames.
	errSegmentName = core.Invalid("a segment's name cannot be a file name")
	errSegmentTwice = core.Invalid("two segments would be saved as the same file")
	errSegmentIsSource = core.Invalid("a segment would be saved over the file it is cut from")
	errSegmentLength = core.Invalid("a segment has no length")
	errNotMedia = core.Invalid("not a video or a recording ffmpeg can read")
	// Only one encoder runs at a time because it uses every core.
	errSaveRunning = core.Invalid("a save is already running")
	// Only the last save is retained.
	errNoSave = core.Invalid("unknown save")
)
