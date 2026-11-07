package conversations

import (
	"fmt"
	"io"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const AttachmentsDirName = "claude-attachments"

// Cap uploads to limit the context a turn can consume.
const MaxAttachmentBytes int64 = 25 << 20

// Keep concurrent uploads out of the heap; larger parts spill to request-scoped temp files.
const AttachmentParseMemoryBytes int64 = 1 << 20

// Allow multipart overhead above the file limit; save enforces the actual file size.
const AttachmentEnvelopeBytes int64 = 1 << 16

// Sweep only at startup to avoid racing turns reading attachments.
// Long-running services retain bytes until restart; transcript metadata survives the sweep.
const AttachmentTTL = 30 * 24 * time.Hour

// attachmentIDRe prevents client-supplied IDs from escaping their directory.
// IDs embed the reduced filename to avoid sidecars and give the model a readable path.
var AttachmentIDRe = regexp.MustCompile(`^att-[0-9]{13,}-[0-9a-f]{4}-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

// claudeAttachment keeps the host Path off the wire; clients fetch bytes by ID.
type ClaudeAttachment struct {
	ID        string
	Name      string
	Size      int64
	MediaType string
	Path      string
}

// AttachmentStore needs no lock: exclusive file creation prevents upload collisions; reads do not mutate.
type AttachmentStore struct {
	Dir      string
	MaxBytes int64

	// Injectable to test ID collisions.
	newID func(safeName string) string
}

func NewAttachmentStore(dir string) (*AttachmentStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("attachment directory: %w", err)
	}
	return &AttachmentStore{
		Dir:      dir,
		MaxBytes: MaxAttachmentBytes,
		newID: func(safeName string) string {
			return "att-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4] + "-" + safeName
		},
	}, nil
}

// safeAttachmentName reduces names rather than escaping them; the reduced name is also displayed.
// Preserve extensions for media-type detection and the Read tool.
func SafeAttachmentName(name string) string {
	base := filepath.Base(strings.ReplaceAll(strings.TrimSpace(name), `\`, "/"))
	var sb strings.Builder
	lastDash := false
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_':
			sb.WriteRune(r)
			lastDash = false
		case !lastDash:
			sb.WriteByte('-')
			lastDash = true
		}
	}
	safe := strings.Trim(sb.String(), "-._")
	// The ID requires a leading alphanumeric and at most 80 characters; use a fallback for empty names.
	if safe == "" {
		safe = "file"
	}
	if len(safe) > 80 {
		// Trim from the front to preserve the extension.
		safe = safe[len(safe)-80:]
		safe = strings.TrimLeft(safe, "-._")
		if safe == "" {
			safe = "file"
		}
	}
	if first := safe[0]; !(first >= 'a' && first <= 'z' || first >= 'A' && first <= 'Z' || first >= '0' && first <= '9') {
		safe = "f" + safe
	}
	return safe
}

// attachmentDisplayName expects an ID already validated by attachmentIDRe.
func attachmentDisplayName(id string) string {
	parts := strings.SplitN(id, "-", 4)
	if len(parts) < 4 {
		return id
	}
	return parts[3]
}

// save enforces the byte limit while reading, independent of untrusted multipart headers,
// and removes partial files on failure so turns cannot read truncated attachments.
func (s *AttachmentStore) Save(name string, r io.Reader) (ClaudeAttachment, error) {
	safe := SafeAttachmentName(name)
	id := s.newID(safe)
	if !AttachmentIDRe.MatchString(id) {
		return ClaudeAttachment{}, errBadAttachmentID
	}
	path := filepath.Join(s.Dir, id)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return ClaudeAttachment{}, fmt.Errorf("attachment file: %w", err)
	}
	written, err := io.Copy(f, io.LimitReader(r, s.MaxBytes+1))
	closeErr := f.Close()
	switch {
	case err != nil:
		_ = os.Remove(path)
		return ClaudeAttachment{}, fmt.Errorf("attachment file: %w", err)
	case closeErr != nil:
		_ = os.Remove(path)
		return ClaudeAttachment{}, fmt.Errorf("attachment file: %w", closeErr)
	case written > s.MaxBytes:
		_ = os.Remove(path)
		return ClaudeAttachment{}, &httpkit.HTTPError{Status: http.StatusRequestEntityTooLarge, Msg: fmt.Sprintf(
			"An attachment may be at most %d MB.", s.MaxBytes>>20)}
	}
	return ClaudeAttachment{
		ID: id, Name: safe, Size: written, MediaType: agentapi.AttachmentMediaType(safe), Path: path,
	}, nil
}

// resolve returns 400 for malformed IDs and 404 for missing or swept attachments.
func (s *AttachmentStore) Resolve(id string) (ClaudeAttachment, error) {
	if !AttachmentIDRe.MatchString(id) {
		return ClaudeAttachment{}, fmt.Errorf("%w: %s", errBadAttachmentID, id)
	}
	path := filepath.Join(s.Dir, id)
	info, err := os.Stat(path)
	if err != nil {
		return ClaudeAttachment{}, fmt.Errorf("%w: attachment %s", os.ErrNotExist, id)
	}
	if info.IsDir() {
		return ClaudeAttachment{}, fmt.Errorf("%w: attachment %s", os.ErrNotExist, id)
	}
	name := attachmentDisplayName(id)
	return ClaudeAttachment{
		ID: id, Name: name, Size: info.Size(), MediaType: agentapi.AttachmentMediaType(name), Path: path,
	}, nil
}

// sweep runs only at startup, before sockets open, so no turn can be reading an attachment.
func (s *AttachmentStore) Sweep(maxAge time.Duration) int {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !AttachmentIDRe.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if os.Remove(filepath.Join(s.Dir, entry.Name())) == nil {
			removed++
		}
	}
	return removed
}

func (a ClaudeAttachment) Dto() AgentAttachmentDto {
	return AgentAttachmentDto{ID: a.ID, Name: a.Name, Size: a.Size, MediaType: a.MediaType}
}
