package services

import (
	"context"
	"errors"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// FlowNodeClasses is the node-class half of the core: what a class is made with, what may change
// about it, the versions beneath it, and the two calls that move work between classes and cards —
// converting a task into a class, and instantiating a class into flow nodes.
type FlowNodeClasses struct {
	repo      ports.ClassRepository
	boards    ports.BoardRepository
	agents    ports.AgentRepository
	runners   ports.RunnerRepository
	workflows ports.WorkflowRepository
	clock     ports.Clock
	ids       ports.IDs
}

func NewFlowNodeClasses(repo ports.ClassRepository, boards ports.BoardRepository, agents ports.AgentRepository, runners ports.RunnerRepository, workflows ports.WorkflowRepository, clock ports.Clock, ids ports.IDs) *FlowNodeClasses {
	return &FlowNodeClasses{repo: repo, boards: boards, agents: agents, runners: runners, workflows: workflows, clock: clock, ids: ids}
}

// ClassWithVersions is one class and its succession, oldest first: what the board draws and what
// the class editor's version select lists.
type ClassWithVersions struct {
	Class    entities.FlowNodeClass
	Versions []entities.FlowNodeClassVersion
}

// NewClassRequest is one class to be made, with the first version's words beside it.
type NewClassRequest struct {
	// ID is the identity the client minted, or empty to have one minted here — the same rule a
	// card's id follows.
	ID    string
	Title string
	// Instantiable is whether the class is offered in the Instantiate menu. Off unless
	// ticked at creation.
	Instantiable bool
	// Type is what kind of class it is; empty is read off the AI answers, the way a card saying
	// no type is read.
	Type        string
	Tags        []string
	ScheduledAt string
	Duration    string
	Spot        *entities.Spot
	// Next is the class after this one, on the same board.
	Next       string
	Permission string
	Runner     string
	Transition entities.Transition
	// Body and Criteria are the first version's words. Empty is an empty first draft.
	Body     string
	Criteria []entities.SuccessCriterion
	// IsTemplate says the first version's body is a template to fill in on instantiation.
	IsTemplate bool
	// Agent is the first version's default agent: the managed agent an instance made from it
	// is played by at first. Asked of an AI class's versions and of no other kind.
	Agent string
	// Published freezes the first version at creation, which is what a class converted from a
	// written task says: its words are already what instances should be asked.
	Published bool
	// Note is the class's own words beside the reusable card. Asked of every kind of class.
	Note string
	// WorkflowClass is the workflow class the class is grouped in — one of this board — or
	// empty for none. What a class made inside a rectangle says.
	WorkflowClass string
}

// Create files a class on a board, with its first version beneath it. A class always has at
// least one version — a class with nothing under it is one the editor could show no words for
// and one nothing could be instantiated from.
func (c *FlowNodeClasses) Create(ctx context.Context, boardID string, req NewClassRequest, actor string) (ClassWithVersions, error) {
	if _, err := c.boards.FindBoard(ctx, boardID); err != nil {
		return ClassWithVersions{}, err
	}
	return c.createOn(ctx, boardID, req, actor)
}

func (c *FlowNodeClasses) createOn(ctx context.Context, boardID string, req NewClassRequest, actor string) (ClassWithVersions, error) {
	if err := CheckWorkflowClass(ctx, c.workflows, boardID, req.WorkflowClass); err != nil {
		return ClassWithVersions{}, err
	}
	flowNodeType := entities.ReadFlowNodeType(req.Type, entities.TaskSettings{Permission: req.Permission})
	if flowNodeType == entities.FlowNodeGateway {
		return ClassWithVersions{}, entities.Invalidf("a gateway is no class: it holds no words to reuse")
	}
	// Only where the answers survive the type: a Human class sent a runner id nothing holds
	// is told nothing, because it was never asked for one.
	if flowNodeType.ForAgent() {
		if err := c.runnerNamed(ctx, req.Runner); err != nil {
			return ClassWithVersions{}, err
		}
		if err := c.agentNamed(ctx, req.Agent); err != nil {
			return ClassWithVersions{}, err
		}
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = c.ids.NewID()
	} else if !entities.ValidID(id) {
		return ClassWithVersions{}, entities.Invalidf("%q is not an id this store can hold", req.ID)
	}
	if err := entities.ValidateSchedule(req.ScheduledAt, req.Duration); err != nil {
		return ClassWithVersions{}, err
	}
	now := c.clock.Now()
	class := &entities.FlowNodeClass{
		ID: id, BoardID: boardID,
		Title: strings.TrimSpace(req.Title), Instantiable: req.Instantiable,
		Type: flowNodeType, Tags: entities.ReadTags(req.Tags),
		ScheduledAt:     entities.ReadSchedule(req.ScheduledAt),
		Duration:        entities.ReadDuration(req.Duration),
		Spot:            req.Spot,
		Next:            entities.NextFor(req.Next, flowNodeType),
		Note:            req.Note,
		WorkflowClassID: strings.TrimSpace(req.WorkflowClass),
		CreatedAt:       now, UpdatedAt: now, Revision: 1,
	}
	if flowNodeType.ForAgent() {
		class.Permission = strings.TrimSpace(req.Permission)
		class.Runner = strings.TrimSpace(req.Runner)
		class.Transition = req.Transition.For(flowNodeType)
	} else {
		class.Transition = entities.Transition{Mode: entities.TransitionModeDefault}
	}
	if class.Next != "" {
		if err := c.sameBoard(ctx, boardID, class.Next); err != nil {
			return ClassWithVersions{}, err
		}
	}
	if err := c.repo.CreateClass(ctx, class, actor); err != nil {
		return ClassWithVersions{}, err
	}
	version := &entities.FlowNodeClassVersion{
		ID: c.ids.NewID(), ClassID: class.ID, Number: 1,
		Body: req.Body, Criteria: withCriterionIDs(req.Criteria, c.ids.NewID),
		IsTemplate: req.IsTemplate,
		Status:     entities.ClassVersionDraft,
		CreatedAt:  now, UpdatedAt: now, Revision: 1,
	}
	if flowNodeType.ForAgent() {
		version.Agent = strings.TrimSpace(req.Agent)
	}
	if req.Published {
		version.Status = entities.ClassVersionPublished
	}
	if err := c.repo.CreateVersion(ctx, version, actor); err != nil {
		return ClassWithVersions{}, err
	}
	return ClassWithVersions{Class: *class, Versions: []entities.FlowNodeClassVersion{*version}}, nil
}

// Board is every class of a board with its versions: the classes beside the board's cards.
func (c *FlowNodeClasses) Board(ctx context.Context, boardID string) ([]ClassWithVersions, error) {
	classes, err := c.repo.ListClasses(ctx, boardID)
	if err != nil {
		return nil, err
	}
	out := make([]ClassWithVersions, 0, len(classes))
	for _, class := range classes {
		versions, err := c.repo.ListVersions(ctx, class.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, ClassWithVersions{Class: class, Versions: versions})
	}
	return out, nil
}

// ListedClass is one class for the instantiate menu: the class, its succession, and the board it
// is filed on.
type ListedClass struct {
	Class    entities.FlowNodeClass
	Versions []entities.FlowNodeClassVersion
	// BoardSlug and BoardName name the board the class is filed on: the menu groups by them.
	BoardSlug string
	BoardName string
}

// All is every class of every board with its versions and its board's name: what the instantiate
// menu lists.
func (c *FlowNodeClasses) All(ctx context.Context) ([]ListedClass, error) {
	classes, err := c.repo.ListAllClasses(ctx)
	if err != nil {
		return nil, err
	}
	boards, err := c.boards.ListBoards(ctx, ports.BoardFilter{IncludeArchived: true})
	if err != nil {
		return nil, err
	}
	named := map[string]entities.Board{}
	for _, board := range boards {
		named[board.ID] = board
	}
	out := make([]ListedClass, 0, len(classes))
	for _, class := range classes {
		versions, err := c.repo.ListVersions(ctx, class.ID)
		if err != nil {
			return nil, err
		}
		listed := ListedClass{Class: class, Versions: versions}
		if board, ok := named[class.BoardID]; ok {
			listed.BoardSlug, listed.BoardName = board.Slug, board.Name
		}
		out = append(out, listed)
	}
	return out, nil
}

// Find is one class with its versions.
func (c *FlowNodeClasses) Find(ctx context.Context, id string) (ClassWithVersions, error) {
	class, err := c.repo.FindClass(ctx, id)
	if err != nil {
		return ClassWithVersions{}, err
	}
	versions, err := c.repo.ListVersions(ctx, id)
	if err != nil {
		return ClassWithVersions{}, err
	}
	return ClassWithVersions{Class: *class, Versions: versions}, nil
}

// FindVersion is one version.
func (c *FlowNodeClasses) FindVersion(ctx context.Context, id string) (*entities.FlowNodeClassVersion, error) {
	return c.repo.FindVersion(ctx, id)
}

// Versions is every version of one class, oldest first.
func (c *FlowNodeClasses) Versions(ctx context.Context, classID string) ([]entities.FlowNodeClassVersion, error) {
	return c.repo.ListVersions(ctx, classID)
}

// Patch changes the fields the patch names. What it enforces before writing is the three things
// a class cannot say whatever a client sends:
//
//   - **A chain names a class of this board.** A chain onto a class of another board is an
//     instantiation that would walk off the end of the one it started from — and a chain onto a
//     simple flow node is refused by the lookup, which reads classes and nothing else.
//   - **Only an AI class is written with the AI answers.** A permission, a runner or a transition
//     named on a class that is not AI is dropped, the way a card that is no task is written
//     without its task's fields.
//   - **A class's runner is a runner of this store**, or empty for wherever a Play is pressed.
func (c *FlowNodeClasses) Patch(ctx context.Context, id string, patch entities.FlowNodeClassPatch, expected *int64, actor string) (*entities.FlowNodeClass, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	class, err := c.repo.FindClass(ctx, id)
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
	flowNodeType := class.Type
	if patch.Type != nil {
		flowNodeType = *patch.Type
		if flowNodeType == entities.FlowNodeGateway {
			return nil, entities.Invalidf("a gateway is no class: it holds no words to reuse")
		}
	}
	if patch.Next != nil {
		next := entities.NextFor(*patch.Next, flowNodeType)
		if next != "" {
			if err := c.sameBoard(ctx, class.BoardID, next); err != nil {
				return nil, err
			}
		}
		patch.Next = &next
	} else if patch.Type != nil {
		if next := entities.NextFor(class.Next, flowNodeType); next != class.Next {
			patch.Next = &next
		}
	}
	if !flowNodeType.ForAgent() {
		patch = patch.WithoutAI()
		// The type changed and the answers did not: a class retyped away from AI stops saying
		// them in the same write rather than in the next one.
		if patch.Type != nil && (class.Permission != "" || class.Runner != "" ||
			class.Transition.Mode != entities.TransitionModeDefault || class.Transition.Compact) {
			empty, runner, transition := "", "", entities.Transition{Mode: entities.TransitionModeDefault}
			patch.Permission, patch.Runner, patch.Transition = &empty, &runner, &transition
		}
	} else if patch.Transition != nil {
		transition := patch.Transition.For(flowNodeType)
		patch.Transition = &transition
	}
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing this class has")
	}
	if patch.Runner != nil {
		if err := c.runnerNamed(ctx, *patch.Runner); err != nil {
			return nil, err
		}
	}
	// The workflow class it names is one of this board — or the empty string, which takes the
	// class out of whichever rectangle it was in.
	if patch.WorkflowClassID != nil && *patch.WorkflowClassID != "" {
		if err := CheckWorkflowClass(ctx, c.workflows, class.BoardID, *patch.WorkflowClassID); err != nil {
			return nil, err
		}
	}
	return c.repo.PatchClass(ctx, id, patch, expected, actor)
}

