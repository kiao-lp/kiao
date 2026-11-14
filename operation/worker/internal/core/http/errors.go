package httpkit

import (
	"errors"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/logging"
	"net/http"
	"os"
)

// HTTPError overrides sentinel classification with an explicit status and client-facing message.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string { return e.Msg }

// StatusForError prioritizes HTTPError, then ClientError (400), then missing files (404).
// Unclassified errors return 500 with their detail hidden.
func StatusForError(err error) (int, string) {
	var he *HTTPError
	if errors.As(err, &he) {
		return he.Status, he.Msg
	}
	var ce *faults.ClientError
	switch {
	case errors.As(err, &ce):
		return http.StatusBadRequest, faults.ClientMessage(err)
	case errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound, faults.ClientMessage(err)
	default:
		return http.StatusInternalServerError, faults.ClientMessage(err)
	}
}

// WriteError logs 5xx causes with the request id. Client-visible 4xx messages should be
// short and actionable.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := StatusForError(err)
	if status >= http.StatusInternalServerError {
		logging.LogCtx(r).Error("request failed", "component", "files", "error", err)
	}
	WriteText(w, status, msg)
}
