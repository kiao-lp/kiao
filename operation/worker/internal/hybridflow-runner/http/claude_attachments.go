package runnerhttp

import (
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"net/http"
	"os"
)

// HandleUploadAttachment serves POST /hybridflow-runner/attachments: one multipart `file` per request.
func (s *Service) HandleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	if s.attachments == nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "This service stores no attachments."})
		return
	}
	// Bound the request, parser memory, and saved file separately; multipart overhead is not file data.
	r.Body = http.MaxBytesReader(w, r.Body, pkgConversations.MaxAttachmentBytes+pkgConversations.AttachmentEnvelopeBytes)
	if err := r.ParseMultipartForm(pkgConversations.AttachmentParseMemoryBytes); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusRequestEntityTooLarge, Msg: "The upload could not be read: " + err.Error()})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "No file was uploaded."})
		return
	}
	defer file.Close()

	name := header.Filename
	if name == "" {
		name = r.FormValue("name")
	}
	saved, err := s.attachments.Save(name, file)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	agentapi.LogClaudeWS.Info("attachment stored",
		"user", access.IdentityFromRequest(r).User, "attachment", saved.ID,
		"bytes", saved.Size, "media_type", saved.MediaType)
	httpkit.WriteJSON(w, http.StatusCreated, saved.Dto())
}

// HandleGetAttachment serves bytes at GET /hybridflow-runner/attachments/{id}.
func (s *Service) HandleGetAttachment(w http.ResponseWriter, r *http.Request) {
	if s.attachments == nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "This service stores no attachments."})
		return
	}
	found, err := s.attachments.Resolve(r.PathValue("id"))
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	f, err := os.Open(found.Path)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", found.MediaType)
	w.Header().Set("Content-Disposition", `inline; filename="`+found.Name+`"`)
	// IDs are never reused or rewritten, so cached bytes are immutable.
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	http.ServeContent(w, r, found.Name, info.ModTime(), f)
}