// Chain links a class to the one after it, or takes the link off with an empty target. Naming a
// class is the only thing that chains two of them; the transition is left where it was, chain or
// no chain, because it says what becomes of this class's own instances' chat.
func (c *FlowNodeClasses) Chain(ctx context.Context, fromID, toID string, actor string) (*entities.FlowNodeClass, error) {
	class, err := c.repo.FindClass(ctx, fromID)
	if err != nil {
		return nil, err
	}
	if toID != "" {
		if toID == fromID {
			return nil, entities.Invalidf("a class cannot be chained to itself")
		}
		if err := c.sameBoard(ctx, class.BoardID, toID); err != nil {
			return nil, err
		}
	}
	next := entities.NextFor(toID, class.Type)
	return c.repo.PatchClass(ctx, fromID, entities.FlowNodeClassPatch{Next: &next}, nil, actor)
}

// Delete removes classes and their versions. The flow nodes instantiated from them are left as
// they are, their link broken: they still say what they were asked. A workflow class left with
// no members goes with them, like a workflow with its cards.
func (c *FlowNodeClasses) Delete(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no class to delete")
	}
	// The workflow classes the going classes are grouped in, by board: emptiness is read off
	// the board afterwards, so one with members left behind is kept.
	type membership struct{ board, workflow string }
	held := map[string]membership{}
	for _, id := range ids {
		class, err := c.repo.FindClass(ctx, id)
		if err != nil {
			continue
		}
		if class.WorkflowClassID != "" {
			held[class.WorkflowClassID] = membership{class.BoardID, class.WorkflowClassID}
		}
	}
	if err := c.repo.DeleteClasses(ctx, ids, actor); err != nil {
		return err
	}
	for _, member := range held {
		kept, err := c.repo.ListClasses(ctx, member.board)
		if err != nil {
			return err
		}
		empty := true
		for _, class := range kept {
			if class.WorkflowClassID == member.workflow {
				empty = false
				break
			}
		}
		if empty {
			if err := c.workflows.DeleteWorkflowClasses(ctx, []string{member.workflow}, actor); err != nil &&
				!errors.Is(err, entities.ErrNotFound) {
				return err
			}
		}
	}
	return nil
}

