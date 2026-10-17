package services

import (
	"context"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Workflows is the grouping half of the core: the workflows round the flow nodes and the
// workflow classes round the node classes.
//
// Either is a name and nothing else — the rectangle the board draws is computed from the cards
// it holds — so what this half enforces is the membership: a workflow holds flow nodes of its
// own board, a workflow class holds classes of its own board, and the two never mix.
type Workflows struct {
	repo    ports.WorkflowRepository
	boards  ports.BoardRepository
	classes ports.ClassRepository
	clock   ports.Clock
	ids     ports.IDs
}

func NewWorkflows(repo ports.WorkflowRepository, boards ports.BoardRepository, classes ports.ClassRepository, clock ports.Clock, ids ports.IDs) *Workflows {
	return &Workflows{repo: repo, boards: boards, classes: classes, clock: clock, ids: ids}
}

// NewWorkflowRequest is one workflow to be made, with the cards it groups.
type NewWorkflowRequest struct {
	// ID is the identity the client minted, or empty to have one minted here — the same rule a
	// card's id follows.
	ID   string
	Name string
	// FlowNodes are the cards the workflow groups. Each names a flow node of this board — a
	// card already grouped is moved into this one, a card being in at most one workflow.
	FlowNodes []string
}

// Create files a workflow on a board and groups its cards in it. Grouping a card is a change
// to the card — its own revision moves and its own change row is written — so what comes back
// is the workflow alone: the cards are read off the board they are on.
func (w *Workflows) Create(ctx context.Context, boardID string, req NewWorkflowRequest, actor string) (*entities.Workflow, error) {
	board, err := w.boards.FindBoard(ctx, boardID)
	if err != nil {
		return nil, err
	}
	for _, id := range req.FlowNodes {
		if err := w.sameBoard(ctx, board.ID, id); err != nil {
			return nil, err
		}
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = w.ids.NewID()
	} else if !entities.ValidID(id) {
		return nil, entities.Invalidf("%q is not an id this store can hold", req.ID)
	}
	now := w.clock.Now()
	workflow := &entities.Workflow{
		ID: id, BoardID: board.ID, Name: strings.TrimSpace(req.Name),
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	if err := w.repo.CreateWorkflow(ctx, workflow, actor); err != nil {
		return nil, err
	}
	for _, id := range req.FlowNodes {
		member := id
		if _, err := w.boards.PatchFlowNode(ctx, member,
			entities.FlowNodePatch{WorkflowID: &workflow.ID}, nil, actor); err != nil {
			return nil, err
		}
	}
	return workflow, nil
}

// Board is every workflow of a board: the rectangles round the board's cards.
func (w *Workflows) Board(ctx context.Context, boardID string) ([]entities.Workflow, error) {
	return w.repo.ListWorkflows(ctx, boardID)
}

// Find is one workflow.
func (w *Workflows) Find(ctx context.Context, id string) (*entities.Workflow, error) {
	return w.repo.FindWorkflow(ctx, id)
}

// Patch renames the workflow. Its members are untouched: grouping is the cards', written
// through their own patches.
func (w *Workflows) Patch(ctx context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		patch.Name = &name
	}
	return w.repo.PatchWorkflow(ctx, id, patch, expected, actor)
}

// Delete removes workflows. Their cards are ungrouped and left where they are: the rectangle
// goes, the cards stay.
func (w *Workflows) Delete(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no workflow to delete")
	}
	return w.repo.DeleteWorkflows(ctx, ids, actor)
}

// NewWorkflowClassRequest is one workflow class to be made, with the classes it groups.
type NewWorkflowClassRequest struct {
	// ID is the identity the client minted, or empty to have one minted here.
	ID   string
	Name string
	// Classes are the node classes the workflow class groups. Each names a class of this
	// board — a class already grouped is moved into this one.
	Classes []string
}

