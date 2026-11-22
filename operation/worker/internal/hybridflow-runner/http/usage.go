package runnerhttp

import (
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
)

// usageFor selects the harness's quota port; empty selects the default harness.
// Disabled, unknown or unsupported harnesses return nil. An enabled harness whose CLI
// is missing can still report cached usage; a live probe reports unavailability.
func (s *Service) usageFor(name string) harnessapi.HarnessUsage { return s.harnesses.UsageFor(name) }

// Mount the route if any registered harness supports usage; others return 404.
func (s *Service) offersUsage() bool {
	if s.harnesses == nil {
		return false
	}
	for _, entry := range s.harnesses.Entries {
		if _, ok := entry.Harness.(harnessapi.HarnessUsage); ok {
			return true
		}
	}
	return false
}

// HandleUsage serves GET /hybridflow-runner/usage[?harness=…].
// 404 means no quota support; 503 means the probe failed (auth, network or timeout).
// Prefer HarnessUsageRefresh for this explicit user request, even if it costs a minimal
// Muse turn; internal runner reads use the cheaper Usage port.
func (s *Service) HandleUsage(w http.ResponseWriter, r *http.Request) {
	harness := r.URL.Query().Get("harness")
	usage := s.usageFor(harness)
	if usage == nil {
		http.NotFound(w, r)
		return
	}
	var (
		dto harnessapi.HarnessUsageDto
		err error
	)
	if refresh, ok := usage.(harnessapi.HarnessUsageRefresh); ok {
		dto, err = refresh.RefreshUsage()
	} else {
		dto, err = usage.Usage()
	}
	if err != nil {
		logging.LogCtx(r).Warn("usage unavailable", "component", "harness-usage", "harness", harness, "error", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, dto)
}
