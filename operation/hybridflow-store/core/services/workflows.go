package services

import (
	"context"
	"path"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Workflows groups flow nodes on a board and manages their shared values and files.
type Workflows struct {
	repo   ports.WorkflowRepository
	boards ports.BoardRepository
	clock  ports.Clock
	ids    ports.IDs
}

func NewWorkflows(repo ports.WorkflowRepository, boards ports.BoardRepository, clock ports.Clock, ids ports.IDs) *Workflows {
	return &Workflows{repo: repo, boards: boards, clock: clock, ids: ids}
}

// NewWorkflowRequest is one workflow to be made, with the flow nodes it groups.
type NewWorkflowRequest struct {
	// ID is the identity the client minted, or empty to have one minted here — the same rule a
	// flow node's id follows.
	ID             string
	Name           string
	WorkflowFolder string
	Files          []string
	// FlowNodes are the flow nodes the workflow groups. Each names a flow node of this board — a
	// flow node already grouped is moved into this one, a flow node being in at most one workflow.
	FlowNodes []string
}

// Create files a workflow on a board and groups its flow nodes in it. Grouping a flow node is a change
// to the flow node — its own revision moves and its own change row is written — so what comes back
// is the workflow alone: the flow nodes are read off the board they are on.
func (w *Workflows) Create(ctx context.Context, boardID string, req NewWorkflowRequest, actor string) (*entities.Workflow, error) {
	folder, err := readWorkflowFolder(req.WorkflowFolder)
	if err != nil {
		return nil, err
	}
	files, err := readWorkflowFiles(req.Files)
	if err != nil {
		return nil, err
	}
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
		WorkflowFolder: folder, Files: files,
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

// Board is every workflow of a board: the rectangles round the board's flow nodes.
func (w *Workflows) Board(ctx context.Context, boardID string) ([]entities.Workflow, error) {
	return w.repo.ListWorkflows(ctx, boardID)
}

// Find is one workflow.
func (w *Workflows) Find(ctx context.Context, id string) (*entities.Workflow, error) {
	return w.repo.FindWorkflow(ctx, id)
}

// Patch edits a workflow's name, shared values and file references.
func (w *Workflows) Patch(ctx context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error) {
	if err := patch.Validate(); err != nil {
		return nil, err
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		patch.Name = &name
	}
	if patch.WorkflowFolder != nil {
		folder, err := readWorkflowFolder(*patch.WorkflowFolder)
		if err != nil {
			return nil, err
		}
		patch.WorkflowFolder = &folder
	}
	files, err := readWorkflowFiles(patch.Files)
	if err != nil {
		return nil, err
	}
	patch.Files = files
	return w.repo.PatchWorkflow(ctx, id, patch, expected, actor)
}

func readWorkflowFolder(folder string) (string, error) {
	if strings.TrimSpace(folder) == "" {
		return "", nil
	}
	return readWorkflowPath(folder)
}

func readWorkflowFiles(files []string) ([]string, error) {
	if files == nil {
		return nil, nil
	}
	links := make([]string, 0, len(files))
	seen := make(map[string]bool, len(files))
	for _, file := range files {
		link, err := readWorkflowPath(file)
		if err != nil {
			return nil, err
		}
		if link == "/" {
			return nil, entities.Invalidf("a workflow file must be an entry inside the store")
		}
		if !seen[link] {
			links = append(links, link)
			seen[link] = true
		}
	}
	return links, nil
}

func readWorkflowPath(link string) (string, error) {
	rel := path.Clean(strings.TrimLeft(link, "/"))
	if link == "" || strings.ContainsRune(link, 0) || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", entities.Invalidf("invalid workflow store path %q", link)
	}
	if rel == "." {
		return "/", nil
	}
	return "/" + rel, nil
}

// Delete removes workflows. Their flow nodes are ungrouped and left where they are: the rectangle
// goes, the flow nodes stay.
func (w *Workflows) Delete(ctx context.Context, ids []string, actor string) error {
	if len(ids) == 0 {
		return entities.Invalidf("no workflow to delete")
	}
	return w.repo.DeleteWorkflows(ctx, ids, actor)
}

// sameBoard refuses a member that is not a flow node of this board — a flow node of another board,
// or an id nothing holds.
func (w *Workflows) sameBoard(ctx context.Context, boardID, flowNodeID string) error {
	flowNode, err := w.boards.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return err
	}
	if flowNode.BoardID != boardID {
		return entities.Invalidf("flow node %s is on another board", flowNodeID)
	}
	return nil
}

// CheckWorkflow checks that the workflow a flow node names is one of this board — or is empty,
// which is a flow node grouped nowhere. It is what the flow node half calls before writing a membership,
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
