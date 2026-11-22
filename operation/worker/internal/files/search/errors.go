package search

import (
	"kiao/worker/internal/core/errors"
)

// These errors map to HTTP 400; their text is shown to the user.
// Invalid regex or a query containing only negations.
var ErrBadPattern = faults.Invalid("invalid search pattern")

var ErrNotADocument = faults.Invalid("not a document")
