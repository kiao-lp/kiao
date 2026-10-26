package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// FlowNodes is the card half of the core: what a card is made with, what may change about it, and
// the two calls a **play** is made of.
type FlowNodes struct {
	repo      ports.BoardRepository
	agents    ports.AgentRepository
	runners   ports.RunnerRepository
	classes   ports.ClassRepository
	workflows ports.WorkflowRepository
	clock     ports.Clock
	ids       ports.IDs
}

func NewFlowNodes(repo ports.BoardRepository, agents ports.AgentRepository, runners ports.RunnerRepository, classes ports.ClassRepository, workflows ports.WorkflowRepository, clock ports.Clock, ids ports.IDs) *FlowNodes {
	return &FlowNodes{repo: repo, agents: agents, runners: runners, classes: classes, workflows: workflows, clock: clock, ids: ids}
}

// NewFlowNodeRequest is one card to be made.
type NewFlowNodeRequest struct {
	// ID is the identity the client minted, or empty to have one minted here.
	//
	// **A card's id comes from whoever made the card**, and the editor makes cards in the browser:
	// that is what lets a card be drawn the instant it is typed rather than after a round trip, and
	// what lets cards pasted from another instance keep the chains among them. A malformed id is
	// refused rather than replaced — a client that meant to name a card and was quietly given
	// another id would select the wrong one, or none.
	ID    string
	Title string
	// Type is what kind of card it is; empty is read off the settings, the way a document saying no
	// type is read — a named agent makes it AI, and nothing at all makes it Human.
	Type        string
	Tags        []string
	ScheduledAt string
	Duration    string
	Spot        *entities.Spot
	Status      string
	// Archived creates the card hidden. Ordinary creates leave it false.
	Archived bool
	// Next is the card played after this one. It may name a card being created in the same call,
	// which is what a pasted chain is.
	Next string
	// Nexts are the cards a Gateway starts when it fires. They may name cards being created in
	// the same call, like Next — and on any other kind they are dropped, one card following
	// those.
	Nexts []string
	// Workflow is the workflow the card is grouped in — one of this board — or empty for none.
	// What a card made inside a rectangle says.
	Workflow string

	// ── the task's own ────────────────────────────────────────────────────────
	//
	// Given for a card that turns out to be a Shutdown or a Scheduler, they are dropped: those two
	// describe no work, so there is no task to put them on.
	Note     string
	Value    string
	Body     string
	Criteria []entities.SuccessCriterion
	// Complexity is the task's estimation, or nil for none. Read forgivingly: anything outside
	// the Fibonacci suite is no complexity at all.
	Complexity *int
	Settings   entities.TaskSettings
	// ConversationID binds a task to a chat at creation, which is what a card cloned from a played
	// one carries.
	ConversationID string
	Transition     entities.Transition
}