// NewVersionRequest is one version to be filed under its class.
type NewVersionRequest struct {
	Body     string
	Criteria []entities.SuccessCriterion
	// IsTemplate says the body's words are a template to fill in on instantiation. A version
	// copied from another starts as its source said, unless this says otherwise.
	IsTemplate *bool
	// Agent is the default agent: the managed agent an instance made from this version is
	// played by at first. A version copied from another starts as its source said, unless this
	// names one. Asked of an AI class's versions and of no other kind.
	Agent string
	// From names a version to copy the words from — the usual way a second version starts: what
	// the last one said, edited. Empty is a blank draft.
	From string
}

// CreateVersion files the next version under its class: one more than the succession holds, and
// a draft — a new version is written before it is published.
func (c *FlowNodeClasses) CreateVersion(ctx context.Context, classID string, req NewVersionRequest, actor string) (*entities.FlowNodeClassVersion, error) {
	class, err := c.repo.FindClass(ctx, classID)
	if err != nil {
		return nil, err
	}
	body, criteria := req.Body, req.Criteria
	isTemplate := false
	agent := strings.TrimSpace(req.Agent)
	if req.From != "" {
		from, err := c.repo.FindVersion(ctx, req.From)
		if err != nil {
			return nil, err
		}
		if from.ClassID != class.ID {
			return nil, entities.Invalidf("version %s is not a version of this class", req.From)
		}
		if body == "" {
			body = from.Body
		}
		if len(criteria) == 0 {
			criteria = from.Criteria
		}
		isTemplate = from.IsTemplate
		if agent == "" {
			agent = from.Agent
		}
	}
	if req.IsTemplate != nil {
		isTemplate = *req.IsTemplate
	}
	// Only where the answer survives the type: a Human class is never asked for one.
	if !class.Type.ForAgent() {
		agent = ""
	} else if err := c.agentNamed(ctx, agent); err != nil {
		return nil, err
	}
	held, err := c.repo.ListVersions(ctx, class.ID)
	if err != nil {
		return nil, err
	}
	number := 1
	for _, version := range held {
		if version.Number >= number {
			number = version.Number + 1
		}
	}
	now := c.clock.Now()
	version := &entities.FlowNodeClassVersion{
		ID: c.ids.NewID(), ClassID: class.ID, Number: number,
		Body: body, Criteria: withCriterionIDs(criteria, c.ids.NewID),
		IsTemplate: isTemplate,
		Agent:      agent,
		Status:     entities.ClassVersionDraft,
		CreatedAt:  now, UpdatedAt: now, Revision: 1,
	}
	if err := c.repo.CreateVersion(ctx, version, actor); err != nil {
		return nil, err
	}
	return version, nil
}

