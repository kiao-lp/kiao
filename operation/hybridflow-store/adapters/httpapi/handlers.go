package httpapi

import (
	"net/http"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
	"kiao/hybridflow-store/lib/httpx"
)

// The handlers. Every one of them is the same four lines — read the request, call a service, write
// the answer or hand the error to httpx.WriteError — because choosing a status code is not a
// handler's job here (see lib/httpx).

func (a *API) getSchema(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, a.schema)
}

// ── boards ────────────────────────────────────────────────────────────────────

func (a *API) listBoards(w http.ResponseWriter, r *http.Request) {
	boards, err := a.boards.List(r.Context(), boolQuery(r, "archived"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]BoardDto, 0, len(boards))
	for _, board := range boards {
		out = append(out, boardDto(board))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"boards": out})
}

func (a *API) createBoard(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewBoardRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Create(r.Context(), services.NewBoardRequest{Name: req.Name}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, a.boardDetailOf(r, board))
}

// getBoard is **the board, whole**: its cards, and the change cursor it was read at.
func (a *API) getBoard(w http.ResponseWriter, r *http.Request) {
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, a.boardDetailOf(r, board))
}

// boardDetailOf assembles a whole board.
//
// **The cursor is read before the cards, not after.** A change landing between the two reads is
// then one the client is told about again, which costs a redraw; a cursor taken afterwards would be
// a change the client never hears of at all, which costs a card that stays wrong until a reload.
func (a *API) boardDetailOf(r *http.Request, board *entities.Board) BoardDetailDto {
	cursor, err := a.changes.Latest(r.Context())
	if err != nil {
		// A cursor that could not be read is not worth failing the board over: the client gets 0,
		// asks for every change since the beginning, and is told the truth a moment later.
		cursor = 0
	}
	flowNodes, err := a.flowNodes.Board(r.Context(), board.ID)
	if err != nil {
		flowNodes = nil
	}
	classes, err := a.flowNodeClasses.Board(r.Context(), board.ID)
	if err != nil {
		classes = nil
	}
	workflows, err := a.workflows.Board(r.Context(), board.ID)
	if err != nil {
		workflows = nil
	}
	workflowClasses, err := a.workflows.BoardClasses(r.Context(), board.ID)
	if err != nil {
		workflowClasses = nil
	}
	out := BoardDetailDto{
		Board: boardDto(*board), FlowNodes: []FlowNodeDto{}, FlowNodeClasses: []FlowNodeClassDto{},
		Workflows: []WorkflowDto{}, WorkflowClasses: []WorkflowClassDto{},
		Cursor: cursor,
	}
	for _, flowNode := range flowNodes {
		out.FlowNodes = append(out.FlowNodes, flowNodeDto(flowNode))
	}
	for _, class := range classes {
		out.FlowNodeClasses = append(out.FlowNodeClasses, flowNodeClassDto(class.Class, class.Versions))
	}
	for _, workflow := range workflows {
		out.Workflows = append(out.Workflows, workflowDto(workflow))
	}
	for _, workflow := range workflowClasses {
		out.WorkflowClasses = append(out.WorkflowClasses, workflowClassDto(workflow))
	}
	return out
}

