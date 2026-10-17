package hybridflowrunner

import (
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Attachments live on the service host: the text-only CLI prompt names a file for Read.
// Keep them in per-store state, outside content listings, git and publication.
// Attachment access relies on the HTTP bearer token, not per-ID access control.

const (
	attachmentsDirName = "claude-attachments"

	// Cap uploads to limit the context a turn can consume.
	maxAttachmentBytes int64 = 25 << 20

	maxPromptAttachments = 10

	// Keep concurrent uploads out of the heap; larger parts spill to request-scoped temp files.
	attachmentParseMemoryBytes int64 = 1 << 20

	// Allow multipart overhead above the file limit; save enforces the actual file size.
	attachmentEnvelopeBytes int64 = 1 << 16

	// Sweep only at startup to avoid racing turns reading attachments.
	// Long-running services retain bytes until restart; transcript metadata survives the sweep.
	attachmentTTL = 30 * 24 * time.Hour
)

// attachmentIDRe prevents client-supplied IDs from escaping their directory.
// IDs embed the reduced filename to avoid sidecars and give the model a readable path.
var attachmentIDRe = regexp.MustCompile(`^att-[0-9]{13,}-[0-9a-f]{4}-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

// claudeAttachment keeps the host Path off the wire; clients fetch bytes by ID.
type claudeAttachment struct {
	ID        string
	Name      string
	Size      int64
	MediaType string
	Path      string
}

// AttachmentStore needs no lock: exclusive file creation prevents upload collisions; reads do not mutate.
type AttachmentStore struct {
	dir      string
	maxBytes int64

	// Injectable to test ID collisions.
	newID func(safeName string) string
}

func newAttachmentStore(dir string) (*AttachmentStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("attachment directory: %w", err)
	}
	return &AttachmentStore{
		dir:      dir,
		maxBytes: maxAttachmentBytes,
		newID: func(safeName string) string {
			return "att-" + core.NowMillisStr() + "-" + core.RandID()[:4] + "-" + safeName
		},
	}, nil
}

// safeAttachmentName reduces names rather than escaping them; the reduced name is also displayed.
// Preserve extensions for media-type detection and the Read tool.
func safeAttachmentName(name string) string {
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

// Use the extension, not the client's untrusted (often generic) Content-Type.
func attachmentMediaType(name string) string {
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		// The wire expects the media type without parameters.
		if semi := strings.IndexByte(ct, ';'); semi >= 0 {
			return strings.TrimSpace(ct[:semi])
		}
		return ct
	}
	return "application/octet-stream"
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
func (s *AttachmentStore) save(name string, r io.Reader) (claudeAttachment, error) {
	safe := safeAttachmentName(name)
	id := s.newID(safe)
	if !attachmentIDRe.MatchString(id) {
		return claudeAttachment{}, errBadAttachmentID
	}
	path := filepath.Join(s.dir, id)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return claudeAttachment{}, fmt.Errorf("attachment file: %w", err)
	}
	written, err := io.Copy(f, io.LimitReader(r, s.maxBytes+1))
	closeErr := f.Close()
	switch {
	case err != nil:
		_ = os.Remove(path)
		return claudeAttachment{}, fmt.Errorf("attachment file: %w", err)
	case closeErr != nil:
		_ = os.Remove(path)
		return claudeAttachment{}, fmt.Errorf("attachment file: %w", closeErr)
	case written > s.maxBytes:
		_ = os.Remove(path)
		return claudeAttachment{}, &core.HTTPError{Status: http.StatusRequestEntityTooLarge, Msg: fmt.Sprintf(
			"An attachment may be at most %d MB.", s.maxBytes>>20)}
	}
	return claudeAttachment{
		ID: id, Name: safe, Size: written, MediaType: attachmentMediaType(safe), Path: path,
	}, nil
}

// resolve returns 400 for malformed IDs and 404 for missing or swept attachments.
func (s *AttachmentStore) resolve(id string) (claudeAttachment, error) {
	if !attachmentIDRe.MatchString(id) {
		return claudeAttachment{}, fmt.Errorf("%w: %s", errBadAttachmentID, id)
	}
	path := filepath.Join(s.dir, id)
	info, err := os.Stat(path)
	if err != nil {
		return claudeAttachment{}, fmt.Errorf("%w: attachment %s", os.ErrNotExist, id)
	}
	if info.IsDir() {
		return claudeAttachment{}, fmt.Errorf("%w: attachment %s", os.ErrNotExist, id)
	}
	name := attachmentDisplayName(id)
	return claudeAttachment{
		ID: id, Name: name, Size: info.Size(), MediaType: attachmentMediaType(name), Path: path,
	}, nil
}

// sweep runs only at startup, before sockets open, so no turn can be reading an attachment.
func (s *AttachmentStore) sweep(maxAge time.Duration) int {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !attachmentIDRe.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if os.Remove(filepath.Join(s.dir, entry.Name())) == nil {
			removed++
		}
	}
	return removed
}

func (a claudeAttachment) dto() AgentAttachmentDto {
	return AgentAttachmentDto{ID: a.ID, Name: a.Name, Size: a.Size, MediaType: a.MediaType}
}

// HandleUploadAttachment serves POST /hybridflow-runner/attachments: one multipart `file` per request.
func (s *Service) HandleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	if s.attachments == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "This service stores no attachments."})
		return
	}
	// Bound the request, parser memory, and saved file separately; multipart overhead is not file data.
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+attachmentEnvelopeBytes)
	if err := r.ParseMultipartForm(attachmentParseMemoryBytes); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusRequestEntityTooLarge, Msg: "The upload could not be read: " + err.Error()})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "No file was uploaded."})
		return
	}
	defer file.Close()

	name := header.Filename
	if name == "" {
		name = r.FormValue("name")
	}
	saved, err := s.attachments.save(name, file)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	logClaudeWS.Info("attachment stored",
		"user", core.IdentityFromRequest(r).User, "attachment", saved.ID,
		"bytes", saved.Size, "media_type", saved.MediaType)
	core.WriteJSON(w, http.StatusCreated, saved.dto())
}

// HandleGetAttachment serves bytes at GET /hybridflow-runner/attachments/{id}.
func (s *Service) HandleGetAttachment(w http.ResponseWriter, r *http.Request) {
	if s.attachments == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "This service stores no attachments."})
		return
	}
	found, err := s.attachments.resolve(r.PathValue("id"))
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	f, err := os.Open(found.Path)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", found.MediaType)
	w.Header().Set("Content-Disposition", `inline; filename="`+found.Name+`"`)
	// IDs are never reused or rewritten, so cached bytes are immutable.
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	http.ServeContent(w, r, found.Name, info.ModTime(), f)
}