// Create files cards on a board. Several at once because a paste of six cards is one gesture: one
// transaction, one change to the board.
func (t *FlowNodes) Create(ctx context.Context, boardID string, reqs []NewFlowNodeRequest, actor string) ([]entities.FlowNode, error) {
	if len(reqs) == 0 {
		return nil, entities.Invalidf("no card to create")
	}
	board, err := t.repo.FindBoard(ctx, boardID)
	if err != nil {
		return nil, err
	}
	for _, req := range reqs {
		if err := t.agentOf(ctx, req.Settings); err != nil {
			return nil, err
		}
		if err := t.runnerOf(ctx, req.Settings); err != nil {
			return nil, err
		}
		if err := CheckWorkflow(ctx, t.workflows, board.ID, req.Workflow); err != nil {
			return nil, err
		}
	}
	now := t.clock.Now()
	flowNodes := make([]*entities.FlowNode, 0, len(reqs))
	for _, req := range reqs {
		if err := entities.ValidateSchedule(req.ScheduledAt, req.Duration); err != nil {
			return nil, err
		}
		flowNodeType := entities.ReadFlowNodeType(req.Type, req.Settings)
		id := strings.TrimSpace(req.ID)
		if id == "" {
			id = t.ids.NewID()
		} else if !entities.ValidID(id) {
			return nil, entities.Invalidf("%q is not an id this store can hold", req.ID)
		}
		title, tags, note, value := strings.TrimSpace(req.Title), entities.ReadTags(req.Tags), "", ""
		scheduledAt, duration := req.ScheduledAt, req.Duration
		if flowNodeType.IsDisplay() {
			scheduledAt, duration = "", ""
		}
		if flowNodeType == entities.FlowNodeNote {
			title, tags, note = "", nil, req.Note
		} else if flowNodeType == entities.FlowNodeValue {
			tags = nil
			parsed, err := entities.ReadValueJSON(req.Value)
			if err != nil {
				return nil, err
			}
			value = parsed
		}
		flowNodes = append(flowNodes, &entities.FlowNode{
			ID: id, BoardID: board.ID,
			Title: title, Type: flowNodeType, Note: note, Value: value, Tags: tags,
			Task:        taskOf(req, flowNodeType, t.ids.NewID),
			ScheduledAt: entities.ReadSchedule(scheduledAt),
			Duration:    entities.ReadDuration(duration),
			Spot:        req.Spot, Status: entities.ReadFlowNodeStatus(req.Status),
			Archived:   req.Archived,
			Next:       entities.NextFor(req.Next, flowNodeType),
			Nexts:      entities.NextsFor(req.Nexts, flowNodeType),
			WorkflowID: strings.TrimSpace(req.Workflow),
			CreatedAt:  now, UpdatedAt: now, Revision: 1,
		})
	}
	changes := make([]entities.FlowNode, 0, len(flowNodes))
	for _, node := range flowNodes {
		changes = append(changes, *node)
	}
	if err := t.checkConnections(ctx, board.ID, changes); err != nil {
		return nil, err
	}
	if err := t.repo.CreateFlowNodes(ctx, flowNodes, actor); err != nil {
		return nil, err
	}
	out := make([]entities.FlowNode, 0, len(flowNodes))
	for _, flowNode := range flowNodes {
		out = append(out, *flowNode)
	}
	return out, nil
}

// taskOf is the task a request describes, or nil where the card is not one: a Shutdown and a
// Scheduler are the board acting on its own machine, and what a request said about a description or
// an agent is dropped with the type rather than filed under a card that can never read it.
func taskOf(req NewFlowNodeRequest, flowNodeType entities.FlowNodeType, mint func() string) *entities.Task {
	if !flowNodeType.IsTask() {
		return nil
	}
	task := entities.Task{
		Body: req.Body, Criteria: withCriterionIDs(req.Criteria, mint),
		Complexity:     entities.ReadComplexity(req.Complexity),
		Settings:       req.Settings,
		ConversationID: req.ConversationID, Transition: req.Transition,
	}.For(flowNodeType)
	return &task
}

// withCriterionIDs keeps the criteria a request describes and mints what the editor did not: a
// stored criterion always has both halves of its pair — the autogenerated id and the entered
// text. A pasted id is honoured, so a chain of edits keeps naming the same criterion.
func withCriterionIDs(said []entities.SuccessCriterion, mint func() string) []entities.SuccessCriterion {
	kept := entities.ReadSuccessCriteria(said)
	for i := range kept {
		if !entities.ValidID(kept[i].ID) {
			kept[i].ID = mint()
		}
	}
	return kept
}

// Board is every card of a board. This and the board's own row are the whole of what drawing a
// board reads.
func (t *FlowNodes) Board(ctx context.Context, boardID string) ([]entities.FlowNode, error) {
	return t.repo.ListFlowNodes(ctx, boardID)
}

// Find is one card.
func (t *FlowNodes) Find(ctx context.Context, id string) (*entities.FlowNode, error) {
	return t.repo.FindFlowNode(ctx, id)
}

