package filesystem

import (
	"kiao/worker/internal/core/errors"
)

var (
	ErrNotDirectory = faults.Invalid("path is not a directory")
	// State contains private service data, not browsable content.
	ErrStatePath = faults.Invalid("path belongs to the service's state directory")
	// Empty and "/" paths resolve to the root; deleting it would remove the whole store.
	ErrDeleteRoot = faults.Invalid("refusing to delete the storage root")
)
