package runnerhttp

import (
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"net/http"
)

// usageFor selects the agent's quota port; empty selects the default agent.
// Disabled, unknown or unsupported agents return nil. An enabled agent whose CLI
// is missing can still report cached usage; a live probe reports unavailability.
func (s *Service) usageFor(name string) agentapi.AgentUsage { return s.agents.UsageFor(name) }

// Mount the route if any registered agent supports usage; others return 404.
func (s *Service) offersUsage() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.Entries {
		if _, ok := entry.Agent.(agentapi.AgentUsage); ok {
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
		dto agentapi.AgentUsageDto
		err error
	)
	if refresh, ok := usage.(agentapi.AgentUsageRefresh); ok {
		dto, err = refresh.RefreshUsage()
	} else {
		dto, err = usage.Usage()
	}
	if err != nil {
		logging.LogCtx(r).Warn("usage unavailable", "component", "agent-usage", "agent", agent, "error", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, dto)
}
