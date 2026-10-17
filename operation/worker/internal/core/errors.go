package core

import (
	"errors"
	"net/http"
	"os"
)

// Domain code returns sentinels wrapped with %w; WriteError owns HTTP classification.

// ClientError maps to 400 with the full wrapped message exposed to the client.
// Sentinels compare by identity through errors.Is.
type ClientError struct{ msg string }

func (e *ClientError) Error() string { return e.msg }

// Invalid declares a caller-error sentinel without registration.
func Invalid(msg string) *ClientError { return &ClientError{msg: msg} }

var (
	ErrNotDirectory = Invalid("path is not a directory")
	// State contains private service data, not browsable content.
	ErrStatePath = Invalid("path belongs to the service's state directory")
	// Empty and "/" paths resolve to the root; deleting it would remove the whole store.
	ErrDeleteRoot = Invalid("refusing to delete the storage root")
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
	var ce *ClientError
	switch {
	case errors.As(err, &ce):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound, err.Error()
	default:
		return http.StatusInternalServerError, "internal error"
	}
}

// WriteError logs 5xx causes with the request id. Client-visible 4xx messages should be
// short and actionable.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := StatusForError(err)
	if status >= http.StatusInternalServerError {
		LogCtx(r).Error("request failed", "component", "files", "error", err)
	}
	WriteText(w, status, msg)
}
