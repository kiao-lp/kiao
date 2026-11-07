package runnerhttp

import (
	"kiao/worker/internal/core/http"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"net/http"
)

// HandleOptions serves GET /hybridflow-runner/options.
// Offered agents without AgentOptions remain listed with empty choices for client fallback.
// Unavailable or disabled agents are omitted; a host may offer no agents.
func (s *Service) HandleOptions(w http.ResponseWriter, _ *http.Request) {
	payload := agentapi.AgentOptionsDto{DefaultAgent: s.agents.DefaultName(), Agents: []agentapi.AgentOptionsEntry{}}
	for _, entry := range s.agents.Offered() {
		offered := agentapi.AgentOptionsEntry{Value: entry.Name, Label: entry.Label}
		if options, ok := entry.Agent.(agentapi.AgentOptions); ok {
			own := options.Options()
			offered.Profiles, offered.DefaultProfileID, offered.Capabilities = own.Profiles, own.DefaultProfileID, own.Capabilities
			offered.Models, offered.Efforts, offered.PermissionModes =
				own.Models, own.Efforts, own.PermissionModes
		}
		offered.Login = agentapi.LoginOfferFor(entry.Agent)
		// Advertise defaults only when present in the offered lists; otherwise let the client fall back.
		if model, effort := s.agents.DefaultsFor(entry.Name); model != "" || effort != "" {
			if agentapi.HasAgentOption(offered.Models, model) {
				offered.DefaultModel = model
			}
			if agentapi.HasAgentOption(offered.Efforts, effort) {
				offered.DefaultEffort = effort
			}
		}
		if entry.Name == payload.DefaultAgent {
			payload.Models, payload.Efforts, payload.PermissionModes =
				offered.Models, offered.Efforts, offered.PermissionModes
			payload.DefaultModel, payload.DefaultEffort = offered.DefaultModel, offered.DefaultEffort
		}
		payload.Agents = append(payload.Agents, offered)
	}
	httpkit.WriteJSON(w, http.StatusOK, payload)
}