// Patch changes the fields the patch names. What it enforces before writing is the four things
// a card cannot say whatever a client sends:
//
//   - **A chain names a card of this board.** A chain onto a card of another board is a run that
//     would walk off the end of the one it is playing — each of a Gateway's branches alike.
//   - **A card's chain is read against its type.** A chain on a card that ends the board is a
//     thing no client can draw, and a Gateway's branches are the list beside the single card
//     rather than the card itself.
//   - **Only a task is written with a task's fields.** A description, an agent or a chat named on
//     a card that is a Shutdown or a Scheduler is dropped: those two describe no work, so there is
//     nothing of theirs for any of it to be filed on.
//   - **A card's agent is an agent of this store.** A card naming an id nothing holds is refused
//     here, where the message can name the card, rather than at its first play. Its runner is a
//     runner of this store the same way.
func (t *FlowNodes) Patch(ctx context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	flowNode, err := t.repo.FindFlowNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if patch.Tags != nil {
		tags := entities.ReadTags(*patch.Tags)
		patch.Tags = &tags
	}
	if err := entities.NormalizeSchedulePatch(&patch.ScheduledAt, &patch.Duration); err != nil {
		return nil, err
	}
	// The type after the patch, since it is what the chain is read against — changing a card to
	// Shutdown takes its chain off in the same write rather than in the next one.
	flowNodeType := flowNode.Type
	if patch.Type != nil {
		flowNodeType = *patch.Type
	}
	if patch.Next != nil && flowNodeType == entities.FlowNodeGateway {
		// The single successor is not asked of a Gateway: its branches are the list beside it.
		// Dropped like a task's fields on a card that is none — and the re-read below then clears
		// what a retyped card stored under its old kind.
		patch.Next = nil
	}
	if patch.Next != nil {
		next := entities.NextFor(*patch.Next, flowNodeType)
		if next != "" {
			if err := t.sameBoard(ctx, flowNode.BoardID, next); err != nil {
				return nil, err
			}
		}
		patch.Next = &next
	} else if patch.Type != nil {
		// The type changed and the chain did not: it is re-read against the new type, because a
		// Shutdown carrying a successor is a card that says two contradictory things.
		if next := entities.NextFor(flowNode.Next, flowNodeType); next != flowNode.Next {
			patch.Next = &next
		}
	}
	if patch.Nexts != nil {
		if flowNodeType != entities.FlowNodeGateway {
			if patch.Type != nil && flowNode.Type == entities.FlowNodeGateway {
				// Retyped away with branches named: the stored ones go with the kind, and the
				// named ones are dropped — one card follows a card that is no Gateway.
				patch.Nexts = &[]string{}
			} else {
				patch.Nexts = nil
			}
		} else {
			nexts := entities.NextsFor(*patch.Nexts, flowNodeType)
			for _, next := range nexts {
				if err := t.sameBoard(ctx, flowNode.BoardID, next); err != nil {
					return nil, err
				}
			}
			patch.Nexts = &nexts
		}
	} else if patch.Type != nil && flowNodeType != entities.FlowNodeGateway && len(flowNode.Nexts) > 0 {
		// Retyped away and the branches did not: they go with the kind, the way the single chain
		// goes off a card retyped to Shutdown.
		patch.Nexts = &[]string{}
	}
	if flowNodeType.IsDisplay() {
		patch.ScheduledAt, patch.Duration = nil, nil
		if patch.Type != nil && (flowNode.ScheduledAt != "" || flowNode.Duration != "") {
			empty := ""
			patch.ScheduledAt, patch.Duration = &empty, &empty
		}
		if patch.Value != nil {
			parsed, err := entities.ReadValueJSON(*patch.Value)
			if err != nil {
				return nil, err
			}
			patch.Value = &parsed
		}
		if flowNodeType == entities.FlowNodeNote {
			patch.Value = nil
			if patch.Title != nil {
				empty := ""
				patch.Title = &empty
			}
			patch.Tags = nil
		} else {
			patch.Note = nil
			patch.Tags = nil
		}
		if patch.Type != nil {
			if flowNodeType == entities.FlowNodeNote && flowNode.Value != "" && patch.Value == nil {
				empty := ""
				patch.Value = &empty
			}
			if flowNodeType == entities.FlowNodeValue && flowNode.Note != "" && patch.Note == nil {
				empty := ""
				patch.Note = &empty
			}
			if flowNodeType == entities.FlowNodeNote && flowNode.Title != "" {
				empty := ""
				patch.Title = &empty
			}
		}
	} else {
		patch = patch.WithoutDisplay()
		if patch.Type != nil && (flowNode.Note != "" || flowNode.Value != "") {
			empty := ""
			if flowNode.Note != "" {
				patch.Note = &empty
			}
			if flowNode.Value != "" {
				patch.Value = &empty
			}
		}
	}
	// The task's fields, read against the type the card will have. A card that is not a task after
	// this patch is written without them, and one that becomes a task has a task made for it by the
	// store — empty where the patch named nothing, which is a card somebody has yet to describe.
	if !flowNodeType.IsTask() {
		patch = patch.WithoutTask()
	} else if patch.Transition != nil {
		transition := patch.Transition.For(flowNodeType)
		patch.Transition = &transition
	} else if patch.Type != nil && flowNode.Task != nil {
		// The type changed and the transition did not: a card retyped from AI to Human is answering
		// a question about a conversation it no longer has.
		if held := flowNode.Task.Transition; held.For(flowNodeType) != held {
			transition := held.For(flowNodeType)
			patch.Transition = &transition
		}
	}
	if flowNodeType.IsTask() {
		// The task's new halves, read the way a create reads them: empty texts dropped, missing
		// ids minted, and anything outside the Fibonacci suite read as no complexity at all —
		// which takes a complexity off rather than refusing the patch.
		if patch.Criteria != nil {
			minted := withCriterionIDs(*patch.Criteria, t.ids.NewID)
			patch.Criteria = &minted
		}
		if patch.Complexity != nil {
			if read := entities.ReadComplexity(patch.Complexity); read == nil {
				patch.Complexity, patch.ClearComplexity = nil, true
			} else {
				patch.Complexity = read
			}
		}
	}
	if patch.Empty() {
		// Everything the patch asked for was a task's, on a card that is not one.
		return nil, entities.Invalidf("the patch changes nothing this card has")
	}
	// The agent last, and only where the settings survived the type: a Shutdown sent an agent id
	// nothing holds should be told its settings were dropped, not told the agent is missing.
	if patch.Settings != nil {
		if err := t.agentOf(ctx, *patch.Settings); err != nil {
			return nil, err
		}
		if err := t.runnerOf(ctx, *patch.Settings); err != nil {
			return nil, err
		}
	}
	// The class version it names is one this store holds — or the empty string, which breaks
	// the link rather than naming anything.
	if patch.ClassVersionID != nil && *patch.ClassVersionID != "" {
		if _, err := t.classes.FindVersion(ctx, *patch.ClassVersionID); err != nil {
			return nil, err
		}
	}
	// The workflow it names is one of this board — or the empty string, which takes the card
	// out of whichever rectangle it was in.
	if patch.WorkflowID != nil && *patch.WorkflowID != "" {
		if err := CheckWorkflow(ctx, t.workflows, flowNode.BoardID, *patch.WorkflowID); err != nil {
			return nil, err
		}
	}
	if patch.Next != nil || patch.Nexts != nil || patch.Type != nil {
		changed := *flowNode
		changed.Type = flowNodeType
		if patch.Next != nil {
			changed.Next = *patch.Next
		}
		if patch.Nexts != nil {
			changed.Nexts = *patch.Nexts
		}
		if err := t.checkConnections(ctx, flowNode.BoardID, []entities.FlowNode{changed}); err != nil {
			return nil, err
		}
	}
	return t.repo.PatchFlowNode(ctx, id, patch, expected, actor)
}

