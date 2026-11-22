package runnerhttp

import (
	"encoding/json"
	"io"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/http"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
)

func (s *Service) HandleConfigurableHarnesses(w http.ResponseWriter, _ *http.Request) {
	harnesses := []harnessapi.HarnessOption{}
	for _, entry := range s.harnesses.ConfigurableModels() {
		harnesses = append(harnesses, harnessapi.HarnessOption{Value: entry.Name, Label: entry.Label})
	}
	w.Header().Set("Cache-Control", "no-store")
	httpkit.WriteJSON(w, http.StatusOK, harnesses)
}

func (s *Service) HandleHarnessModels(w http.ResponseWriter, r *http.Request) {
	for _, entry := range s.harnesses.ConfigurableModels() {
		if entry.Name != r.PathValue("harness") {
			continue
		}
		options := entry.Harness.(harnessapi.HarnessOptions).Options()
		if r.Method == http.MethodPut {
			s.saveHarnessModels(w, r, entry, options.Models)
			return
		}
		config, err := s.harnesses.ModelConfiguration(entry, options)
		if err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpkit.WriteJSON(w, http.StatusOK, config)
		return
	}
	http.NotFound(w, r)
}

func (s *Service) saveHarnessModels(w http.ResponseWriter, r *http.Request, entry harnessapi.HarnessEntry, models []harnessapi.HarnessOption) {
	var prefs harnessapi.ModelPreferences
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil || json.Unmarshal(body, &prefs) != nil {
		httpkit.WriteError(w, r, faults.Invalid("invalid harness model preferences"))
		return
	}
	if err := s.harnesses.SaveModelPreferences(entry, models, prefs); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
