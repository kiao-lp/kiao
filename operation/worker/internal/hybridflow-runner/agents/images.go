package agents

import (
	"mime"
	"path/filepath"
	"strings"
)

const MaxPromptAttachments = 10

// Use the extension, not the client's untrusted (often generic) Content-Type.
func AttachmentMediaType(name string) string {
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		// The wire expects the media type without parameters.
		if semi := strings.IndexByte(ct, ';'); semi >= 0 {
			return strings.TrimSpace(ct[:semi])
		}
		return ct
	}
	return "application/octet-stream"
}
