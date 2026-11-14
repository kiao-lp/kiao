package runnerhttp

import (
	"kiao/worker/internal/core/http"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
)

// HandleOptions serves GET /hybridflow-runner/options.
// Offered harnesses without HarnessOptions remain listed with empty choices for client fallback.
// Unavailable or disabled harnesses are omitted; a host may offer no harnesses.
func (s *Service) HandleOptions(w http.ResponseWriter, _ *http.Request) {
	payload := harnessapi.HarnessOptionsDto{DefaultHarness: s.harnesses.DefaultName(), Harnesses: []harnessapi.HarnessOptionsEntry{}}
	for _, entry := range s.harnesses.Offered() {
		offered := harnessapi.HarnessOptionsEntry{Value: entry.Name, Label: entry.Label}
		if options, ok := entry.Harness.(harnessapi.HarnessOptions); ok {
			own := options.Options()
			offered.Profiles, offered.DefaultProfileID, offered.Capabilities = own.Profiles, own.DefaultProfileID, own.Capabilities
			offered.Models, offered.Efforts, offered.PermissionModes =
				own.Models, own.Efforts, own.PermissionModes
		}
		offered.Login = harnessapi.LoginOfferFor(entry.Harness)
		// Advertise defaults only when present in the offered lists; otherwise let the client fall back.
		if model, effort := s.harnesses.DefaultsFor(entry.Name); model != "" || effort != "" {
			if harnessapi.HasHarnessOption(offered.Models, model) {
				offered.DefaultModel = model
			}
			if harnessapi.HasHarnessOption(offered.Efforts, effort) {
				offered.DefaultEffort = effort
			}
		}
		if entry.Name == payload.DefaultHarness {
			payload.Models, payload.Efforts, payload.PermissionModes =
				offered.Models, offered.Efforts, offered.PermissionModes
			payload.DefaultModel, payload.DefaultEffort = offered.DefaultModel, offered.DefaultEffort
		}
		payload.Harnesses = append(payload.Harnesses, offered)
	}
	httpkit.WriteJSON(w, http.StatusOK, payload)
}
