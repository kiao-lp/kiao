package hybridflowrunner

import "kiao/worker/internal/core"

// Invalid IDs classify as HTTP 400; validate before filepath.Join to prevent traversal.
// A missing valid ID is instead 404.
var (
	errBadConversationID = core.Invalid("invalid conversation id")
	errBadAttachmentID = core.Invalid("invalid attachment id")
)