// CreateClass files a workflow class on a board and groups its classes in it.
func (w *Workflows) CreateClass(ctx context.Context, boardID string, req NewWorkflowClassRequest, actor string) (*entities.WorkflowClass, error) {
	board, err := w.boards.FindBoard(ctx, boardID)
	if err != nil {
		return nil, err
	}
	for _, id := range req.Classes {
		if err := w.sameBoardClass(ctx, board.ID, id); err != nil {
			return nil, err
		}
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = w.ids.NewID()
	} else if !entities.ValidID(id) {
		return nil, entities.Invalidf("%q is not an id this store can hold", req.ID)
	}
	now := w.clock.Now()
	workflow := &entities.WorkflowClass{
		ID: id, BoardID: board.ID, Name: strings.TrimSpace(req.Name),
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	if err := w.repo.CreateWorkflowClass(ctx, workflow, actor); err != nil {
		return nil, err
	}
	for _, id := range req.Classes {
		member := id
		if _, err := w.classes.PatchClass(ctx, member,
			entities.FlowNodeClassPatch{WorkflowClassID: &workflow.ID}, nil, actor); err != nil {
			return nil, err
		}
	}
	return workflow, nil
}

// BoardClasses is every workflow class of a board.
func (w *Workflows) BoardClasses(ctx context.Context, boardID string) ([]entities.WorkflowClass, error) {
	return w.repo.ListWorkflowClasses(ctx, boardID)
}

// ListedWorkflowClass is one workflow class for the instantiate menu: the rectangle and the
// board it is filed on.
type ListedWorkflowClass struct {
	Workflow entities.WorkflowClass
	// BoardSlug and BoardName name the board the workflow class is filed on.
	BoardSlug string
	BoardName string
}

// All is every workflow class of every board with its board's name: what the instantiate
// menu lists beside the node classes.
func (w *Workflows) All(ctx context.Context) ([]ListedWorkflowClass, error) {
	classes, err := w.repo.ListAllWorkflowClasses(ctx)
	if err != nil {
		return nil, err
	}
	boards, err := w.boards.ListBoards(ctx, ports.BoardFilter{IncludeArchived: true})
	if err != nil {
		return nil, err
	}
	named := map[string]entities.Board{}
	for _, board := range boards {
		named[board.ID] = board
	}
	out := make([]ListedWorkflowClass, 0, len(classes))
	for _, class := range classes {
		listed := ListedWorkflowClass{Workflow: class}
		if board, ok := named[class.BoardID]; ok {
			listed.BoardSlug, listed.BoardName = board.Slug, board.Name
		}
		out = append(out, listed)
	}
	return out, nil
}

// FindClass is one workflow class.
func (w *Workflows) FindClass(ctx context.Context, id string) (*entities.WorkflowClass, error) {
	return w.repo.FindWorkflowClass(ctx, id)
}

// PatchClass renames the workflow class. Its members are untouched.
func (w *Workflows) PatchClass(ctx context.Context, id string, patch entities.WorkflowClassPatch, expected *int64, actor string) (*entities.WorkflowClass, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		patch.Name = &name
	}
	return w.repo.PatchWorkflowClass(ctx, id, patch, expected, actor)
}

// DeleteClasses removes workflow classes. Their classes are ungrouped and left where they are.
func (w *Workflows) DeleteClasses(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no workflow class to delete")
	}
	return w.repo.DeleteWorkflowClasses(ctx, ids, actor)
}

// sameBoard refuses a member that is not a flow node of this board — a card of another board,
// or an id nothing holds.
func (w *Workflows) sameBoard(ctx context.Context, boardID, flowNodeID string) error {
	flowNode, err := w.boards.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return err
	}
	if flowNode.BoardID != boardID {
		return entities.Invalidf("card %s is on another board", flowNodeID)
	}
	return nil
}

// sameBoardClass refuses a member that is not a class of this board.
func (w *Workflows) sameBoardClass(ctx context.Context, boardID, classID string) error {
	class, err := w.classes.FindClass(ctx, classID)
	if err != nil {
		return err
	}
	if class.BoardID != boardID {
		return entities.Invalidf("class %s is on another board", classID)
	}
	return nil
}

// CheckWorkflow checks that the workflow a card names is one of this board — or is empty,
// which is a card grouped nowhere. It is what the card half calls before writing a membership,
// through the same repository this half writes through.
func CheckWorkflow(ctx context.Context, repo ports.WorkflowRepository, boardID, workflowID string) error {
	if workflowID == "" {
		return nil
	}
	workflow, err := repo.FindWorkflow(ctx, workflowID)
	if err != nil {
		return entities.NotFoundf("workflow %s", workflowID)
	}
	if workflow.BoardID != boardID {
		return entities.Invalidf("workflow %s is on another board", workflowID)
	}
	return nil
}

// CheckWorkflowClass checks that the workflow class a class names is one of this board — or
// is empty, which is a class grouped nowhere.
func CheckWorkflowClass(ctx context.Context, repo ports.WorkflowRepository, boardID, workflowID string) error {
	if workflowID == "" {
		return nil
	}
	workflow, err := repo.FindWorkflowClass(ctx, workflowID)
	if err != nil {
		return entities.NotFoundf("workflow class %s", workflowID)
	}
	if workflow.BoardID != boardID {
		return entities.Invalidf("workflow class %s is on another board", workflowID)
	}
	return nil
}
