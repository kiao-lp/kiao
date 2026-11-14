package content

import (
	"kiao/worker/internal/core/errors"
)

// Reject recursive copies into their source before writing anything.
var errCopyIntoSelf = faults.Invalid("cannot copy an entry into itself")

// The path is a folder, or bytes no zip reader accepts.
var ErrNotZip = faults.Invalid("not a zip archive")

// One entry cannot come out: outside the folder, over the archive itself, not a file or a
// folder, or clashing with the wrong kind of entry already there. The detail names it.
var ErrZipEntry = faults.Invalid("the archive holds a file that cannot be extracted")