// Chain links a card to the one played after it, or takes the link off with an empty target. Naming
// a flow node is the only thing that chains two of them.
//
// A Gateway is chained one branch at a time: the target is **added** to its branches — a chain
// drawn on the board is one more branch, not a branch redrawn — and an empty target takes them all
// off. Naming a branch it already holds is answered as it stands, with no write.
//
// The transition is left exactly where it was, chain or no chain. It says what becomes of this
// card's own conversation, which is the panel's question and not the line's: a card that ends its
// chat still ends it with a successor named, and a chain redrawn to another card hands on what it
// was handing on.
func (t *FlowNodes) Chain(ctx context.Context, fromID, toID string, actor string) (*entities.FlowNode, error) {
	flowNode, err := t.repo.FindFlowNode(ctx, fromID)
	if err != nil {
		return nil, err
	}
	if toID != "" {
		if toID == fromID {
			return nil, entities.Invalidf("a card cannot be chained to itself")
		}
		if err := t.sameBoard(ctx, flowNode.BoardID, toID); err != nil {
			return nil, err
		}
	}
	if flowNode.Type == entities.FlowNodeGateway {
		return t.chainGateway(ctx, flowNode, toID, actor)
	}
	next := entities.NextFor(toID, flowNode.Type)
	return t.Patch(ctx, fromID, entities.FlowNodePatch{Next: &next}, &flowNode.Revision, actor)
}

