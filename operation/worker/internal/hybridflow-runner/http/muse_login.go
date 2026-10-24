package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgLogin "kiao/worker/internal/hybridflow-runner/agents/login"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	"net/http"
	"strings"
)

// offersAPIKeyLogin reports whether any agent can be signed in with an API key, which is what
// decides whether POST /hybridflow-runner/auth/{agent}/key is mounted at all. Any and not all: the endpoint
// answers per agent, and one with no such sign-in answers 404 rather than keeping the route off
// the air for the other.
func (s *Service) offersAPIKeyLogin() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.Entries {
		if _, ok := entry.Agent.(agentapi.AgentAPIKeyLogin); ok {
			return true
		}
	}
	return false
}

// offersDeviceLogin reports whether any agent signs in as a device flow, which is what decides
// whether the device endpoints are mounted at all — same shape as the key one above.
func (s *Service) offersDeviceLogin() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.Entries {
		if _, ok := entry.Agent.(agentapi.AgentDeviceLogin); ok {
			return true
		}
	}
	return false
}

// HandleAPIKeyLogin serves POST /hybridflow-runner/auth/{agent}/key: stores the API key the body carries
// with that agent's host CLI — the sign-in the usage panel drives. It follows the convention the
// Claude flow follows: a key the CLI refused is a 200 with ok:false and a message worth showing,
// not an HTTP error.
//
// A deployment that keeps the endpoint off answers 404, indistinguishable from an agent with no
// such sign-in at all.
func (s *Service) HandleAPIKeyLogin(w http.ResponseWriter, r *http.Request) {
	agent := r.PathValue("agent")
	login := s.agents.ApiKeyLoginFor(agent)
	if login == nil || !login.APIKeyLoginEnabled() {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "API-key sign-in is not enabled for this agent"})
		return
	}
	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	// Trimmed like the Claude code: a paste carries a trailing newline, and the key itself must
	// not — stdin is the whole key, and extra lines would be extra input to whatever reads next.
	key := strings.TrimSpace(req.Key)
	if key == "" || len(key) > musecli.MaxAPIKeyLength || strings.ContainsAny(key, "\r\n") {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid key"})
		return
	}

	ok, message, err := login.SubmitAPIKey(key)
	if err != nil {
		logging.LogCtx(r).Warn("API-key sign-in failed", "component", "agent-login", "agent", agent, "error", err)
		httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	agentapi.LogAgentLogin.Info("API-key sign-in finished", "agent", agent, "ok", ok,
		"user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: ok, Message: message})
}

// deviceLoginForRequest resolves the agent's device port, or answers the 404 a deployment that
// keeps the endpoint off is indistinguishable by.
func (s *Service) deviceLoginForRequest(w http.ResponseWriter, r *http.Request) agentapi.AgentDeviceLogin {
	login := s.agents.DeviceLoginFor(r.PathValue("agent"))
	if login == nil || !login.DeviceLoginEnabled() {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "Device sign-in is not enabled for this agent"})
		return nil
	}
	return login
}

// HandleDeviceLoginStart serves POST /hybridflow-runner/auth/{agent}/login/start: spawns the CLI and returns
// the page to open and the code to confirm.
func (s *Service) HandleDeviceLoginStart(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	url, userCode, err := login.DeviceLoginStart()
	if err != nil {
		logging.LogCtx(r).Warn("device sign-in start failed", "component", "agent-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	logging.LogCtx(r).Info("device sign-in page issued", "component", "agent-login",
		"user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: true, URL: url, UserCode: userCode})
}

// HandleDeviceLoginStatus serves GET /hybridflow-runner/auth/{agent}/login/status: pending while the CLI is
// still parked on the approval, and once it has exited whether the approval landed. Reading a
// finished wait consumes it; a status with nothing in flight is 409.
func (s *Service) HandleDeviceLoginStatus(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	pending, ok, message, err := login.DeviceLoginStatus()
	if err != nil {
		if errors.Is(err, pkgLogin.ErrNoLoginInFlight) {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusConflict, Msg: err.Error()})
			return
		}
		logging.LogCtx(r).Warn("device sign-in status failed", "component", "agent-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentDeviceLoginDto{Message: err.Error()})
		return
	}
	if !pending {
		agentapi.LogAgentLogin.Info("device sign-in finished", "ok", ok,
			"user", access.IdentityFromRequest(r).User)
	}
	httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentDeviceLoginDto{Pending: pending, Ok: ok, Message: message})
}

// HandleDeviceLoginCancel serves POST /hybridflow-runner/auth/{agent}/login/cancel.
func (s *Service) HandleDeviceLoginCancel(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	if login.DeviceLoginCancel() {
		logging.LogCtx(r).Info("device sign-in cancelled", "component", "agent-login",
			"user", access.IdentityFromRequest(r).User)
		httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: true, Message: "Sign-in cancelled."})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, agentapi.AgentLoginDto{Ok: true, Message: "No sign-in was in progress."})
}