// PatchVersion changes what a draft says, its default agent, or publishes it. A published
// version is refused whatever a client sends — what it says is what stays said — and publishing
// is one way: a published version is never drafted again, because the flow nodes made from it
// keep meaning what they meant.
//
// A default agent named on a version of a class that is not AI is dropped rather than refused,
// the way a class that is no AI one is written without its AI answers. Where nothing is left to
// write, the patch changes nothing.
func (c *FlowNodeClasses) PatchVersion(ctx context.Context, id string, patch entities.FlowNodeClassVersionPatch, expected *int64, actor string) (*entities.FlowNodeClassVersion, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	version, err := c.repo.FindVersion(ctx, id)
	if err != nil {
		return nil, err
	}
	if version.Status.Published() {
		return nil, entities.Invalidf("version %d is published and cannot be changed", version.Number)
	}
	if patch.Agent != nil {
		class, err := c.repo.FindClass(ctx, version.ClassID)
		if err != nil {
			return nil, err
		}
		if !class.Type.ForAgent() {
			patch.Agent = nil
		} else {
			agent := strings.TrimSpace(*patch.Agent)
			patch.Agent = &agent
			if err := c.agentNamed(ctx, agent); err != nil {
				return nil, err
			}
		}
		if patch.Empty() {
			return nil, entities.Invalidf("the patch changes nothing this version has")
		}
	}
	if patch.Status != nil && !patch.Status.Published() {
		// Drafting a draft: nothing to say, so nothing is written for it.
		patch.Status = nil
		if patch.Empty() {
			return nil, entities.Invalidf("the patch changes nothing")
		}
	}
	if patch.Criteria != nil {
		minted := withCriterionIDs(*patch.Criteria, c.ids.NewID)
		patch.Criteria = &minted
	}
	return c.repo.PatchVersion(ctx, id, patch, expected, actor)
}

