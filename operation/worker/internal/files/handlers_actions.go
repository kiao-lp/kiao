package files

import (
	"encoding/json"
	"kiao/worker/internal/core"
	"net/http"
)

// HandleListActions serves the registered actions. Without a `path` it answers the whole catalog,
// which is what a client caches once to build its menus; with one it answers only the actions that
// apply to that entry, which keeps the endpoint self-describing for clients that would rather ask
// than evaluate the rule themselves.
func (s *Service) HandleListActions(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		core.WriteJSON(w, http.StatusOK, s.actions.descriptors())
		return
	}

	file, err := s.files.getFileInfo(p)
	if err != nil {
		core.WriteError(w, r, err) // invalid path → 400, else 500
		return
	}
	if file == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "no such file or directory"})
		return
	}
	core.WriteJSON(w, http.StatusOK, s.actions.applicableTo(file))
}

// HandleRunAction forwards a run request to the action's provider.
//
// The path is resolved against the storage root before anything leaves this process: an action is
// an operation on a file of *this* store, and forwarding an unchecked path would make the service
// a confused deputy for whatever the provider does with it.
func (s *Service) HandleRunAction(w http.ResponseWriter, r *http.Request) {
	var req RunActionRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}

	action := s.actions.find(req.ID)
	if action == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "unknown action: " + req.ID})
		return
	}
	if _, err := core.ResolvePath(s.cfg.RootPath, req.Path); err != nil {
		core.WriteError(w, r, err) // core.ErrOutsideRoot → 400
		return
	}

	result, err := s.actions.run(r.Context(), action, req.Path,
		req.Params, r.Header.Get("Authorization"), core.RequestID(r.Context()))
	if err != nil {
		core.WriteError(w, r, err) // provider unreachable → 502, encoding/decoding failure → 500
		return
	}

	core.LogCtx(r).Info("action run",
		"component", "actions", "action", req.ID, "path", req.Path, "ok", result.OK)
	core.WriteJSON(w, http.StatusOK, result)
}