// chainGateway adds a branch to a Gateway, or takes them all off with an empty target. A branch
// named twice is held once: the second naming is no change, and no write is made for it.
func (t *FlowNodes) chainGateway(ctx context.Context, flowNode *entities.FlowNode, toID, actor string) (*entities.FlowNode, error) {
	if toID == "" {
		if len(flowNode.Nexts) == 0 {
			return flowNode, nil
		}
		return t.Patch(ctx, flowNode.ID, entities.FlowNodePatch{Nexts: &[]string{}}, &flowNode.Revision, actor)
	}
	for _, held := range flowNode.Nexts {
		if held == toID {
			return flowNode, nil
		}
	}
	nexts := append(append([]string{}, flowNode.Nexts...), toID)
	return t.Patch(ctx, flowNode.ID, entities.FlowNodePatch{Nexts: &nexts}, &flowNode.Revision, actor)
}

// Delete removes cards. Chains onto them are broken by the schema rather than here, so a card
// removed by hand in SQL leaves no chain pointing at nothing either. A workflow left with no
// members goes with them: a rectangle with nothing in it is a shape nobody can pick up again,
// so the store does not keep it.
func (t *FlowNodes) Delete(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no card to delete")
	}
	// The workflows the going cards are grouped in, by board: emptiness is read off the board
	// afterwards, so a workflow with members left behind is kept. An id naming no card is passed
	// over here and refused below, where the delete itself decides.
	type membership struct{ board, workflow string }
	held := map[string]membership{}
	for _, id := range ids {
		flowNode, err := t.repo.FindFlowNode(ctx, id)
		if err != nil {
			continue
		}
		if flowNode.WorkflowID != "" {
			held[flowNode.WorkflowID] = membership{flowNode.BoardID, flowNode.WorkflowID}
		}
	}
	if err := t.repo.DeleteFlowNodes(ctx, ids, actor); err != nil {
		return err
	}
	for _, member := range held {
		kept, err := t.repo.ListFlowNodes(ctx, member.board)
		if err != nil {
			return err
		}
		empty := true
		for _, flowNode := range kept {
			if flowNode.WorkflowID == member.workflow {
				empty = false
				break
			}
		}
		if empty {
			if err := t.workflows.DeleteWorkflows(ctx, []string{member.workflow}, actor); err != nil &&
				!errors.Is(err, entities.ErrNotFound) {
				return err
			}
		}
	}
	return nil
}

// ── A play, in two calls ──────────────────────────────────────────────────────
//
// What a run does to a card is exactly two writes, and they are here rather than in the runner so
// that the rules hold whoever plays it — the service's own loop, a runner in another process, a
// person pressing Play twice.