// DeleteVersion removes a draft: a new version somebody changed their mind about. A published
// version is refused — past versions are kept for statistics, and the flow nodes made from one
// keep meaning what they meant.
func (c *FlowNodeClasses) DeleteVersion(ctx context.Context, id string, actor string) error {
	version, err := c.repo.FindVersion(ctx, id)
	if err != nil {
		return err
	}
	if version.Status.Published() {
		return entities.Invalidf("version %d is published and cannot be deleted", version.Number)
	}
	return c.repo.DeleteVersion(ctx, id, actor)
}

// Instantiate makes flow nodes from a class and all its successors: the class named, then
// whatever that class names, until nothing is named, a class that has gone, or a class already
// instantiated — a chain that comes back round ends there rather than instantiating twice.
//
// Each flow node is made from the latest version of its class that is not a draft. A class with
// no published version refuses the whole call: a partial instantiation would be a chain with a
// card missing from its middle.
//
// What each flow node says is its class's and its version's: the title, the kind, the tags, the
// Scheduler's preset, the permission mode, the runner and the transition from the class; the
// description, the success criteria and the default agent from the version — or from `bodies`,
// where the caller names the class: the instantiated template, filled in by whoever asked for
// the instantiation rather than copied from the version. A body named for a class that is not
// instantiated is passed over. The effort and the folder stay empty — they are the instance's
// answers, and an instantiated flow node is not played until somebody picks them. The head is
// placed at spot; the rest arrive unplaced, and the view lays them out.
func (c *FlowNodeClasses) Instantiate(ctx context.Context, classID, targetBoardID string, spot *entities.Spot, bodies map[string]string, actor string) ([]entities.FlowNode, error) {
	board, err := c.boards.FindBoard(ctx, targetBoardID)
	if err != nil {
		return nil, err
	}
	chain, err := c.chain(ctx, classID)
	if err != nil {
		return nil, err
	}
	now := c.clock.Now()
	flowNodes := make([]*entities.FlowNode, 0, len(chain))
	made := map[string]string{}
	for _, step := range chain {
		version, err := c.latestPublished(ctx, step.Class.ID)
		if err != nil {
			return nil, err
		}
		id := c.ids.NewID()
		made[step.Class.ID] = id
		flowNode := &entities.FlowNode{
			ID: id, BoardID: board.ID,
			Title: step.Class.Title, Type: step.Class.Type, Tags: append([]string(nil), step.Class.Tags...),
			ScheduledAt:    step.Class.ScheduledAt,
			Duration:       step.Class.Duration,
			Status:         entities.StatusReady,
			ClassVersionID: version.ID,
			CreatedAt:      now, UpdatedAt: now, Revision: 1,
		}
		if step.Class.Type.IsTask() {
			body := version.Body
			if instantiated, ok := bodies[step.Class.ID]; ok {
				body = instantiated
			}
			agent := ""
			if step.Class.Type.ForAgent() {
				agent = version.Agent
			}
			task := entities.Task{
				Body:     body,
				Criteria: append([]entities.SuccessCriterion(nil), version.Criteria...),
				Settings: entities.TaskSettings{
					Agent: agent, Permission: step.Class.Permission, Runner: step.Class.Runner,
				},
				Transition: step.Class.Transition,
			}.For(step.Class.Type)
			flowNode.Task = &task
		}
		if len(flowNodes) == 0 {
			flowNode.Spot = spot
		}
		flowNodes = append(flowNodes, flowNode)
	}
	// The links recreated, reproducing those between the classes: each flow node hands on to
	// the instance of the class its class named.
	for i, flowNode := range flowNodes {
		if next, ok := made[chain[i].Class.Next]; ok {
			flowNode.Next = next
		}
	}
	if err := c.boards.CreateFlowNodes(ctx, flowNodes, actor); err != nil {
		return nil, err
	}
	out := make([]entities.FlowNode, 0, len(flowNodes))
	for _, flowNode := range flowNodes {
		found, err := c.boards.FindFlowNode(ctx, flowNode.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, *found)
	}
	return out, nil
}

