package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/http"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	picli "kiao/worker/internal/hybridflow-runner/agents/pi"
	"net/http"
	"os"
	"strings"
)

func (s *Service) HandlePiProfiles(w http.ResponseWriter, r *http.Request) {
	profiles := s.agents.Profiles
	if r.Method == http.MethodPut {
		var doc agentapi.PiProfilesDocument
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&doc); err != nil {
			httpkit.WriteError(w, r, faults.Invalid("invalid execution profile document"))
			return
		}
		if err := profiles.WriteProfiles(doc); err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
	}
	doc, err := profiles.ReadProfiles()
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]any{"version": doc.Version, "defaultPiProfileId": doc.DefaultPiProfileID, "installations": doc.Installations, "availableInstallations": profiles.Installations(doc), "profiles": profiles.OfferedProfiles()})
}

func (s *Service) HandlePiSecrets(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	secrets, err := s.agents.Profiles.Secrets()
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]any{"secrets": secrets})
}

func (s *Service) HandlePiSecret(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	if !picli.PiIdentifier.MatchString(id) {
		httpkit.WriteError(w, r, faults.Invalid("invalid private secret reference"))
		return
	}
	profiles := s.agents.Profiles
	if r.Method == http.MethodGet {
		value, configured := profiles.Secret("private:" + id)
		if !configured {
			httpkit.WriteError(w, r, os.ErrNotExist)
			return
		}
		httpkit.WriteJSON(w, http.StatusOK, map[string]any{"reference": "private:" + id, "value": value})
		return
	}
	if r.Method == http.MethodDelete {
		if err := profiles.DeleteSecret(id); err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var req struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&req); err != nil || strings.TrimSpace(req.Value) == "" {
		httpkit.WriteError(w, r, faults.Invalid("provide a nonempty API key"))
		return
	}
	if err := profiles.PutSecret(id, req.Value); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]any{"reference": "private:" + id, "configured": true})
}

func (s *Service) HandlePiDiagnostic(w http.ResponseWriter, r *http.Request) {
	profileID := r.PathValue("id")
	profile, _, err := s.agents.Profiles.Profile(profileID)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	count := 0
	for _, connection := range profile.Connections {
		count += len(connection.Models)
	}
	if count == 0 {
		httpkit.WriteError(w, r, faults.Invalid("No models are configured. Add a model ID to a connection, then check again. This check only verifies the models you add; it does not discover models from the provider."))
		return
	}
	models, err := s.agents.Profiles.Models(profileID, true)
	if err != nil {
		httpkit.WriteError(w, r, faults.Invalid(err.Error()))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]any{"profileId": profileID, "models": models, "status": "ready"})
}

func (s *Service) HandlePiConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model string `json:"model"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil {
		httpkit.WriteError(w, r, faults.Invalid("select a profile model"))
		return
	}
	if err := s.agents.Profiles.CheckConnection(r.PathValue("id"), req.Model); err != nil {
		var diagnostic *picli.PiConnectionDiagnostic
		if errors.As(err, &diagnostic) {
			httpkit.WriteJSON(w, http.StatusBadRequest, diagnostic)
			return
		}
		httpkit.WriteError(w, r, faults.Invalid(err.Error()))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}
