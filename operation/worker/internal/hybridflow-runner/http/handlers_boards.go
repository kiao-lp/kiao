package runnerhttp

import (
	"bytes"
	"io"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"net/http"
	pkgUrl "net/url"
	"strings"
	"time"
)

// maxBoardProxyRequest bounds a proxied request body. A paste of flow nodes is the largest thing on
// the wire and is measured in kilobytes; four megabytes are room for a very long one and a
// refusal for anything that is not a board — the same bound the store itself applies.
const maxBoardProxyRequest = 4 << 20

// HandleListBoards serves GET /hybridflow-runner/boards: every board — names and handles, nothing
// on them. ?archived=1 includes the archived ones.
func (s *Service) HandleListBoards(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/boards")
}

// HandleCreateBoard serves POST /hybridflow-runner/boards: a board named {"name"}, answered whole.
func (s *Service) HandleCreateBoard(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, "/boards")
}

// HandleGetBoard serves GET /hybridflow-runner/boards/{handle}: the board whole — its flow nodes, and a cursor.
func (s *Service) HandleGetBoard(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, s.boardsUpstream.BoardPath(r.PathValue("handle")))
}

// HandlePatchBoard serves PATCH /hybridflow-runner/boards/{handle}: rename, archive.
func (s *Service) HandlePatchBoard(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch, s.boardsUpstream.BoardPath(r.PathValue("handle")))
}

// HandleDeleteBoard serves DELETE /hybridflow-runner/boards/{handle}: the board and everything on it.
func (s *Service) HandleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle")))
}

// HandleBoardFolders forwards requests for the board folder collection and its entries.
func (s *Service) HandleBoardFolders(w http.ResponseWriter, r *http.Request) {
	path := "/folders/boards"
	if id := r.PathValue("id"); id != "" {
		path += "/" + pkgUrl.PathEscape(id)
	}
	s.proxyBoards(w, r, r.Method, path)
}

// HandleGetFlowNodeBoard finds the board for a link that specifies only the task ID.
func (s *Service) HandleGetFlowNodeBoard(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/flow-nodes/"+pkgUrl.PathEscape(r.PathValue("id"))+"/board")
}

// HandleCreateFlowNodes serves POST /hybridflow-runner/boards/{handle}/flow-nodes: one or more flow nodes, made
// in the order given.
func (s *Service) HandleCreateFlowNodes(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-nodes")
}

// HandleGetFlowNode serves GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}: one flow node.
func (s *Service) HandleGetFlowNode(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id")))
}

// HandlePatchFlowNode serves PATCH /hybridflow-runner/boards/{handle}/flow-nodes/{id}: the fields the body
// names, and nothing else.
func (s *Service) HandlePatchFlowNode(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleDeleteFlowNodes serves DELETE /hybridflow-runner/boards/{handle}/flow-nodes: remove flow nodes.
func (s *Service) HandleDeleteFlowNodes(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-nodes")
}

// HandleChainFlowNode serves POST /hybridflow-runner/boards/{handle}/flow-nodes/{id}/chain: link to the
// flow node played next, or unlink.
func (s *Service) HandleChainFlowNode(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/chain")
}

// HandleGetFlowNodeUsage serves GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}/usage: what one
// flow node spent, whole.
func (s *Service) HandleGetFlowNodeUsage(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/usage")
}

// HandleCreateWorkflow serves POST /hybridflow-runner/boards/{handle}/workflows: file a workflow with the
// flow nodes it groups.
func (s *Service) HandleCreateWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflows")
}

// HandleGetWorkflow serves GET /hybridflow-runner/boards/{handle}/workflows/{id}: one workflow.
func (s *Service) HandleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.WorkflowPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleCopyWorkflow returns the portable JSON for a workflow and its members.
func (s *Service) HandleCopyWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.WorkflowPath(r.PathValue("handle"), r.PathValue("id"))+"/clipboard")
}

// HandlePasteWorkflow creates a workflow and its members from clipboard JSON.
func (s *Service) HandlePasteWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflows/clipboard")
}

// HandlePatchWorkflow serves PATCH /hybridflow-runner/boards/{handle}/workflows/{id}.
func (s *Service) HandlePatchWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.WorkflowPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleDeleteWorkflows serves DELETE /hybridflow-runner/boards/{handle}/workflows: remove workflows,
// ungrouping their flow nodes.
func (s *Service) HandleDeleteWorkflows(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflows")
}

// HandleListAgents serves GET /hybridflow-runner/agents: every managed agent, by name.
func (s *Service) HandleListAgents(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/agents")
}

// HandleCreateAgent serves POST /hybridflow-runner/agents: file one.
func (s *Service) HandleCreateAgent(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, "/agents")
}

// HandleGetAgent serves GET /hybridflow-runner/agents/{id}: one managed agent.
func (s *Service) HandleGetAgent(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/agents/"+pkgUrl.PathEscape(r.PathValue("id")))
}

// HandlePatchAgent serves PATCH /hybridflow-runner/agents/{id}: the fields the body names.
func (s *Service) HandlePatchAgent(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch, "/agents/"+pkgUrl.PathEscape(r.PathValue("id")))
}

// HandleDeleteAgent serves DELETE /hybridflow-runner/agents/{id}.
func (s *Service) HandleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, "/agents/"+pkgUrl.PathEscape(r.PathValue("id")))
}