// InstantiateWorkflow makes a workflow from a workflow class: one flow node per member
// class, grouped in a workflow named as the rectangle was, on the board the handle names —
// which may be another board than the workflow class's own.
//
// Members only: a chain onto a class outside the rectangle is not followed, and the link is
// left off the instance. Each flow node is made from the latest version of its class that is
// not a draft — a member with no published version refuses the whole call, like Instantiate —
// and `bodies` names the instantiated templates the same way. The head is placed at spot;
// the rest arrive unplaced, and the view lays them out.
func (c *FlowNodeClasses) InstantiateWorkflow(ctx context.Context, workflowClassID, targetBoardID string, spot *entities.Spot, bodies map[string]string, actor string) (entities.Workflow, []entities.FlowNode, error) {
	board, err := c.boards.FindBoard(ctx, targetBoardID)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	class, err := c.workflows.FindWorkflowClass(ctx, workflowClassID)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	held, err := c.repo.ListClasses(ctx, class.BoardID)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	members := make([]entities.FlowNodeClass, 0)
	for _, one := range held {
		if one.WorkflowClassID == class.ID {
			members = append(members, one)
		}
	}
	if len(members) == 0 {
		return entities.Workflow{}, nil, entities.Invalidf("workflow class %q holds no classes", class.Name)
	}
	// Every member's version first: a member with nothing published refuses the whole call
	// before the workflow exists, so no empty rectangle is left behind.
	versions := make([]*entities.FlowNodeClassVersion, 0, len(members))
	for _, member := range members {
		version, err := c.latestPublished(ctx, member.ID)
		if err != nil {
			return entities.Workflow{}, nil, err
		}
		versions = append(versions, version)
	}
	now := c.clock.Now()
	workflow := entities.Workflow{
		ID: c.ids.NewID(), BoardID: board.ID, Name: class.Name,
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	if err := c.workflows.CreateWorkflow(ctx, &workflow, actor); err != nil {
		return entities.Workflow{}, nil, err
	}
	flowNodes := make([]*entities.FlowNode, 0, len(members))
	made := map[string]string{}
	for i, member := range members {
		version := versions[i]
		id := c.ids.NewID()
		made[member.ID] = id
		flowNode := &entities.FlowNode{
			ID: id, BoardID: board.ID,
			Title: member.Title, Type: member.Type, Tags: append([]string(nil), member.Tags...),
			ScheduledAt:    member.ScheduledAt,
			Duration:       member.Duration,
			Status:         entities.StatusReady,
			ClassVersionID: version.ID,
			WorkflowID:     workflow.ID,
			CreatedAt:      now, UpdatedAt: now, Revision: 1,
		}
		if member.Type.IsTask() {
			body := version.Body
			if instantiated, ok := bodies[member.ID]; ok {
				body = instantiated
			}
			agent := ""
			if member.Type.ForAgent() {
				agent = version.Agent
			}
			task := entities.Task{
				Body:     body,
				Criteria: append([]entities.SuccessCriterion(nil), version.Criteria...),
				Settings: entities.TaskSettings{
					Agent: agent, Permission: member.Permission, Runner: member.Runner,
				},
				Transition: member.Transition,
			}.For(member.Type)
			flowNode.Task = &task
		}
		if len(flowNodes) == 0 {
			flowNode.Spot = spot
		}
		flowNodes = append(flowNodes, flowNode)
	}
	// The links recreated where both ends were instantiated: a chain onto a class outside
	// the rectangle is left off rather than followed.
	for i, flowNode := range flowNodes {
		if next, ok := made[members[i].Next]; ok {
			flowNode.Next = next
		}
	}
	if err := c.boards.CreateFlowNodes(ctx, flowNodes, actor); err != nil {
		return entities.Workflow{}, nil, err
	}
	out := make([]entities.FlowNode, 0, len(flowNodes))
	for _, flowNode := range flowNodes {
		found, err := c.boards.FindFlowNode(ctx, flowNode.ID)
		if err != nil {
			return entities.Workflow{}, nil, err
		}
		out = append(out, *found)
	}
	return workflow, out, nil
}

// ConvertNode files a class from a task: the card's title, kind, tags, preset, permission,
// runner and transition become the class's, and its description, success criteria and agent
// become the first version's — published, because they are already what instances should be
// asked. The flow node itself is left alone: it is the instance the class was read off, not
// the class.
func (c *FlowNodeClasses) ConvertNode(ctx context.Context, flowNodeID string, actor string) (ClassWithVersions, error) {
	flowNode, err := c.boards.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return ClassWithVersions{}, err
	}
	if flowNode.Task == nil {
		return ClassWithVersions{}, entities.Invalidf("only a task can be converted into a class")
	}
	req := NewClassRequest{
		Title: flowNode.Title, Type: string(flowNode.Type), Tags: flowNode.Tags,
		ScheduledAt: flowNode.ScheduledAt,
		Duration:    flowNode.Duration, Spot: flowNode.Spot,
		Permission: flowNode.Task.Settings.Permission, Runner: flowNode.Task.Settings.Runner,
		Transition: flowNode.Task.Transition,
		Body:       flowNode.Task.Body, Criteria: flowNode.Task.Criteria,
		Agent:     flowNode.Task.Settings.Agent,
		Published: true,
	}
	return c.createOn(ctx, flowNode.BoardID, req, actor)
}

