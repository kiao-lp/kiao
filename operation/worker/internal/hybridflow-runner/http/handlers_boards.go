package runnerhttp

import (
	"bytes"
	"io"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"net/http"
	pkgUrl "net/url"
)

// maxBoardProxyRequest bounds a proxied request body. A paste of cards is the largest thing on
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

// HandleGetBoard serves GET /hybridflow-runner/boards/{handle}: the board whole — its cards, and a cursor.
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

// HandleCreateFlowNodes serves POST /hybridflow-runner/boards/{handle}/flow-nodes: one or more cards, made
// in the order given.
func (s *Service) HandleCreateFlowNodes(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-nodes")
}

// HandleGetFlowNode serves GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}: one card.
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

// HandleDeleteFlowNodes serves DELETE /hybridflow-runner/boards/{handle}/flow-nodes: remove cards.
func (s *Service) HandleDeleteFlowNodes(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-nodes")
}

// HandleChainFlowNode serves POST /hybridflow-runner/boards/{handle}/flow-nodes/{id}/chain: link to the
// card played next, or unlink.
func (s *Service) HandleChainFlowNode(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/chain")
}

// HandleGetFlowNodeUsage serves GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}/usage: what one
// card spent, whole.
func (s *Service) HandleGetFlowNodeUsage(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/usage")
}

// HandleConvertFlowNode serves POST /hybridflow-runner/boards/{handle}/flow-nodes/{id}/to-class: file a
// class from a task.
func (s *Service) HandleConvertFlowNode(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.FlowNodePath(r.PathValue("handle"), r.PathValue("id"))+"/to-class")
}

// HandleListFlowNodeClasses serves GET /hybridflow-runner/flow-node-classes: every class of every board.
func (s *Service) HandleListFlowNodeClasses(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/flow-node-classes")
}

// HandleCreateFlowNodeClass serves POST /hybridflow-runner/boards/{handle}/flow-node-classes: one class,
// with its first version's words beside it.
func (s *Service) HandleCreateFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-node-classes")
}

// HandleGetFlowNodeClass serves GET /hybridflow-runner/boards/{handle}/flow-node-classes/{id}: one class,
// with its succession beneath it.
func (s *Service) HandleGetFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.ClassPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandlePatchFlowNodeClass serves PATCH /hybridflow-runner/boards/{handle}/flow-node-classes/{id}: the
// class's own fields, never its versions'.
func (s *Service) HandlePatchFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.ClassPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleDeleteFlowNodeClasses serves DELETE /hybridflow-runner/boards/{handle}/flow-node-classes: remove
// classes and their versions.
func (s *Service) HandleDeleteFlowNodeClasses(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/flow-node-classes")
}

// HandleChainFlowNodeClass serves POST /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/chain:
// link to the class after this one, or unlink.
func (s *Service) HandleChainFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.ClassPath(r.PathValue("handle"), r.PathValue("id"))+"/chain")
}

// HandleCreateClassVersion serves POST /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions:
// one version filed under its class.
func (s *Service) HandleCreateClassVersion(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.ClassPath(r.PathValue("handle"), r.PathValue("id"))+"/versions")
}

// HandlePatchClassVersion serves PATCH
// /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions/{versionId}: what a draft says, or
// publish it.
func (s *Service) HandlePatchClassVersion(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.ClassVersionPath(r.PathValue("handle"), r.PathValue("id"), r.PathValue("versionId")))
}

// HandleDeleteClassVersion serves DELETE
// /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions/{versionId}.
func (s *Service) HandleDeleteClassVersion(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete,
		s.boardsUpstream.ClassVersionPath(r.PathValue("handle"), r.PathValue("id"), r.PathValue("versionId")))
}

// HandleInstantiateFlowNodeClass serves POST
// /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/instantiate: make flow nodes from a class
// and all its successors, on the board the handle names.
func (s *Service) HandleInstantiateFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.ClassPath(r.PathValue("handle"), r.PathValue("id"))+"/instantiate")
}

// HandleCreateWorkflow serves POST /hybridflow-runner/boards/{handle}/workflows: file a workflow with the
// cards it groups.
func (s *Service) HandleCreateWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflows")
}

// HandleGetWorkflow serves GET /hybridflow-runner/boards/{handle}/workflows/{id}: one workflow.
func (s *Service) HandleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.WorkflowPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandlePatchWorkflow serves PATCH /hybridflow-runner/boards/{handle}/workflows/{id}: rename it.
func (s *Service) HandlePatchWorkflow(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.WorkflowPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleDeleteWorkflows serves DELETE /hybridflow-runner/boards/{handle}/workflows: remove workflows,
// ungrouping their cards.
func (s *Service) HandleDeleteWorkflows(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflows")
}

// HandleListWorkflowClasses serves GET /hybridflow-runner/workflow-classes: every workflow class of every
// board.
func (s *Service) HandleListWorkflowClasses(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet, "/workflow-classes")
}

// HandleCreateWorkflowClass serves POST /hybridflow-runner/boards/{handle}/workflow-classes: file a
// workflow class with the classes it groups.
func (s *Service) HandleCreateWorkflowClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflow-classes")
}

// HandleGetWorkflowClass serves GET /hybridflow-runner/boards/{handle}/workflow-classes/{id}.
func (s *Service) HandleGetWorkflowClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodGet,
		s.boardsUpstream.WorkflowClassPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandlePatchWorkflowClass serves PATCH /hybridflow-runner/boards/{handle}/workflow-classes/{id}: rename it.
func (s *Service) HandlePatchWorkflowClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPatch,
		s.boardsUpstream.WorkflowClassPath(r.PathValue("handle"), r.PathValue("id")))
}

// HandleDeleteWorkflowClasses serves DELETE /hybridflow-runner/boards/{handle}/workflow-classes: remove
// workflow classes, ungrouping their classes.
func (s *Service) HandleDeleteWorkflowClasses(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodDelete, s.boardsUpstream.BoardPath(r.PathValue("handle"))+"/workflow-classes")
}

// HandleInstantiateWorkflowClass serves POST
// /hybridflow-runner/boards/{handle}/workflow-classes/{id}/instantiate: make a workflow from a workflow
// class, on the board the handle names.
func (s *Service) HandleInstantiateWorkflowClass(w http.ResponseWriter, r *http.Request) {
	s.proxyBoards(w, r, http.MethodPost,
		s.boardsUpstream.WorkflowClassPath(r.PathValue("handle"), r.PathValue("id"))+"/instantiate")
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
// revision that has moved on, a 404 a board or card that is gone, and neither is improved by a
// paraphrase here.
//
// The outbound request is built fresh rather than cloned from the inbound one, so nothing the
// caller sent travels by accident: neither its Authorization — a turn token means nothing to the
// store — nor an X-Kiao-Actor of its own. What travels is the service token, the actor this
// service derived, the body, and If-Match where the caller sent one.
func (s *Service) proxyBoards(w http.ResponseWriter, r *http.Request, method, upstreamPath string) {
	upstream := s.boardsUpstream
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
	req, err := http.NewRequest(method, target, bytes.NewReader(body))
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

	resp, err := upstream.Client.Do(req)
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