func (a *API) patchBoard(w http.ResponseWriter, r *http.Request) {
	req, err := decode[BoardPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Patch(r.Context(), r.PathValue("handle"),
		entities.BoardPatch{Name: req.Name, Archive: req.Archive}, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, boardDto(*board))
}

func (a *API) deleteBoard(w http.ResponseWriter, r *http.Request) {
	if err := a.boards.Delete(r.Context(), r.PathValue("handle"), actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── cards ─────────────────────────────────────────────────────────────────────

func (a *API) createFlowNodes(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewFlowNodesRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	asks := make([]services.NewFlowNodeRequest, 0, len(req.FlowNodes))
	for _, one := range req.FlowNodes {
		next := ""
		var nexts []string
		if one.OnSuccess != nil {
			next, nexts = one.OnSuccess.FlowNode, one.OnSuccess.FlowNodes
		}
		asks = append(asks, services.NewFlowNodeRequest{
			ID: one.ID, Title: one.Title, Type: one.Type, Tags: one.Tags, Body: one.Body,
			Criteria: criteriaOf(one.Criteria), Complexity: one.Complexity,
			Settings: settingsOf(one.Settings), ScheduledAt: one.At, Duration: one.Duration, Spot: spotOf(one.Spot),
			Status: one.Status, Archived: one.Archived, Next: next, Nexts: nexts, Workflow: one.Workflow,
			Transition: transitionOf(one.OnSuccess), ConversationID: one.Chat,
		})
	}
	made, err := a.flowNodes.Create(r.Context(), board.ID, asks, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]FlowNodeDto, 0, len(made))
	for _, flowNode := range made {
		out = append(out, flowNodeDto(flowNode))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"flowNodes": out})
}

func (a *API) getFlowNode(w http.ResponseWriter, r *http.Request) {
	flowNode, err := a.flowNodes.Find(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeDto(*flowNode))
}

func (a *API) patchFlowNode(w http.ResponseWriter, r *http.Request) {
	req, err := decode[FlowNodePatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	patch := entities.FlowNodePatch{
		Title: req.Title, Body: req.Body, ScheduledAt: req.At, Duration: req.Duration,
		ConversationID: req.Chat, Spot: spotOf(req.Spot), ClearSpot: req.ClearSpot, Tags: req.Tags,
		Complexity: req.Complexity, ClearComplexity: req.ClearComplexity,
		ClassVersionID: req.ClassVersion, WorkflowID: req.Workflow, Archived: req.Archived,
	}
	if req.Criteria != nil {
		criteria := criteriaOf(*req.Criteria)
		patch.Criteria = &criteria
	}
	if req.Type != nil {
		flowNodeType := entities.ReadFlowNodeType(*req.Type, settingsOf(req.Settings))
		patch.Type = &flowNodeType
	}
	if req.Status != nil {
		status := entities.ReadFlowNodeStatus(*req.Status)
		patch.Status = &status
	}
	if req.Settings != nil {
		settings := settingsOf(req.Settings)
		patch.Settings = &settings
	}
	if req.OnSuccess != nil {
		// One `onSuccess` on the wire, two halves inside: the card played next is the flow node's
		// own and what becomes of the chat is its task's — and the branches beside the single
		// card are a Gateway's, read against the type the card will have.
		next := req.OnSuccess.FlowNode
		nexts := req.OnSuccess.FlowNodes
		transition := transitionOf(req.OnSuccess)
		patch.Next, patch.Nexts, patch.Transition = &next, &nexts, &transition
	}
	flowNode, err := a.flowNodes.Patch(r.Context(), r.PathValue("id"), patch, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeDto(*flowNode))
}

func (a *API) chainFlowNode(w http.ResponseWriter, r *http.Request) {
	req, err := decode[ChainRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	flowNode, err := a.flowNodes.Chain(r.Context(), r.PathValue("id"), req.FlowNode, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeDto(*flowNode))
}

func (a *API) deleteFlowNodes(w http.ResponseWriter, r *http.Request) {
	req, err := decode[DeleteFlowNodesRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := a.flowNodes.Delete(r.Context(), req.FlowNodes, actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// playFlowNode takes a card for a run: the claim, and nothing else. **A 409 here is the answer, not
// a failure** — it is another run holding the card, and a chain that walks into one ends there and
// says so.
func (a *API) playFlowNode(w http.ResponseWriter, r *http.Request) {
	req, err := decode[PlayRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	flowNode, err := a.flowNodes.StartPlay(r.Context(), r.PathValue("id"), req.Run, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeDto(*flowNode))
}

func (a *API) playedFlowNode(w http.ResponseWriter, r *http.Request) {
	req, err := decode[PlayedRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	flowNode, err := a.flowNodes.EndPlay(r.Context(), r.PathValue("id"), req.Run,
		entities.ReadFlowNodeStatus(req.Status), actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeDto(*flowNode))
}

// recordUsage files what a turn — or a play — cost, on an AI card. The board handle travels in
// the path and names nothing: like the play calls beside it, this one works from the card's id,
// and the card it names is the whole of the request.
func (a *API) recordUsage(w http.ResponseWriter, r *http.Request) {
	req, err := decode[RecordUsageRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	usage, err := a.usage.Record(r.Context(), services.RecordUsageRequest{
		ID: req.ID, FlowNodeID: r.PathValue("id"), ReportedAt: req.ReportedAt,
		RunID: req.Run, Model: req.Model,
		InputTokens: req.InputTokens, OutputTokens: req.OutputTokens,
		CacheReadTokens: req.CacheReadTokens, CacheWriteTokens: req.CacheWriteTokens,
		ReasoningTokens: req.ReasoningTokens, CostUsdMicros: req.CostUsdMicros,
		Extra: req.Extra,
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, taskUsageDto(*usage))
}

// getUsageTotals is what one card spent, whole: the sums of its reports.
func (a *API) getUsageTotals(w http.ResponseWriter, r *http.Request) {
	totals, err := a.usage.Totals(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, usageTotalsDto(totals))
}

// settleRun frees every card a run still holds. What a runner calls at startup for each run it
// finds it was in the middle of: the cards would otherwise say `running` for ever, the only thing
// that would have marked them having died with the process.
func (a *API) settleRun(w http.ResponseWriter, r *http.Request) {
	settled, err := a.flowNodes.SettleRun(r.Context(), r.PathValue("run"), actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, SettleRunResponseDto{Settled: settled})
}

// ── what changed ──────────────────────────────────────────────────────────────

// getChanges is the feed: what happened after the cursor the client holds.
//
// With `wait=1` it **holds the request** until something happens or the timeout runs out, so a
// client is told rather than asking — and a board a run is rewriting redraws in the time a
// notification takes rather than in the time a poll interval takes. Without it, it answers at once,
// which is what a client catching up after a reload wants.
func (a *API) getChanges(w http.ResponseWriter, r *http.Request) {
	since := int64Query(r, "since", 0)
	board := r.URL.Query().Get("board")
	limit := intQuery(r, "limit", 0)

	if boolQuery(r, "wait") {
		ctx, cancel := contextWithTimeout(r, a.watchTimeout)
		defer cancel()
		// The first read happens before the wait: a client whose cursor is already behind must not
		// be made to wait for the *next* change to hear about the ones it has missed.
		changes, latest, err := a.changes.Since(ctx, since, board, limit)
		if err != nil {
			if waitOver(err) {
				// The wait ended inside the read itself: the client is told nothing new from
				// the cursor it holds, rather than a 500 for a timeout it asked for.
				writeChanges(w, nil, since, limit)
				return
			}
			httpx.WriteError(w, r, err)
			return
		}
		for len(changes) == 0 && ctx.Err() == nil {
			if !a.changes.Await(ctx, latest) {
				break
			}
			// Into temporaries: a failed read knows no cursor, and must not clobber the
			// one the last good read gave.
			read, at, err := a.changes.Since(ctx, since, board, limit)
			if err != nil {
				if waitOver(err) {
					// Woken and expired at once: the wait is over, and the answer is what
					// the last good read knew.
					changes = nil
					break
				}
				httpx.WriteError(w, r, err)
				return
			}
			changes, latest = read, at
		}
		writeChanges(w, changes, latest, limit)
		return
	}
	changes, latest, err := a.changes.Since(r.Context(), since, board, limit)
	if err != nil {
		if waitOver(err) {
			// Without a wait the only clock is the client's own going away, and there is
			// nothing to say to nobody.
			return
		}
		httpx.WriteError(w, r, err)
		return
	}
	writeChanges(w, changes, latest, limit)
}

func writeChanges(w http.ResponseWriter, changes []entities.Change, latest int64, limit int) {
	out := make([]ChangeDto, 0, len(changes))
	for _, change := range changes {
		out = append(out, ChangeDto{
			Seq: change.Seq, At: change.At, Scope: string(change.Scope), Kind: change.Kind,
			Board: change.BoardID, FlowNode: change.FlowNodeID,
			FlowNodeClass: change.FlowNodeClassID,
			Agent:         change.AgentID, Runner: change.RunnerID,
			Workflow: change.WorkflowID, WorkflowClass: change.WorkflowClassID,
			Actor: change.Actor, Revision: change.Revision,
		})
	}
	// A truncated page means the cursor to send next is the last change of the page, not the log's
	// latest — otherwise the client would skip whatever the page left out.
	cursor := latest
	more := limit > 0 && len(changes) >= limit
	if more && len(changes) > 0 {
		cursor = changes[len(changes)-1].Seq
	}
	httpx.WriteJSON(w, http.StatusOK, ChangesDto{Changes: out, Cursor: cursor, More: more})
}

// ── agents ────────────────────────────────────────────────────────────────────

func (a *API) listAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := a.agents.List(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]AgentDto, 0, len(agents))
	for _, agent := range agents {
		out = append(out, agentDto(agent))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"agents": out})
}

func (a *API) createAgent(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewAgentRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	agent, err := a.agents.Create(r.Context(), services.NewAgentRequest{
		Name: req.Name, Platform: req.Platform, Model: req.Model, Instructions: req.Instructions,
		Description: req.Description,
	}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, agentDto(*agent))
}

func (a *API) getAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := a.agents.Find(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, agentDto(*agent))
}

func (a *API) patchAgent(w http.ResponseWriter, r *http.Request) {
	req, err := decode[AgentPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	patch := entities.AgentPatch{
		Name: req.Name, Model: req.Model, Instructions: req.Instructions,
		Description: req.Description,
	}
	if req.Platform != nil {
		// Carried through unvalidated: the platform is the service's vocabulary to refuse, in the
		// one place that says what the platforms are, rather than this handler's.
		platform := entities.AgentPlatform(*req.Platform)
		patch.Platform = &platform
	}
	agent, err := a.agents.Patch(r.Context(), r.PathValue("id"), patch, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, agentDto(*agent))
}

func (a *API) deleteAgent(w http.ResponseWriter, r *http.Request) {
	if err := a.agents.Delete(r.Context(), r.PathValue("id"), actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── runners ───────────────────────────────────────────────────────────────────

func (a *API) listRunners(w http.ResponseWriter, r *http.Request) {
	runners, err := a.runners.List(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]RunnerDto, 0, len(runners))
	for _, runner := range runners {
		out = append(out, runnerDto(runner))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"runners": out})
}

func (a *API) createRunner(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewRunnerRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	runner, err := a.runners.Create(r.Context(), services.NewRunnerRequest{Name: req.Name}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, runnerDto(*runner))
}

func (a *API) getRunner(w http.ResponseWriter, r *http.Request) {
	runner, err := a.runners.Find(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, runnerDto(*runner))
}

func (a *API) patchRunner(w http.ResponseWriter, r *http.Request) {
	req, err := decode[RunnerPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	runner, err := a.runners.Patch(r.Context(), r.PathValue("id"),
		entities.RunnerPatch{Name: req.Name}, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, runnerDto(*runner))
}

func (a *API) deleteRunner(w http.ResponseWriter, r *http.Request) {
	if err := a.runners.Delete(r.Context(), r.PathValue("id"), actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// heartbeatRunner records that the runner is alive: it stamps last seen with now. Called by the
// runner's own process every few seconds, with an empty body — the id in the path is the whole of
// the request.
func (a *API) heartbeatRunner(w http.ResponseWriter, r *http.Request) {
	runner, err := a.runners.Heartbeat(r.Context(), r.PathValue("id"), actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, runnerDto(*runner))
}

// ── node classes ──────────────────────────────────────────────────────────────

// listFlowNodeClasses is every class of every board: what the instantiate menu lists.
func (a *API) listFlowNodeClasses(w http.ResponseWriter, r *http.Request) {
	listed, err := a.flowNodeClasses.All(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]ListedClassDto, 0, len(listed))
	for _, one := range listed {
		out = append(out, ListedClassDto{
			FlowNodeClassDto: flowNodeClassDto(one.Class, one.Versions),
			BoardSlug:        one.BoardSlug, BoardName: one.BoardName,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"flowNodeClasses": out})
}

func (a *API) createFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewFlowNodeClassDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	next := ""
	if req.OnSuccess != nil {
		next = req.OnSuccess.FlowNode
	}
	made, err := a.flowNodeClasses.Create(r.Context(), board.ID, services.NewClassRequest{
		ID: req.ID, Title: req.Title, Instantiable: req.Instantiable,
		Type: req.Type, Tags: req.Tags,
		ScheduledAt: req.At, Duration: req.Duration, Spot: spotOf(req.Spot), Next: next,
		Permission: req.Permission, Runner: req.Runner, Transition: transitionOf(req.OnSuccess),
		Body: req.Body, Criteria: criteriaOf(req.Criteria), IsTemplate: req.Template,
		Agent: req.Agent, Published: req.Published, Note: req.Note,
		WorkflowClass: req.WorkflowClass,
	}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, flowNodeClassDto(made.Class, made.Versions))
}

func (a *API) getFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	made, err := a.flowNodeClasses.Find(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeClassDto(made.Class, made.Versions))
}

func (a *API) patchFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[FlowNodeClassPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	patch := entities.FlowNodeClassPatch{
		Title: req.Title, Instantiable: req.Instantiable, Tags: req.Tags, ScheduledAt: req.At, Duration: req.Duration,
		Permission: req.Permission, Runner: req.Runner, Note: req.Note,
		Spot: spotOf(req.Spot), ClearSpot: req.ClearSpot, WorkflowClassID: req.WorkflowClass,
	}
	if req.Type != nil {
		flowNodeType := entities.ReadFlowNodeType(*req.Type, entities.TaskSettings{})
		patch.Type = &flowNodeType
	}
	if req.OnSuccess != nil {
		// One `onSuccess` on the wire, two halves inside: the class after this one and what
		// becomes of an instance's chat.
		next := req.OnSuccess.FlowNode
		transition := transitionOf(req.OnSuccess)
		patch.Next, patch.Transition = &next, &transition
	}
	class, err := a.flowNodeClasses.Patch(r.Context(), r.PathValue("id"), patch, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	versions, err := a.flowNodeClasses.Versions(r.Context(), class.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeClassDto(*class, versions))
}

func (a *API) chainFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[ChainRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	class, err := a.flowNodeClasses.Chain(r.Context(), r.PathValue("id"), req.FlowNode, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	versions, err := a.flowNodeClasses.Versions(r.Context(), class.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flowNodeClassDto(*class, versions))
}

func (a *API) deleteFlowNodeClasses(w http.ResponseWriter, r *http.Request) {
	req, err := decode[DeleteFlowNodeClassesRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := a.flowNodeClasses.Delete(r.Context(), req.FlowNodeClasses, actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── versions ──────────────────────────────────────────────────────────────────

func (a *API) createClassVersion(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewClassVersionDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	version, err := a.flowNodeClasses.CreateVersion(r.Context(), r.PathValue("id"),
		services.NewVersionRequest{
			Body: req.Body, Criteria: criteriaOf(req.Criteria), IsTemplate: req.Template,
			Agent: req.Agent, From: req.From,
		}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, classVersionDto(*version))
}

func (a *API) patchClassVersion(w http.ResponseWriter, r *http.Request) {
	req, err := decode[ClassVersionPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	patch := entities.FlowNodeClassVersionPatch{Body: req.Body, IsTemplate: req.Template, Agent: req.Agent}
	if req.Criteria != nil {
		criteria := criteriaOf(*req.Criteria)
		patch.Criteria = &criteria
	}
	if req.Status != nil {
		status := entities.ReadClassVersionStatus(*req.Status)
		patch.Status = &status
	}
	version, err := a.flowNodeClasses.PatchVersion(r.Context(), r.PathValue("versionId"), patch, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, classVersionDto(*version))
}

func (a *API) deleteClassVersion(w http.ResponseWriter, r *http.Request) {
	if err := a.flowNodeClasses.DeleteVersion(r.Context(), r.PathValue("versionId"), actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── between classes and cards ─────────────────────────────────────────────────

// instantiateFlowNodeClass makes flow nodes from a class and all its successors, on the board the
// handle names — which may be another board than the class's own: the menu lists the classes of
// all boards.
func (a *API) instantiateFlowNodeClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[InstantiateRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	made, err := a.flowNodeClasses.Instantiate(r.Context(), r.PathValue("id"), board.ID, spotOf(req.Spot), req.Bodies, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]FlowNodeDto, 0, len(made))
	for _, flowNode := range made {
		out = append(out, flowNodeDto(flowNode))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"flowNodes": out})
}

// convertFlowNodeToClass files a class from a task: the card's title, kind and answers become
// the class's, and its description and success criteria become the first version's.
func (a *API) convertFlowNodeToClass(w http.ResponseWriter, r *http.Request) {
	made, err := a.flowNodeClasses.ConvertNode(r.Context(), r.PathValue("id"), actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, flowNodeClassDto(made.Class, made.Versions))
}

// ── workflows ─────────────────────────────────────────────────────────────────

// createWorkflow files a workflow on a board and groups its cards in it. What comes back is
// the workflow alone: the grouped cards are read off the board they are on.
func (a *API) createWorkflow(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewWorkflowRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	made, err := a.workflows.Create(r.Context(), board.ID, services.NewWorkflowRequest{
		ID: req.ID, Name: req.Name, FlowNodes: req.FlowNodes,
	}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, workflowDto(*made))
}

func (a *API) getWorkflow(w http.ResponseWriter, r *http.Request) {
	made, err := a.workflows.Find(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workflowDto(*made))
}

func (a *API) patchWorkflow(w http.ResponseWriter, r *http.Request) {
	req, err := decode[WorkflowPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	made, err := a.workflows.Patch(r.Context(), r.PathValue("id"),
		entities.WorkflowPatch{Name: req.Name}, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workflowDto(*made))
}

func (a *API) deleteWorkflows(w http.ResponseWriter, r *http.Request) {
	req, err := decode[DeleteWorkflowsRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := a.workflows.Delete(r.Context(), req.Workflows, actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── workflow classes ──────────────────────────────────────────────────────────

// listWorkflowClasses is every workflow class of every board: what the instantiate menu
// lists beside the node classes.
func (a *API) listWorkflowClasses(w http.ResponseWriter, r *http.Request) {
	listed, err := a.workflows.All(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]ListedWorkflowClassDto, 0, len(listed))
	for _, one := range listed {
		out = append(out, ListedWorkflowClassDto{
			WorkflowClassDto: workflowClassDto(one.Workflow),
			BoardSlug:        one.BoardSlug, BoardName: one.BoardName,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workflowClasses": out})
}

// instantiateWorkflowClass makes a workflow from a workflow class — one flow node per
// member — on the board the handle names, which may be another board than the workflow
// class's own.
func (a *API) instantiateWorkflowClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[InstantiateRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	workflow, made, err := a.flowNodeClasses.InstantiateWorkflow(
		r.Context(), r.PathValue("id"), board.ID, spotOf(req.Spot), req.Bodies, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]FlowNodeDto, 0, len(made))
	for _, flowNode := range made {
		out = append(out, flowNodeDto(flowNode))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"workflow": workflowDto(workflow), "flowNodes": out,
	})
}

func (a *API) createWorkflowClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[NewWorkflowClassRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	board, err := a.boards.Find(r.Context(), r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	made, err := a.workflows.CreateClass(r.Context(), board.ID, services.NewWorkflowClassRequest{
		ID: req.ID, Name: req.Name, Classes: req.Classes,
	}, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, workflowClassDto(*made))
}

func (a *API) getWorkflowClass(w http.ResponseWriter, r *http.Request) {
	made, err := a.workflows.FindClass(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workflowClassDto(*made))
}

func (a *API) patchWorkflowClass(w http.ResponseWriter, r *http.Request) {
	req, err := decode[WorkflowClassPatchDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	revision, err := revisionOf(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	made, err := a.workflows.PatchClass(r.Context(), r.PathValue("id"),
		entities.WorkflowClassPatch{Name: req.Name}, revision, actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workflowClassDto(*made))
}

func (a *API) deleteWorkflowClasses(w http.ResponseWriter, r *http.Request) {
	req, err := decode[DeleteWorkflowClassesRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := a.workflows.DeleteClasses(r.Context(), req.WorkflowClasses, actorOf(r)); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
