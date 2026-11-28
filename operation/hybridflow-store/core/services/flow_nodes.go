package services

import (
	"context"
	"errors"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// FlowNodes is the flow node half of the core: what a flow node is made with, what may change about it, and
// the two calls a **play** is made of.
type FlowNodes struct {
	repo      ports.BoardRepository
	agents    ports.AgentLookup
	runners   ports.RunnerRepository
	workflows ports.WorkflowRepository
	clock     ports.Clock
	ids       ports.IDs
}

func NewFlowNodes(repo ports.BoardRepository, agents ports.AgentLookup, runners ports.RunnerRepository, workflows ports.WorkflowRepository, clock ports.Clock, ids ports.IDs) *FlowNodes {
	return &FlowNodes{repo: repo, agents: agents, runners: runners, workflows: workflows, clock: clock, ids: ids}
}

// NewFlowNodeRequest is one flow node to be made.
type NewFlowNodeRequest struct {
	// ID is the identity the client minted, or empty to have one minted here.
	//
	// **A flow node's id comes from whoever made the flow node**, and the editor makes flow nodes in the browser:
	// that is what lets a flow node be drawn the instant it is typed rather than after a round trip, and
	// what lets flow nodes pasted from another instance keep the chains among them. A malformed id is
	// refused rather than replaced — a client that meant to name a flow node and was quietly given
	// another id would select the wrong one, or none.
	ID    string
	Title string
	// Type is what kind of flow node it is; empty is read off the settings, the way a document saying no
	// type is read — a named agent makes it AI, and nothing at all makes it Human.
	Type        string
	Tags        []string
	ScheduledAt string
	Duration    string
	Spot        *entities.Spot
	Size        *entities.Size
	Status      string

	PullRequestID     string
	PullRequestStatus string
	CommitID          string
	CommitStatus      string
	MaxPasses         *int
	RemainingPasses   *int
	// Archived creates the flow node hidden. Ordinary creates leave it false.
	Archived bool
	// Next is the flow node played after this one. It may name a flow node being created in the same call,
	// which is what a pasted chain is.
	Next string
	// Nexts links branches of a gateway, including flow nodes in the same creation batch.
	Nexts  []string
	Routes []entities.Route
	// Workflow is the workflow the flow node is grouped in — one of this board — or empty for none.
	// What a flow node made inside a rectangle says.
	Workflow string

	Note        string
	Value       string
	ValueType   string
	RoleID      string
	RoleKind    entities.RoleKind
	People      []string
	Description string

	// ── the task's own ────────────────────────────────────────────────────────
	//
	// Given for a flow node that turns out to be a Shutdown or a Scheduler, they are dropped: those two
	// describe no work, so there is no task to put them on.
	OutputType        string
	Body              string
	MultiPartTemplate bool
	Criteria          []entities.SuccessCriterion
	// Complexity is the task's estimation, or nil for none. Read forgivingly: anything outside
	// the Fibonacci suite is no complexity at all.
	Complexity *int
	Settings   entities.TaskSettings
	// ConversationID binds a task to a chat at creation, which is what a flow node cloned from a played
	// one carries.
	ConversationID string
	Transition     entities.Transition
}

// Create files flow nodes on a board. Several at once because a paste of six flow nodes is one gesture: one
// transaction, one change to the board.
func (t *FlowNodes) Create(ctx context.Context, boardID string, reqs []NewFlowNodeRequest, actor string) ([]entities.FlowNode, error) {
	if len(reqs) == 0 {
		return nil, entities.Invalidf("no flow node to create")
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
	flowNodes, err := t.prepareFlowNodes(ctx, board.ID, reqs)
	if err != nil {
		return nil, err
	}
	if err := t.checkConnections(ctx, board.ID, flowNodes); err != nil {
		return nil, err
	}
	if err := t.repo.CreateFlowNodes(ctx, flowNodePointers(flowNodes), actor); err != nil {
		return nil, err
	}
	return flowNodes, nil
}

func (t *FlowNodes) prepareFlowNodes(ctx context.Context, boardID string, reqs []NewFlowNodeRequest) ([]entities.FlowNode, error) {
	now := t.clock.Now()
	flowNodes := make([]entities.FlowNode, 0, len(reqs))
	for _, req := range reqs {
		if err := entities.ValidateSchedule(req.ScheduledAt, req.Duration); err != nil {
			return nil, err
		}
		flowNodeType := entities.ReadFlowNodeType(req.Type, req.Settings)
		var pullRequestID, pullRequestStatus, commitID, commitStatus string
		var err error
		switch flowNodeType {
		case entities.FlowNodeBitbucketPRStatus:
			pullRequestID, err = entities.ReadPullRequestID(req.PullRequestID)
			if err != nil {
				return nil, err
			}
			pullRequestStatus, err = entities.ReadPullRequestStatus(req.PullRequestStatus)
			if err != nil {
				return nil, err
			}
		case entities.FlowNodeBitbucketCommitStatus:
			commitID, err = entities.ReadCommitID(req.CommitID)
			if err != nil {
				return nil, err
			}
			commitStatus, err = entities.ReadCommitStatus(req.CommitStatus)
			if err != nil {
				return nil, err
			}
		}
		id := strings.TrimSpace(req.ID)
		if id == "" {
			id = t.ids.NewID()
		} else if !entities.ValidID(id) {
			return nil, entities.Invalidf("%q is not an id this store can hold", req.ID)
		}
		title, tags, note, value, valueType := strings.TrimSpace(req.Title), entities.ReadTags(req.Tags), "", "", ""
		scheduledAt, duration := req.ScheduledAt, req.Duration
		if flowNodeType.IsDisplay() {
			scheduledAt, duration = "", ""
			tags = nil
		}
		var roleID, description string
		var roleKind entities.RoleKind
		var people []string
		switch flowNodeType {
		case entities.FlowNodeNote:
			title, note = "", req.Note
		case entities.FlowNodeValue:
			parsed, err := entities.ReadValueJSON(req.Value)
			if err != nil {
				return nil, err
			}
			value = parsed
			valueType = strings.TrimSpace(req.ValueType)
			if entities.ReadValueType(valueType) != valueType {
				return nil, entities.Invalidf("value type %q is not \"json-schema\" or a value id", req.ValueType)
			}
		case entities.FlowNodeRole:
			roleID, err = entities.ReadRoleID(req.RoleID)
			if err != nil {
				return nil, err
			}
			roleKind, err = entities.ReadRoleKind(req.RoleKind)
			if err != nil {
				return nil, err
			}
			people, err = entities.ReadRolePeople(req.People)
			if err != nil {
				return nil, err
			}
			description = strings.TrimSpace(req.Description)
		}
		node := entities.FlowNode{
			ID: id, BoardID: boardID,
			Title: title, Type: flowNodeType, Note: note, Value: value, ValueType: valueType, Tags: tags,
			RoleID:        roleID,
			RoleKind:      roleKind,
			People:        people,
			Description:   description,
			OutputType:    strings.TrimSpace(req.OutputType),
			Task:          taskOf(req, flowNodeType, t.ids.NewID),
			ScheduledAt:   entities.ReadSchedule(scheduledAt),
			Duration:      entities.ReadDuration(duration),
			PullRequestID: pullRequestID, PullRequestStatus: pullRequestStatus,
			CommitID: commitID, CommitStatus: commitStatus,
			Spot: req.Spot, Size: req.Size, Status: entities.ReadFlowNodeStatus(req.Status),
			Archived:   req.Archived,
			Next:       entities.NextFor(req.Next, flowNodeType),
			Nexts:      entities.NextsFor(req.Nexts, flowNodeType),
			Routes:     req.Routes,
			WorkflowID: strings.TrimSpace(req.Workflow),
			CreatedAt:  now, UpdatedAt: now, Revision: 1,
		}
		if err := initLimiter(&node, req.MaxPasses, req.RemainingPasses); err != nil {
			return nil, err
		}
		flowNodes = append(flowNodes, node)
	}
	for i := range flowNodes {
		node := &flowNodes[i]
		if err := node.ValidateRoutes(); err != nil {
			return nil, err
		}
		if err := t.checkOutputType(ctx, node, flowNodes); err != nil {
			return nil, err
		}
		if err := t.checkValueType(ctx, boardID, *node, flowNodes); err != nil {
			return nil, err
		}
	}
	return flowNodes, nil
}

func flowNodePointers(nodes []entities.FlowNode) []*entities.FlowNode {
	pointers := make([]*entities.FlowNode, len(nodes))
	for i := range nodes {
		pointers[i] = &nodes[i]
	}
	return pointers
}

// taskOf is the task a request describes, or nil where the flow node is not one: a Shutdown and a
// Scheduler are the board acting on its own machine, and what a request said about a description or
// an agent is dropped with the type rather than filed under a flow node that can never read it.
func taskOf(req NewFlowNodeRequest, flowNodeType entities.FlowNodeType, mint func() string) *entities.Task {
	if !flowNodeType.IsTask() {
		return nil
	}
	task := entities.Task{
		Body: req.Body, MultiPartTemplate: req.MultiPartTemplate,
		Criteria:       withCriterionIDs(req.Criteria, mint),
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

// Board is every flow node of a board. This and the board's own row are the whole of what drawing a
// board reads.
func (t *FlowNodes) Board(ctx context.Context, boardID string) ([]entities.FlowNode, error) {
	return t.repo.ListFlowNodes(ctx, boardID)
}

// Find is one flow node.
func (t *FlowNodes) Find(ctx context.Context, id string) (*entities.FlowNode, error) {
	return t.repo.FindFlowNode(ctx, id)
}

// Patch changes the fields the patch names. What it enforces before writing is the four things
// a flow node cannot say whatever a client sends:
//
//   - **A chain names a flow node of this board.** A chain onto a flow node of another board is a run that
//     would walk off the end of the one it is playing — each of a Gateway's branches alike.
//   - **A flow node's chain is read against its type.** A chain on a flow node that ends the board is a
//     thing no client can draw, and a Gateway's branches are the list beside the single flow node
//     rather than the flow node itself.
//   - **Only a task is written with a task's fields.** A description, an agent or a chat named on
//     a flow node that is a Shutdown or a Scheduler is dropped: those two describe no work, so there is
//     nothing of theirs for any of it to be filed on.
//   - **A flow node's agent is an agent of this store.** A flow node naming an id nothing holds is refused
//     here, where the message can name the flow node, rather than at its first play. Its runner is a
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
	// The type after the patch, since it is what the chain is read against — changing a flow node to
	// Shutdown takes its chain off in the same write rather than in the next one.
	flowNodeType := flowNode.Type
	if patch.Type != nil {
		flowNodeType = *patch.Type
	}
	if patch.MaxPasses != nil || patch.ResetPasses || (patch.Type != nil && flowNodeType != flowNode.Type &&
		(flowNodeType == entities.FlowNodeLimiter || flowNode.Type == entities.FlowNodeLimiter)) {
		if err := configureLimiter(flowNode, flowNodeType, &patch); err != nil {
			return nil, err
		}
		if expected == nil {
			expected = &flowNode.Revision
		}
	}
	if flowNodeType == entities.FlowNodeBitbucketPRStatus {
		if patch.PullRequestID != nil {
			id, err := entities.ReadPullRequestID(*patch.PullRequestID)
			if err != nil {
				return nil, err
			}
			patch.PullRequestID = &id
		}
		if patch.PullRequestStatus != nil {
			status, err := entities.ReadPullRequestStatus(*patch.PullRequestStatus)
			if err != nil {
				return nil, err
			}
			patch.PullRequestStatus = &status
		}
	} else if patch.Type != nil {
		empty := ""
		patch.PullRequestID, patch.PullRequestStatus = &empty, &empty
	} else {
		patch.PullRequestID, patch.PullRequestStatus = nil, nil
	}
	if flowNodeType == entities.FlowNodeBitbucketCommitStatus {
		if patch.CommitID != nil {
			id, err := entities.ReadCommitID(*patch.CommitID)
			if err != nil {
				return nil, err
			}
			patch.CommitID = &id
		}
		if patch.CommitStatus != nil {
			status, err := entities.ReadCommitStatus(*patch.CommitStatus)
			if err != nil {
				return nil, err
			}
			patch.CommitStatus = &status
		}
	} else if patch.Type != nil {
		empty := ""
		patch.CommitID, patch.CommitStatus = &empty, &empty
	} else {
		patch.CommitID, patch.CommitStatus = nil, nil
	}
	if patch.Next != nil && flowNodeType.Splits() {
		// The single successor is not asked of a Gateway: its branches are the list beside it.
		// Dropped like a task's fields on a flow node that is none — and the re-read below then clears
		// what a retyped flow node stored under its old kind.
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
		// Shutdown carrying a successor is a flow node that says two contradictory things.
		if next := entities.NextFor(flowNode.Next, flowNodeType); next != flowNode.Next {
			patch.Next = &next
		}
	}
	if patch.Nexts != nil {
		if !flowNodeType.Splits() {
			if patch.Type != nil && flowNode.Type.Splits() {
				// Retyped away with branches named: the stored ones go with the kind, and the
				// named ones are dropped — one flow node follows a flow node that is no Gateway.
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
	} else if patch.Type != nil && !flowNodeType.Splits() && len(flowNode.Nexts) > 0 {
		// Retyped away and the branches did not: they go with the kind, the way the single chain
		// goes off a flow node retyped to Shutdown.
		patch.Nexts = &[]string{}
	}
	if patch.Routes != nil {
		changed := *flowNode
		changed.Type = flowNodeType
		changed.Routes = *patch.Routes
		if patch.Nexts != nil {
			changed.Nexts = *patch.Nexts
		}
		if err := changed.ValidateRoutes(); err != nil {
			return nil, err
		}
	}
	if flowNodeType.IsDisplay() {
		patch.ScheduledAt, patch.Duration = nil, nil
		if patch.Type != nil && (flowNode.ScheduledAt != "" || flowNode.Duration != "") {
			empty := ""
			patch.ScheduledAt, patch.Duration = &empty, &empty
		}
		if flowNodeType == entities.FlowNodeRole {
			patch = patch.WithoutDisplay()
		}
		if patch.Value != nil {
			parsed, err := entities.ReadValueJSON(*patch.Value)
			if err != nil {
				return nil, err
			}
			patch.Value = &parsed
		}
		if patch.ValueType != nil {
			trimmed := strings.TrimSpace(*patch.ValueType)
			if entities.ReadValueType(trimmed) != trimmed {
				return nil, entities.Invalidf("value type %q is not \"json-schema\" or a value id", *patch.ValueType)
			}
			patch.ValueType = &trimmed
		}
		if flowNodeType == entities.FlowNodeNote {
			patch.Value, patch.ValueType = nil, nil
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
			if flowNodeType != entities.FlowNodeValue && flowNode.Value != "" && patch.Value == nil {
				empty := ""
				patch.Value = &empty
			}
			if flowNodeType != entities.FlowNodeValue && flowNode.ValueType != "" && patch.ValueType == nil {
				empty := ""
				patch.ValueType = &empty
			}
			if flowNodeType != entities.FlowNodeNote && flowNode.Note != "" && patch.Note == nil {
				empty := ""
				patch.Note = &empty
			}
			if flowNodeType == entities.FlowNodeNote && flowNode.Title != "" {
				empty := ""
				patch.Title = &empty
			}
		}
		effective := flowNode.ValueType
		if flowNode.Type != entities.FlowNodeValue {
			effective = ""
		}
		if patch.ValueType != nil {
			effective = *patch.ValueType
		}
		if flowNodeType == entities.FlowNodeValue {
			changed := *flowNode
			changed.Type, changed.ValueType = flowNodeType, effective
			if err := t.checkValueType(ctx, flowNode.BoardID, changed, nil); err != nil {
				return nil, err
			}
			if flowNode.IsSchemaValue() && effective != entities.ValueTypeJSONSchema {
				if err := t.checkNoValueTypeDependents(ctx, flowNode); err != nil {
					return nil, err
				}
			}
		} else if flowNode.IsSchemaValue() {
			if err := t.checkNoValueTypeDependents(ctx, flowNode); err != nil {
				return nil, err
			}
		}
	} else {
		patch = patch.WithoutDisplay()
		if patch.Type != nil && (flowNode.Note != "" || flowNode.Value != "" || flowNode.ValueType != "") {
			if flowNode.IsSchemaValue() {
				if err := t.checkNoValueTypeDependents(ctx, flowNode); err != nil {
					return nil, err
				}
			}
			empty := ""
			if flowNode.Note != "" {
				patch.Note = &empty
			}
			if flowNode.Value != "" {
				patch.Value = &empty
			}
			if flowNode.ValueType != "" {
				patch.ValueType = &empty
			}
		}
	}
	if flowNodeType == entities.FlowNodeRole {
		if patch.RoleID != nil {
			id, err := entities.ReadRoleID(*patch.RoleID)
			if err != nil {
				return nil, err
			}
			patch.RoleID = &id
		}
		if patch.RoleKind != nil {
			kind, err := entities.ReadRoleKind(*patch.RoleKind)
			if err != nil {
				return nil, err
			}
			patch.RoleKind = &kind
		} else if flowNode.Type != entities.FlowNodeRole {
			kind := entities.RoleKindHuman
			patch.RoleKind = &kind
		}
		if patch.People != nil {
			people, err := entities.ReadRolePeople(*patch.People)
			if err != nil {
				return nil, err
			}
			patch.People = &people
		}
		if patch.Description != nil {
			description := strings.TrimSpace(*patch.Description)
			patch.Description = &description
		}
	} else {
		patch.RoleID, patch.RoleKind, patch.People, patch.Description = nil, nil, nil, nil
		if patch.Type != nil && flowNode.Type == entities.FlowNodeRole {
			empty, people := "", []string{}
			var kind entities.RoleKind
			patch.RoleID, patch.RoleKind, patch.People, patch.Description = &empty, &kind, &people, &empty
		}
	}
	if patch.OutputType != nil || patch.Type != nil {
		changed := *flowNode
		changed.Type = flowNodeType
		if patch.OutputType != nil {
			changed.OutputType = strings.TrimSpace(*patch.OutputType)
		}
		if err := t.checkOutputType(ctx, &changed, nil); err != nil {
			return nil, err
		}
		patch.ClearOutput = changed.OutputType != flowNode.OutputType || changed.Type != flowNode.Type
		patch.OutputType = &changed.OutputType
	}
	if patch.Output != nil {
		if flowNodeType != entities.FlowNodeHuman {
			return nil, entities.Invalidf("output is written by a human task")
		}
		parsed, err := entities.ReadValueJSON(*patch.Output)
		if err != nil {
			return nil, err
		}
		patch.Output = &parsed
		patch.ClearOutput = false
	}
	// The task's fields, read against the type the flow node will have. A flow node that is not a task after
	// this patch is written without them, and one that becomes a task has a task made for it by the
	// store — empty where the patch named nothing, which is a flow node somebody has yet to describe.
	if !flowNodeType.IsTask() {
		patch = patch.WithoutTask()
	} else if patch.Transition != nil {
		transition := patch.Transition.For(flowNodeType)
		patch.Transition = &transition
	} else if patch.Type != nil && flowNode.Task != nil {
		// The type changed and the transition did not: a flow node retyped from AI to Human is answering
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
		// Everything the patch asked for was a task's, on a flow node that is not one.
		return nil, entities.Invalidf("the patch changes nothing this flow node has")
	}
	// The agent last, and only where the settings survived the type: a Shutdown sent an agent id
	// nothing holds should be told its settings were dropped, not told the agent is missing.
	if patch.Settings != nil {
		if flowNode.Task != nil && patch.Settings.Agent == flowNode.Task.Settings.Agent &&
			patch.Settings.Harness == "" && patch.Settings.ProfileID == "" {
			// Clients that predate the matrix still write a whole settings object.
			previous := flowNode.Task.Settings
			patch.Settings.Harness, patch.Settings.ProfileID = previous.Harness, previous.ProfileID
			if previous.Harness != "" && patch.Settings.Model == "" {
				patch.Settings.Model = previous.Model
			}
		}
		if flowNode.Task == nil || patch.Settings.Selection() != flowNode.Task.Settings.Selection() {
			if err := t.agentOf(ctx, *patch.Settings); err != nil {
				return nil, err
			}
		}
		if err := t.runnerOf(ctx, *patch.Settings); err != nil {
			return nil, err
		}
	}
	// The workflow it names is one of this board — or the empty string, which takes the flow node
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

// Chain links a flow node to the one played after it, or takes the link off with an empty target. Naming
// a flow node is the only thing that chains two of them.
//
// A Gateway is chained one branch at a time: the target is **added** to its branches — a chain
// drawn on the board is one more branch, not a branch redrawn — and an empty target takes them all
// off. Naming a branch it already holds is answered as it stands, with no write.
//
// The transition is left exactly where it was, chain or no chain. It says what becomes of this
// flow node's own conversation, which is the panel's question and not the line's: a flow node that ends its
// chat still ends it with a successor named, and a chain redrawn to another flow node hands on what it
// was handing on.
func (t *FlowNodes) Chain(ctx context.Context, fromID, toID string, actor string) (*entities.FlowNode, error) {
	flowNode, err := t.repo.FindFlowNode(ctx, fromID)
	if err != nil {
		return nil, err
	}
	if toID != "" {
		if toID == fromID {
			return nil, entities.Invalidf("a flow node cannot be chained to itself")
		}
		if err := t.sameBoard(ctx, flowNode.BoardID, toID); err != nil {
			return nil, err
		}
	}
	if flowNode.Type.Splits() {
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

// Delete removes flow nodes. Chains onto them are broken by the schema rather than here, so a flow node
// removed by hand in SQL leaves no chain pointing at nothing either. A workflow left with no
// members goes with them: a rectangle with nothing in it is a shape nobody can pick up again,
// so the store does not keep it.
func (t *FlowNodes) Delete(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no flow node to delete")
	}
	// The workflows the going flow nodes are grouped in, by board: emptiness is read off the board
	// afterwards, so a workflow with members left behind is kept. An id naming no flow node is passed
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
// What a run does to a flow node is exactly two writes, and they are here rather than in the runner so
// that the rules hold whoever plays it — the service's own loop, a runner in another process, a
// person pressing Play twice.

// StartPlay takes the flow node for a run.
//
// The database grants a free claim on ready and done flow nodes and on interrupted AI tasks.
// Two runs reaching for the same flow node get one winner and one ErrFlowNodeHeld.
func (t *FlowNodes) StartPlay(ctx context.Context, flowNodeID, runID string, actor string, afterPredecessor ...bool) (*entities.FlowNode, error) {
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
	if flowNode.Type == entities.FlowNodeLimiter {
		return nil, entities.Invalidf("a limiter is played through its pass operation")
	}
	return t.repo.ClaimFlowNode(ctx, flowNodeID, runID, entities.StatusRunning, actor, afterPredecessor...)
}

// EndPlay hands the flow node back with the status the play ended on. The run must still hold the flow node:
// a run that was stopped and whose turn came back late may not mark a flow node somebody else is now
// playing.
//
// The description is left exactly where it is, whatever the ending: what the turn said is in the
// conversation the flow node names, and the flow node still asks what it was asking.
func (t *FlowNodes) EndPlay(ctx context.Context, flowNodeID, runID, actor string, result entities.PlayResult) (*entities.FlowNode, error) {
	if runID == "" {
		return nil, entities.Invalidf("a completion names its run")
	}
	if result.Status != entities.StatusDone {
		if result.Workflow != nil {
			return nil, entities.Invalidf("workflow values can only be updated by a successful play")
		}
		result.Output = ""
	}
	if result.Output != "" {
		var err error
		result.Output, err = entities.ReadValueJSON(result.Output)
		if err != nil {
			return nil, err
		}
	}
	if result.Workflow != nil {
		if err := result.Workflow.Validate(); err != nil {
			return nil, err
		}
	}
	return t.repo.ReleaseFlowNode(ctx, flowNodeID, runID, actor, result)
}

// SettleRun clears every flow node a run still holds. What a restart calls: the only thing that would
// have marked those flow nodes died with the process that was playing them, so they would say `running`
// for ever.
func (t *FlowNodes) SettleRun(ctx context.Context, runID string, actor string) (int, error) {
	return t.repo.ReleaseRun(ctx, runID, entities.StatusInterrupted, actor)
}

// Next is the flow node played after this one, or nil when the chain ends here. It is the run's own
// question, asked of the board rather than of a copy the run has been carrying: the flow node may have
// been re-chained, retyped or deleted while the turn ran. An archived successor ends the chain
// too: its link is hidden everywhere and playing through it would surface a hidden flow node.
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

func (t *FlowNodes) checkValueType(ctx context.Context, boardID string, node entities.FlowNode, batch []entities.FlowNode) error {
	ref := node.ValueType
	if node.Type != entities.FlowNodeValue || ref == "" || ref == entities.ValueTypeJSONSchema {
		return nil
	}
	if ref == node.ID {
		return entities.Invalidf("a value cannot type itself")
	}
	var target *entities.FlowNode
	for i := range batch {
		if batch[i].ID == ref {
			target = &batch[i]
			break
		}
	}
	if target == nil {
		found, err := t.repo.FindFlowNode(ctx, ref)
		if err != nil {
			return err
		}
		target = found
	}
	if target.BoardID != boardID {
		return entities.Invalidf("value type %s is on another board", ref)
	}
	if !target.IsSchemaValue() {
		return entities.Invalidf("value type %s is not a value typed as JSON Schema", ref)
	}
	return nil
}

func (t *FlowNodes) checkNoValueTypeDependents(ctx context.Context, node *entities.FlowNode) error {
	used, err := t.repo.OutputTypeUsed(ctx, node.ID)
	if err != nil {
		return err
	}
	if used {
		return entities.Invalidf("value %q types task outputs", node.Title)
	}

	nodes, err := t.repo.ListFlowNodes(ctx, node.BoardID)
	if err != nil {
		return err
	}
	for _, other := range nodes {
		if other.ID != node.ID && other.Type == entities.FlowNodeValue && other.ValueType == node.ID {
			return entities.Invalidf("value %q types other values", node.Title)
		}
	}
	return nil
}

// sameBoard refuses a chain onto a flow node that is not on this board.
func (t *FlowNodes) sameBoard(ctx context.Context, boardID, flowNodeID string) error {
	target, err := t.repo.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return err
	}
	if target.BoardID != boardID {
		return entities.Invalidf("flow node %s is on another board", flowNodeID)
	}
	return nil
}

// agentOf checks that the agent a flow node's settings name is an agent of this store — or is empty,
// which is a flow node that names none and is simply not played. A flow node written before managed agents,
// naming a harness rather than an id, reads that way too until its settings are next written: the
// reads stay forgiving, and the writes are what narrow.
func (t *FlowNodes) agentOf(ctx context.Context, settings entities.TaskSettings) error {
	return checkAgentSelection(ctx, t.agents, settings.Selection())
}

func checkAgentSelection(ctx context.Context, agents ports.AgentLookup, selection entities.AgentSelection) error {
	if selection.Harness != "" {
		if harness, ok := entities.ReadHarness(selection.Harness); !ok || string(harness) != selection.Harness {
			return entities.Invalidf("unknown harness %q", selection.Harness)
		}
	}
	if selection.ProfileID != "" && selection.Harness != string(entities.HarnessPi) {
		return entities.Invalidf("a profile requires the Pi harness")
	}
	if selection.Model != "" && selection.Harness == "" {
		return entities.Invalidf("select a harness for the model")
	}
	if selection.Agent == "" {
		if selection.Harness != "" {
			return entities.Invalidf("select an agent for the harness")
		}
		return nil
	}
	if _, err := agents.FindAgent(ctx, selection.Agent); err != nil {
		if !errors.Is(err, entities.ErrNotFound) {
			return err
		}
		return entities.NotFoundf("agent %s", selection.Agent)
	}
	return nil
}

// runnerOf checks that the runner a flow node's settings name is a runner of this store — or is empty,
// which is a flow node pinned nowhere and played wherever a Play is pressed.
func (t *FlowNodes) runnerOf(ctx context.Context, settings entities.TaskSettings) error {
	if settings.Runner == "" {
		return nil
	}
	if _, err := t.runners.FindRunner(ctx, settings.Runner); err != nil {
		return entities.NotFoundf("runner %s", settings.Runner)
	}
	return nil
}

func (t *FlowNodes) SchemaValues(ctx context.Context) ([]entities.SchemaValue, error) {
	return t.repo.ListSchemaValues(ctx)
}

func (t *FlowNodes) SchemaValue(ctx context.Context, id string) (*entities.FlowNode, error) {
	node, err := t.repo.FindFlowNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if !node.IsSchemaValue() {
		return nil, entities.Invalidf("output type %s is not a value typed as JSON Schema", id)
	}
	return node, nil
}

func (t *FlowNodes) checkOutputType(ctx context.Context, node *entities.FlowNode, batch []entities.FlowNode) error {
	if !node.Type.IsTask() {
		node.OutputType = ""
		return nil
	}
	if node.OutputType == "" {
		return nil
	}
	if !entities.ValidID(node.OutputType) {
		return entities.Invalidf("output type must name a JSON Schema value")
	}
	for _, candidate := range batch {
		if candidate.ID == node.OutputType {
			if !candidate.IsSchemaValue() {
				return entities.Invalidf("output type must name a JSON Schema value")
			}
			return nil
		}
	}
	_, err := t.SchemaValue(ctx, node.OutputType)
	return err
}