// StartPlay takes the card for a run.
//
// **The claim is the database's**: the card is taken only if it is free and ready, so two runs
// reaching for one card end with one winner and one ErrFlowNodeHeld rather than two turns playing
// one card.
func (t *FlowNodes) StartPlay(ctx context.Context, flowNodeID, runID string, actor string) (*entities.FlowNode, error) {
	if runID == "" {
		return nil, entities.Invalidf("a play names the run it belongs to")
	}
	flowNode, err := t.repo.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return nil, err
	}
	if err := flowNode.Runnable(); err != nil {
		return nil, err
	}
	// **Once per play, not once per attempt.** A turn that came back an error worth waiting out — a
	// usage limit, an API at capacity — is sent the same card again twenty minutes later, by the run
	// that still holds it. That is the same play coming back, so the card is taken again without
	// complaint.
	resuming := flowNode.RunID == runID && flowNode.Status.Held()
	if !resuming && flowNode.Status != entities.StatusReady {
		return nil, fmt.Errorf("%w: the card stands at %q", entities.ErrInvalid, flowNode.Status)
	}
	return t.repo.ClaimFlowNode(ctx, flowNodeID, runID, entities.StatusRunning, actor)
}

// EndPlay hands the card back with the status the play ended on. The run must still hold the card:
// a run that was stopped and whose turn came back late may not mark a card somebody else is now
// playing.
//
// The description is left exactly where it is, whatever the ending: what the turn said is in the
// conversation the card names, and the card still asks what it was asking.
func (t *FlowNodes) EndPlay(ctx context.Context, flowNodeID, runID string, status entities.FlowNodeStatus, actor string) (*entities.FlowNode, error) {
	return t.repo.ReleaseFlowNode(ctx, flowNodeID, runID, status, actor)
}

// SettleRun clears every card a run still holds. What a restart calls: the only thing that would
// have marked those cards died with the process that was playing them, so they would say `running`
// for ever.
func (t *FlowNodes) SettleRun(ctx context.Context, runID string, actor string) (int, error) {
	return t.repo.ReleaseRun(ctx, runID, entities.StatusInterrupted, actor)
}

// Next is the card played after this one, or nil when the chain ends here. It is the run's own
// question, asked of the board rather than of a copy the run has been carrying: the card may have
// been re-chained, retyped or deleted while the turn ran. An archived successor ends the chain
// too: its link is hidden everywhere and playing through it would surface a hidden card.
func (t *FlowNodes) Next(ctx context.Context, flowNodeID string) (*entities.FlowNode, error) {
	flowNode, err := t.repo.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return nil, err
	}
	if flowNode.Next == "" {
		return nil, nil
	}
	next, err := t.repo.FindFlowNode(ctx, flowNode.Next)
	if errors.Is(err, entities.ErrNotFound) {
		return nil, nil
	}
	if err == nil && next.Archived {
		return nil, nil
	}
	return next, err
}

// sameBoard refuses a chain onto a card that is not on this board.
func (t *FlowNodes) sameBoard(ctx context.Context, boardID, flowNodeID string) error {
	target, err := t.repo.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return err
	}
	if target.BoardID != boardID {
		return entities.Invalidf("card %s is on another board", flowNodeID)
	}
	return nil
}

// agentOf checks that the agent a card's settings name is an agent of this store — or is empty,
// which is a card that names none and is simply not played. A card written before managed agents,
// naming an engine rather than an id, reads that way too until its settings are next written: the
// reads stay forgiving, and the writes are what narrow.
func (t *FlowNodes) agentOf(ctx context.Context, settings entities.TaskSettings) error {
	if settings.Agent == "" {
		return nil
	}
	if _, err := t.agents.FindAgent(ctx, settings.Agent); err != nil {
		return entities.NotFoundf("agent %s", settings.Agent)
	}
	return nil
}

// runnerOf checks that the runner a card's settings name is a runner of this store — or is empty,
// which is a card pinned nowhere and played wherever a Play is pressed.
func (t *FlowNodes) runnerOf(ctx context.Context, settings entities.TaskSettings) error {
	if settings.Runner == "" {
		return nil
	}
	if _, err := t.runners.FindRunner(ctx, settings.Runner); err != nil {
		return entities.NotFoundf("runner %s", settings.Runner)
	}
	return nil
}
