package runnerhttp

import (
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/equipment"
	httpkit "kiao/worker/internal/core/http"
	"kiao/worker/internal/hybridflow-runner/boards"
	"net/http"
)

func (s *Service) HandleAgentMCPDiagnostics(w http.ResponseWriter, r *http.Request) {
	catalogue, ok := s.agents.(*boards.HybridflowStore)
	if !ok {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: "no agent resource manager is configured"})
		return
	}
	folder, err := s.cfg.ResolveFolder("")
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	agentID, commit := r.PathValue("id"), r.URL.Query().Get("commit")
	workerURL := "http://127.0.0.1:" + s.cfg.Port
	ctx := r.Context()
	var prepared *boards.PreparedAgentPackage
	if commit == "" {
		var draft *boards.DraftAgentPackage
		draft, err = catalogue.DraftAgentPackage(ctx, agentID)
		if err == nil {
			var cleanup func()
			prepared, cleanup, err = boards.StageDraftAgentPackage(s.cfg.StatePath, s.cfg.NodeBinary, workerURL, draft)
			if err == nil {
				defer cleanup()
			}
		}
	} else {
		var versions []boards.ManagedAgentVersion
		versions, err = catalogue.AgentVersions(ctx, agentID)
		if err == nil {
			err = &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "agent publication not found"}
			for _, version := range versions {
				if version.Commit == commit {
					prepared, err = catalogue.PrepareAgentPackageContext(ctx, s.cfg.StatePath, s.cfg.NodeBinary, workerURL, &version)
					break
				}
			}
		}
	}
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	results := s.hub.DiagnoseMCP(ctx, access.IdentityFromRequest(r), folder.Abs, "mcp-diagnostic/"+agentID, prepared.Servers, prepared.MCPDiagnostics)
	if err := prepared.EnsureIntact(); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if results == nil {
		results = []equipment.MCPDiagnostic{}
	}
	httpkit.WriteJSON(w, http.StatusOK, results)
}
