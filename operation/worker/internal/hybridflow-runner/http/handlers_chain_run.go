package runnerhttp

import (
	"encoding/json"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/hybridflow-runner/playback"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"net/http"
)

// HandleGetChainRuns serves GET /hybridflow-runner/chain-runs — every run the service knows, live and
// lately ended. What a client reads once, at start-up; everything after it arrives on the socket.
func (s *Service) HandleGetChainRuns(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		httpkit.WriteJSON(w, http.StatusOK, runstate.ChainRunsStateDto{Runs: []*runstate.HarnessChainRunDto{}})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, runstate.ChainRunsStateDto{Runs: s.chainRunner.Snapshots()})
}

// HandlePlayChainRun serves POST /hybridflow-runner/chain-runs/play: this flow node of this board, and
// then whatever the chain says comes after it, under the name the user gave it.
//
// Flow nodes have one owner at a time. An arrival at an exclusive gateway can queue for the flow node.
func (s *Service) HandlePlayChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: playback.ErrNoChainRunner.Error()})
		return
	}
	var req runstate.PlayChainRunRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	run, err := s.chainRunner.PlayRequest(access.IdentityFromRequest(r), req)
	if err != nil {
		httpkit.WriteError(w, r, err) // not a board, no such flow node, or a flow node already being played → 400/404/409
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, runstate.ChainRunDto{Run: run})
}

// HandleStopChainRun serves POST /hybridflow-runner/chain-runs/stop. The turn under way is left to
// finish — it is the user's to interrupt, from the chat — and nothing after it is started. A run
// waiting to try a flow node again ends here and now, having nothing to let finish, and a suspended
// one ends where it stands. The run stays in the list either way, saying it is over: that is what a
// restart is offered on.
func (s *Service) HandleStopChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if err := s.chainRunner.Stop(req.RunID); err != nil {
		httpkit.WriteError(w, r, err) // no such run → 404
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleResumeChainRun continues a suspended task in its conversation.
// Clients can start a turn immediately or wait for a separate prompt.
func (s *Service) HandleResumeChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: playback.ErrNoChainRunner.Error()})
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	resume := s.chainRunner.Resume
	if req.StartTurn {
		resume = s.chainRunner.ResumeNow
	}
	run, err := resume(access.IdentityFromRequest(r), req.RunID)
	if err != nil {
		httpkit.WriteError(w, r, err) // nothing suspended → 409
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, runstate.ChainRunDto{Run: run})
}

// HandleRestartChainRun serves POST /hybridflow-runner/chain-runs/restart: an ended run is played again
// from the flow node it was started on, keeping its name and its place in the list.
func (s *Service) HandleRestartChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: playback.ErrNoChainRunner.Error()})
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	run, err := s.chainRunner.Restart(access.IdentityFromRequest(r), req.RunID)
	if err != nil {
		httpkit.WriteError(w, r, err) // gone, still playing, or nothing left to send → 400/404/409
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, runstate.ChainRunDto{Run: run})
}

// HandleForgetChainRun serves POST /hybridflow-runner/chain-runs/forget: an ended run leaves the list.
// Only an ended one — a run that is playing is stopped first, rather than having one button do two
// things.
func (s *Service) HandleForgetChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if err := s.chainRunner.Forget(req.RunID); err != nil {
		httpkit.WriteError(w, r, err) // still playing → 409
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// chainRunRequest reads the one field every endpoint but the first takes.
func chainRunRequest(r *http.Request) (runstate.ChainRunRequestDto, error) {
	var req runstate.ChainRunRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"}
	}
	if req.RunID == "" {
		return req, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "no chain run named"}
	}
	return req, nil
}
