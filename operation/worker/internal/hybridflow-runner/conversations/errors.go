package conversations

import (
	"kiao/worker/internal/core/errors"
)

// Invalid IDs classify as HTTP 400; validate before filepath.Join to prevent traversal.
// A missing valid ID is instead 404.
var errBadConversationID = faults.Invalid("invalid conversation id")

var errBadAttachmentID = faults.Invalid("invalid attachment id")