// chain is the classes an instantiation makes flow nodes from: the class named and its
// successors, ending where the chain does — nothing named, a class that has gone, or a class
// already in the chain.
func (c *FlowNodeClasses) chain(ctx context.Context, classID string) ([]ClassWithVersions, error) {
	out := []ClassWithVersions{}
	seen := map[string]bool{}
	for id := classID; id != ""; {
		if seen[id] {
			break
		}
		seen[id] = true
		class, err := c.repo.FindClass(ctx, id)
		if err != nil {
			break
		}
		versions, err := c.repo.ListVersions(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, ClassWithVersions{Class: *class, Versions: versions})
		id = class.Next
	}
	if len(out) == 0 {
		return nil, entities.NotFoundf("node class %s", classID)
	}
	return out, nil
}

// latestPublished is the version an instantiation makes a flow node from: the latest one that is
// not a draft. A class with none refuses the call, naming itself.
func (c *FlowNodeClasses) latestPublished(ctx context.Context, classID string) (*entities.FlowNodeClassVersion, error) {
	versions, err := c.repo.ListVersions(ctx, classID)
	if err != nil {
		return nil, err
	}
	var latest *entities.FlowNodeClassVersion
	for i := range versions {
		if versions[i].Status.Published() && (latest == nil || versions[i].Number > latest.Number) {
			latest = &versions[i]
		}
	}
	if latest == nil {
		class, err := c.repo.FindClass(ctx, classID)
		title := classID
		if err == nil {
			title = class.Title
		}
		return nil, entities.Invalidf("node class %q has no published version", title)
	}
	return latest, nil
}