func (s *Service) HandlePublishAgent(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, "/agents/"+pkgUrl.PathEscape(r.PathValue("id"))+"/publish")
}

func (s *Service) HandleAgentVersions(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/agents/"+pkgUrl.PathEscape(r.PathValue("id"))+"/versions")
}

// HandleListRunners serves GET /hybridflow-runner/runners: every runner.
func (s *Service) HandleListRunners(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/runners")
}

// HandleCreateRunner serves POST /hybridflow-runner/runners: file one.
func (s *Service) HandleCreateRunner(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, "/runners")
}

// HandleGetRunner serves GET /hybridflow-runner/runners/{id}: one runner.
func (s *Service) HandleGetRunner(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/runners/"+pkgUrl.PathEscape(r.PathValue("id")))
}

// HandlePatchRunner serves PATCH /hybridflow-runner/runners/{id}: the fields the body names.
func (s *Service) HandlePatchRunner(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch, "/runners/"+pkgUrl.PathEscape(r.PathValue("id")))
}

// HandleDeleteRunner serves DELETE /hybridflow-runner/runners/{id}.
func (s *Service) HandleDeleteRunner(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, "/runners/"+pkgUrl.PathEscape(r.PathValue("id")))
}

// HandleGetChanges serves GET /hybridflow-runner/changes: what happened after a cursor.
func (s *Service) HandleGetChanges(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/changes")
}

// HandleGetHybridflowSchema serves GET /hybridflow-runner/schema: the migration ledger.
func (s *Service) HandleGetHybridflowSchema(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/schema")
}

// proxyBoards forwards one boards call to the hybridflow-store and hands its answer back
// verbatim — status, body and all. The store's refusals are the caller's to read: a 409 is a
// revision that has moved on, a 404 a board or flow node that is gone, and neither is improved by a
// paraphrase here.
//
// The outbound request is built fresh rather than cloned from the inbound one, so nothing the
// caller sent travels by accident: neither its Authorization — a turn token means nothing to the
// store — nor an X-Kiao-Actor of its own. What travels is the service token, the actor this
// service derived, the body, and If-Match where the caller sent one.
func (s *Service) proxyBoards(w http.ResponseWriter, r *http.Request, method, upstreamPath string) {
	upstream := s.boardsUpstream
	resourceCall := upstreamPath == "/agents" || strings.HasPrefix(upstreamPath, "/agents/") || strings.HasPrefix(upstreamPath, "/agentic-resources")
	if resourceCall && s.cfg != nil && s.cfg.AgenticURL != "" {
		upstream = pkgBoards.NewHybridflowStore(s.cfg.AgenticURL, s.cfg.AgenticToken)
	}
	if upstream == nil {
		httpkit.WriteError(w, r, pkgBoards.ErrNoHybridflowStore("are no boards to reach through it"))
		return
	}

	var body []byte
	if r.Body != nil {
		read, err := io.ReadAll(io.LimitReader(r.Body, maxBoardProxyRequest+1))
		if err != nil {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest,
				Msg: "the request body could not be read"})
			return
		}
		if len(read) > maxBoardProxyRequest {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusRequestEntityTooLarge,
				Msg: "the request body is larger than the boards proxy forwards"})
			return
		}
		body = read
	}

	target := upstream.Base + upstreamPath
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), method, target, bytes.NewReader(body))
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if upstream.Token != "" {
		req.Header.Set("Authorization", "Bearer "+upstream.Token)
	}
	// The turn's owner, as the middleware resolved it — and nothing the caller sent. An empty
	// user travels as no header at all, which the store records as worker: a service
	// saying it named nobody.
	if actor := access.IdentityFromRequest(r).User; actor != "" {
		req.Header.Set("X-Kiao-Actor", actor)
	}
	if match := r.Header.Get("If-Match"); match != "" {
		req.Header.Set("If-Match", match)
	}

	client := upstream.Client
	// The store can hold a changes request for 25 seconds by default.
	if upstreamPath == "/changes" || strings.HasPrefix(upstreamPath, "/agentic-resources/") || strings.HasSuffix(upstreamPath, "/publish") {
		copy := *client
		copy.Timeout = 3 * time.Minute
		client = &copy
	}
	resp, err := client.Do(req)
	if err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{
			Status: http.StatusServiceUnavailable,
			Msg:    "the hybridflow store could not be reached: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(resp.Body, pkgBoards.MaxBoardBytes))
	if err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{
			Status: http.StatusBadGateway,
			Msg:    "the hybridflow store answer could not be read",
		})
		return
	}
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(answer)
}

func (s *Service) HandleListSchemaValues(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/schema-values")
}

func (s *Service) HandleAgenticResources(w http.ResponseWriter, r *http.Request) {
	upstream := "/agentic-resources"
	if name := r.PathValue("name"); name != "" {
		upstream += "/" + pkgUrl.PathEscape(name)
	}
	if operation := r.PathValue("operation"); operation != "" {
		upstream += "/" + pkgUrl.PathEscape(operation)
	}
	s.proxyBoards(w, r, r.Method, upstream)
}

func (s *Service) HandleTaskExecutions(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, r.Method, s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/executions")
}

func (s *Service) HandleAgentDeletion(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/agents/"+pkgUrl.PathEscape(r.PathValue("id"))+"/deletion")
}
