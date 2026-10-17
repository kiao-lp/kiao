package toolbox

import (
	"encoding/json"
	"io"
	"net/http"

	"kiao/worker/internal/core"
)

// The handlers: parse, call, write. Every one of them is thin on purpose — the decisions are in
// api.go, which knows nothing about HTTP, and the status codes are core.WriteError's, which no
// handler picks by hand.

// maxRequestBytes bounds a request body. These carry a list of catalogue ids and a boolean; a
// megabyte is orders of magnitude past any of them and still nothing to parse.
const maxRequestBytes = 1 << 20

// HandleGetToolbox serves GET /toolbox: the whole panel, including the job in flight. This is what
// the panel polls while an install runs, so it stays one request rather than one per row.
func (s *Service) HandleGetToolbox(w http.ResponseWriter, _ *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.State())
}

// HandleInstall serves POST /toolbox/install. It answers the job as soon as it has started, with
// 202: the work takes minutes and the panel polls it.
func (s *Service) HandleInstall(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest(w, r)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	job, err := s.Install(req.IDs)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusAccepted, job)
}

// HandleUninstall serves POST /toolbox/uninstall, the same way round.
func (s *Service) HandleUninstall(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest(w, r)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	job, err := s.Uninstall(req.IDs)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusAccepted, job)
}

// HandleSetRegistration serves POST /toolbox/registration: switch servers on or off for turns.
// Nothing is installed or removed, so it answers the new state of the panel directly rather than a
// job to poll.
func (s *Service) HandleSetRegistration(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest(w, r)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	if err := s.SetRegistered(req.IDs, req.Enabled); err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusOK, s.State())
}

// HandleGetJob serves GET /toolbox/jobs/{id}: one job's state and its log so far.
func (s *Service) HandleGetJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.Job(r.PathValue("id"))
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusOK, job)
}

// decodeRequest reads the one body shape this surface takes. A body that is not JSON is a caller
// mistake with a message worth showing, not a 500.
func decodeRequest(w http.ResponseWriter, r *http.Request) (ToolboxRequestDto, error) {
	var req ToolboxRequestDto
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		return req, core.Invalid("the request body could not be read")
	}
	if err := json.Unmarshal(data, &req); err != nil {
		return req, core.Invalid("the request body is not valid JSON")
	}
	return req, nil
}
