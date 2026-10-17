package hybridflowrunner

import (
	"encoding/json"
	"kiao/worker/internal/core"
	"net/http"
)

// The /hybridflow-runner/chain-runs endpoints: what is playing, and what can be asked of one run.
//
// They are thin, like every handler here — parse, call the runner, hand the error to
// core.WriteError — and the four that act on a run answer with that run, so the client that asked
// has the state before the `chainRun` frame reaches it. Every *other* client learns from that
// frame: the runs are service-wide state, and a board open in a second tab has to say what a board
// in the first one is doing.
//
// **Every one of them but the first names a run**, because there are several. That is the whole
// shape of the change: `stop` used to mean "the run", and now means "this one of the four".

// HandleGetChainRuns serves GET /hybridflow-runner/chain-runs — every run the service knows, live and
// lately ended. What a client reads once, at start-up; everything after it arrives on the socket.
func (s *Service) HandleGetChainRuns(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		core.WriteJSON(w, http.StatusOK, ChainRunsStateDto{Runs: []*AgentChainRunDto{}})
		return
	}
	core.WriteJSON(w, http.StatusOK, ChainRunsStateDto{Runs: s.chainRunner.snapshots()})
}

// HandlePlayChainRun serves POST /hybridflow-runner/chain-runs/play: this flow node of this board, and
// then whatever the chain says comes after it, under the name the user gave it.
//
// Runs already under way are left alone — several play at once. What is refused is a second run on
// the same card, which would be two turns on one flow node.
func (s *Service) HandlePlayChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusServiceUnavailable, Msg: errNoChainRunner.Error()})
		return
	}
	var req PlayChainRunRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	run, err := s.chainRunner.play(core.IdentityFromRequest(r), req.Handle, req.FlowNodeID, req.Name)
	if err != nil {
		core.WriteError(w, r, err) // not a board, no such flow node, or a card already being played → 400/404/409
		return
	}
	core.WriteJSON(w, http.StatusOK, ChainRunDto{Run: run})
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
		core.WriteError(w, r, err)
		return
	}
	if err := s.chainRunner.stop(req.RunID); err != nil {
		core.WriteError(w, r, err) // no such run → 404
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleResumeChainRun serves POST /hybridflow-runner/chain-runs/resume: a run stopped with its chat
// picks up where it left off. It attaches to the turn the user is starting rather than sending one
// of its own, so the message that resumes the conversation is the flow node's turn.
func (s *Service) HandleResumeChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusServiceUnavailable, Msg: errNoChainRunner.Error()})
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	run, err := s.chainRunner.resume(core.IdentityFromRequest(r), req.RunID)
	if err != nil {
		core.WriteError(w, r, err) // nothing suspended → 409
		return
	}
	core.WriteJSON(w, http.StatusOK, ChainRunDto{Run: run})
}

// HandleRestartChainRun serves POST /hybridflow-runner/chain-runs/restart: an ended run is played again
// from the card it was started on, keeping its name and its place in the list.
//
// A card whose description went into its conversation the first time round has nothing left to
// send, and this refuses in those words — the same thing the board says by drawing no Play on a
// card that has already run.
func (s *Service) HandleRestartChainRun(w http.ResponseWriter, r *http.Request) {
	if s.chainRunner == nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusServiceUnavailable, Msg: errNoChainRunner.Error()})
		return
	}
	req, err := chainRunRequest(r)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	run, err := s.chainRunner.restart(core.IdentityFromRequest(r), req.RunID)
	if err != nil {
		core.WriteError(w, r, err) // gone, still playing, or nothing left to send → 400/404/409
		return
	}
	core.WriteJSON(w, http.StatusOK, ChainRunDto{Run: run})
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
		core.WriteError(w, r, err)
		return
	}
	if err := s.chainRunner.forget(req.RunID); err != nil {
		core.WriteError(w, r, err) // still playing → 409
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// chainRunRequest reads the one field every endpoint but the first takes.
func chainRunRequest(r *http.Request) (ChainRunRequestDto, error) {
	var req ChainRunRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"}
	}
	if req.RunID == "" {
		return req, &core.HTTPError{Status: http.StatusBadRequest, Msg: "no chain run named"}
	}
	return req, nil
}
