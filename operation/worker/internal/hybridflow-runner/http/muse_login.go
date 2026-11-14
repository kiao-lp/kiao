package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgLogin "kiao/worker/internal/hybridflow-runner/harnesses/login"
	musecli "kiao/worker/internal/hybridflow-runner/harnesses/muse"
	"net/http"
	"strings"
)

// offersAPIKeyLogin reports whether any harness can be signed in with an API key, which is what
// decides whether POST /hybridflow-runner/auth/{harness}/key is mounted at all. Any and not all: the endpoint
// answers per harness, and one with no such sign-in answers 404 rather than keeping the route off
// the air for the other.
func (s *Service) offersAPIKeyLogin() bool {
	if s.harnesses == nil {
		return false
	}
	for _, entry := range s.harnesses.Entries {
		if _, ok := entry.Harness.(harnessapi.HarnessAPIKeyLogin); ok {
			return true
		}
	}
	return false
}

// offersDeviceLogin reports whether any harness signs in as a device flow, which is what decides
// whether the device endpoints are mounted at all — same shape as the key one above.
func (s *Service) offersDeviceLogin() bool {
	if s.harnesses == nil {
		return false
	}
	for _, entry := range s.harnesses.Entries {
		if _, ok := entry.Harness.(harnessapi.HarnessDeviceLogin); ok {
			return true
		}
	}
	return false
}

// HandleAPIKeyLogin serves POST /hybridflow-runner/auth/{harness}/key: stores the API key the body carries
// with that harness's host CLI — the sign-in the usage panel drives. It follows the convention the
// Claude flow follows: a key the CLI refused is a 200 with ok:false and a message worth showing,
// not an HTTP error.
//
// A deployment that keeps the endpoint off answers 404, indistinguishable from a harness with no
// such sign-in at all.
func (s *Service) HandleAPIKeyLogin(w http.ResponseWriter, r *http.Request) {
	harness := r.PathValue("harness")
	login := s.harnesses.ApiKeyLoginFor(harness)
	if login == nil || !login.APIKeyLoginEnabled() {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "API-key sign-in is not enabled for this harness"})
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
		logging.LogCtx(r).Warn("API-key sign-in failed", "component", "harness-login", "harness", harness, "error", err)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: false, Message: err.Error()})
		return
	}
	harnessapi.LogHarnessLogin.Info("API-key sign-in finished", "harness", harness, "ok", ok,
		"user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: ok, Message: message})
}

// deviceLoginForRequest resolves the harness's device port, or answers the 404 a deployment that
// keeps the endpoint off is indistinguishable by.
func (s *Service) deviceLoginForRequest(w http.ResponseWriter, r *http.Request) harnessapi.HarnessDeviceLogin {
	login := s.harnesses.DeviceLoginFor(r.PathValue("harness"))
	if login == nil || !login.DeviceLoginEnabled() {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "Device sign-in is not enabled for this harness"})
		return nil
	}
	return login
}

// HandleDeviceLoginStart serves POST /hybridflow-runner/auth/{harness}/login/start: spawns the CLI and returns
// the page to open and the code to confirm.
func (s *Service) HandleDeviceLoginStart(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	url, userCode, err := login.DeviceLoginStart()
	if err != nil {
		logging.LogCtx(r).Warn("device sign-in start failed", "component", "harness-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: false, Message: err.Error()})
		return
	}
	logging.LogCtx(r).Info("device sign-in page issued", "component", "harness-login",
		"user", access.IdentityFromRequest(r).User)
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, URL: url, UserCode: userCode})
}

// HandleDeviceLoginStatus serves GET /hybridflow-runner/auth/{harness}/login/status: pending while the CLI is
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
		logging.LogCtx(r).Warn("device sign-in status failed", "component", "harness-login", "error", err)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessDeviceLoginDto{Message: err.Error()})
		return
	}
	if !pending {
		harnessapi.LogHarnessLogin.Info("device sign-in finished", "ok", ok,
			"user", access.IdentityFromRequest(r).User)
	}
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessDeviceLoginDto{Pending: pending, Ok: ok, Message: message})
}

// HandleDeviceLoginCancel serves POST /hybridflow-runner/auth/{harness}/login/cancel.
func (s *Service) HandleDeviceLoginCancel(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	if login.DeviceLoginCancel() {
		logging.LogCtx(r).Info("device sign-in cancelled", "component", "harness-login",
			"user", access.IdentityFromRequest(r).User)
		httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, Message: "Sign-in cancelled."})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, harnessapi.HarnessLoginDto{Ok: true, Message: "No sign-in was in progress."})
}
