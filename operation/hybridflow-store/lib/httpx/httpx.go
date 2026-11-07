// Package httpx is the HTTP conventions the adapters share: how a payload is written, and how a
// domain error becomes a status code.
//
// **Handlers never choose a status code by hand.** They return the core's error and call
// WriteError, which classifies it in one place — the same rule worker keeps
// (`core/errors.go`), for the same reason: status-code policy in one auditable function, and a 5xx
// cause logged with the request id while its detail stays off the wire.
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/lib/logging"
)

// WriteJSON writes a payload, or logs the failure if the connection went away mid-write — by which
// point the status line has gone and there is nothing left to say to the client.
func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		logging.HTTP.Warn("could not write the response body", "error", err)
	}
}

// Error is a status and a message pinned onto an error, for the cases the sentinels do not cover.
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

// Errorf builds an Error.
func Errorf(status int, msg string) *Error { return &Error{Status: status, Msg: msg} }

// StatusFor classifies an error:
//
//   - an explicit *Error wins;
//   - entities.ErrNotFound → 404;
//   - entities.ErrInvalid → 400, with the whole wrapped message, so the context a caller added
//     reaches the person who reads it;
//   - entities.ErrConflict, entities.ErrNameTaken, entities.ErrAgentNameTaken and
//     entities.ErrRunnerNameTaken → 409, which is the one status a client acts on: read the thing
//     again and decide against what it now says;
//   - entities.ErrFlowNodeHeld → 409 as well: another run has the card;
//   - entities.ErrFlowNodeNotRunnable / ErrFlowNodeEmptyPrompt → 422 — the request was understood
//     and the
//     card is not in a state to be played, which is not the caller mistyping;
//   - anything else → 500, message hidden, cause logged.
func StatusFor(err error) (int, string) {
	var pinned *Error
	if errors.As(err, &pinned) {
		return pinned.Status, pinned.Msg
	}
	switch {
	case errors.Is(err, entities.ErrNotFound):
		return http.StatusNotFound, err.Error()
	case errors.Is(err, entities.ErrInvalid):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, entities.ErrConflict), errors.Is(err, entities.ErrNameTaken),
		errors.Is(err, entities.ErrAgentNameTaken), errors.Is(err, entities.ErrRunnerNameTaken),
		errors.Is(err, entities.ErrFlowNodeHeld):
		return http.StatusConflict, err.Error()
	case errors.Is(err, entities.ErrFlowNodeNotRunnable), errors.Is(err, entities.ErrFlowNodeEmptyPrompt):
		return http.StatusUnprocessableEntity, err.Error()
	default:
		return http.StatusInternalServerError, "internal error"
	}
}

// ErrorBody is what a refused request answers with. One field, because a client reacts to the
// status and shows the message — it never parses it.
type ErrorBody struct {
	Error string `json:"error"`
}

// WriteError classifies err, logs a 5xx with its cause and the request id, and answers.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := StatusFor(err)
	if status >= 500 {
		logging.Ctx(r.Context()).Error("request failed", "component", "http",
			"method", r.Method, "path", r.URL.Path, "error", err)
	}
	WriteJSON(w, status, ErrorBody{Error: msg})
}