// sameBoard refuses a chain onto a class that is not on this board. A simple flow node is
// refused by the lookup, which reads classes and nothing else.
func (c *FlowNodeClasses) sameBoard(ctx context.Context, boardID, classID string) error {
	target, err := c.repo.FindClass(ctx, classID)
	if err != nil {
		return err
	}
	if target.BoardID != boardID {
		return entities.Invalidf("node class %s is on another board", classID)
	}
	return nil
}

// runnerNamed checks that the runner a class names is a runner of this store — or is empty,
// which is a class pinned nowhere.
func (c *FlowNodeClasses) runnerNamed(ctx context.Context, runner string) error {
	if strings.TrimSpace(runner) == "" {
		return nil
	}
	if _, err := c.runners.FindRunner(ctx, runner); err != nil {
		return entities.NotFoundf("runner %s", runner)
	}
	return nil
}

// agentNamed checks that the agent a version names is an agent of this store — or is empty,
// which is a version with no default agent. The way a card's agent is checked, and for the
// same reason: a version naming an id nothing holds names nothing to play its instances.
func (c *FlowNodeClasses) agentNamed(ctx context.Context, agent string) error {
	if strings.TrimSpace(agent) == "" {
		return nil
	}
	if _, err := c.agents.FindAgent(ctx, agent); err != nil {
		return entities.NotFoundf("agent %s", agent)
	}
	return nil
}
