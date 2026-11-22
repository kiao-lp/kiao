package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	pkgLogin "kiao/worker/internal/hybridflow-runner/harnesses/login"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	"net/http"
	"strings"
)

// HandleAuthStatus serves GET /hybridflow-runner/auth/status?harness=… (Claude by default).
// Disabling browser sign-in alone still allows status checks.
func (s *Service) HandleAuthStatus(w http.ResponseWriter, r *http.Request) {
	name := protocol.OrDefault(strings.TrimSpace(r.URL.Query().Get("harness")), harnessapi.HarnessClaude)
	auth := s.harnesses.AuthFor(name)
	if auth == nil {
		http.NotFound(w, r)
		return
	}
	status, err := auth.AuthStatus()
	if err != nil {
		logging.LogCtx(r).Warn("auth status unavailable", "component", "harness-login", "harness", name, "error", err)
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: "cannot read " + s.harnesses.Label(name) + " auth status"})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, status)
}

// HandleLoginStart serves POST /hybridflow-runner/auth/login/start.
func (s *Service) HandleLoginStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	url, err := s.login.LoginStart()
	if err != nil {
		logging.LogCtx(r).Warn("sign-in start failed", "component", "claude-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: false, Message: err.Error()})
		return
	}
	logging.LogCtx(r).Info("sign-in URL issued", "component", "claude-login", "user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, URL: url})
}

// HandleLoginCode serves POST /hybridflow-runner/auth/login/code.
//
// The code is a one-time credential: it is never logged, and it is checked for a newline before
// reaching the CLI, since stdin is line-oriented and extra lines would be extra answers to whatever
// the CLI asks next.
func (s *Service) HandleLoginCode(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" || len(code) > claudecli.MaxLoginCodeLength || strings.ContainsAny(code, "\r\n") {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid code"})
		return
	}

	ok, message, err := s.login.LoginCode(code)
	if err != nil {
		if errors.Is(err, pkgLogin.ErrNoLoginInFlight) {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusConflict, Msg: err.Error()})
			return
		}
		logging.LogCtx(r).Warn("sign-in exchange failed", "component", "claude-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: false, Message: err.Error()})
		return
	}
	harnessapi.LogLogin.Info("sign-in finished", "ok", ok, "user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: ok, Message: message})
}

// HandleLoginCancel serves POST /hybridflow-runner/auth/login/cancel.
func (s *Service) HandleLoginCancel(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	if s.login.LoginCancel() {
		logging.LogCtx(r).Info("sign-in cancelled", "component", "claude-login", "user", access.IdentityFromRequest(r).User)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, Message: "Sign-in cancelled."})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, Message: "No sign-in was in progress."})
}

// requireLoginEnabled answers 404 when signing in over HTTP is switched off, so a deployment that
// disables it is indistinguishable from one that never had the endpoints.
func (s *Service) requireLoginEnabled(w http.ResponseWriter, r *http.Request) bool {
	if s.login != nil && s.harnesses.IsEnabled(harnessapi.HarnessClaude) && s.login.LoginEnabled() {
		return true
	}
	logging.LogCtx(r).Warn("sign-in endpoint refused: disabled by configuration", "component", "claude-login")
	httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "Claude sign-in is not enabled on this service"})
	return false
}
