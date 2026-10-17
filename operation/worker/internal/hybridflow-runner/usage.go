package hybridflowrunner

import (
	"net/http"

	"kiao/worker/internal/core"
)

// usageFor selects the agent's quota port; empty selects the default agent.
// Disabled, unknown or unsupported agents return nil. An enabled agent whose CLI
// is missing can still report cached usage; a live probe reports unavailability.
func (s *Service) usageFor(name string) AgentUsage { return s.agents.usageFor(name) }

// Mount the route if any registered agent supports usage; others return 404.
func (s *Service) offersUsage() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.entries {
		if _, ok := entry.agent.(AgentUsage); ok {
			return true
		}
	}
	return false
}

// HandleUsage serves GET /hybridflow-runner/usage[?agent=…].
// 404 means no quota support; 503 means the probe failed (auth, network or timeout).
// Prefer AgentUsageRefresh for this explicit user request, even if it costs a minimal
// Muse turn; internal runner reads use the cheaper Usage port.
func (s *Service) HandleUsage(w http.ResponseWriter, r *http.Request) {
	agent := r.URL.Query().Get("agent")
	usage := s.usageFor(agent)
	if usage == nil {
		http.NotFound(w, r)
		return
	}
	var (
		dto AgentUsageDto
		err error
	)
	if refresh, ok := usage.(AgentUsageRefresh); ok {
		dto, err = refresh.RefreshUsage()
	} else {
		dto, err = usage.Usage()
	}
	if err != nil {
		core.LogCtx(r).Warn("usage unavailable", "component", "agent-usage", "agent", agent, "error", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	core.WriteJSON(w, http.StatusOK, dto)
}
