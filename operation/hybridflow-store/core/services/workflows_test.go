package services_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func workflowCore(t *testing.T) (*services.Boards, *services.FlowNodes, *services.Workflows, *entities.Board) {
	t.Helper()
	store := memory.New()
	clock := fixedClock{at: time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)}
	ids := &countingIDs{}
	boards := services.NewBoards(store, clock, ids)
	flowNodes := services.NewFlowNodes(store, store, store, store, clock, ids)
	workflows := services.NewWorkflows(store, store, clock, ids)
	made, err := boards.Create(context.Background(), services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return boards, flowNodes, workflows, made
}

func twoNodes(t *testing.T, flowNodes *services.FlowNodes, boardID string) []entities.FlowNode {
	t.Helper()
	made, err := flowNodes.Create(context.Background(), boardID, []services.NewFlowNodeRequest{
		{Title: "One"}, {Title: "Two"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return made
}

// Creating a workflow groups its flow nodes in it: each names the workflow afterwards.
func TestCreateWorkflowGroupsItsFlowNodes(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{nodes[0].ID, nodes[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Name != "Sprint" {
		t.Errorf("workflow name = %q, want Sprint", made.Name)
	}
	for _, node := range nodes {
		found, err := flowNodes.Find(ctx, node.ID)
		if err != nil {
			t.Fatal(err)
		}
		if found.WorkflowID != made.ID {
			t.Errorf("flow node %q names workflow %q, want %q", node.Title, found.WorkflowID, made.ID)
		}
	}
}

// A member that is not a flow node of this board refuses the whole call — and no workflow is filed
// for it.
func TestCreateWorkflowRefusesAFlowNodeOfAnotherBoard(t *testing.T) {
	boards, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	other, err := boards.Create(ctx, services.NewBoardRequest{Name: "Minor"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	away, err := flowNodes.Create(ctx, other.ID, []services.NewFlowNodeRequest{{Title: "Away"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	_, err = workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{away[0].ID},
	}, "alex")
	if !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the flow node of another board refused", err)
	}
	held, err := workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 0 {
		t.Errorf("board holds %d workflows, want none", len(held))
	}
}

// A flow node already grouped is moved: creating a second workflow with it takes it out of the
// first, a flow node being in at most one workflow.
func TestCreateWorkflowMovesAFlowNodeAlreadyGrouped(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	first, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "First", FlowNodes: []string{nodes[0].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Second", FlowNodes: []string{nodes[0].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	found, err := flowNodes.Find(ctx, nodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if found.WorkflowID != second.ID {
		t.Errorf("flow node names workflow %q, want the second one %q", found.WorkflowID, second.ID)
	}
	if _, err := workflows.Find(ctx, first.ID); err != nil {
		t.Errorf("the first workflow should still be there: %v", err)
	}
}

// Deleting a workflow ungroups its flow nodes and leaves them where they are: the rectangle goes,
// the flow nodes stay.
func TestDeleteWorkflowUngroupsItsFlowNodes(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{nodes[0].ID, nodes[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := workflows.Delete(ctx, []string{made.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	for _, node := range nodes {
		found, err := flowNodes.Find(ctx, node.ID)
		if err != nil {
			t.Fatalf("flow node %q should still be there: %v", node.Title, err)
		}
		if found.WorkflowID != "" {
			t.Errorf("flow node %q still names workflow %q", node.Title, found.WorkflowID)
		}
	}
}

// Patching a flow node's workflow groups it, and the empty string takes it out again.
func TestPatchFlowNodeWorkflowGroupsAndUngroups(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{Name: "Sprint"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	patched, err := flowNodes.Patch(ctx, nodes[0].ID,
		entities.FlowNodePatch{WorkflowID: &made.ID}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.WorkflowID != made.ID {
		t.Errorf("flow node names workflow %q, want %q", patched.WorkflowID, made.ID)
	}
	empty := ""
	patched, err = flowNodes.Patch(ctx, nodes[0].ID,
		entities.FlowNodePatch{WorkflowID: &empty}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.WorkflowID != "" {
		t.Errorf("flow node still names workflow %q", patched.WorkflowID)
	}
}

// A flow node naming a workflow nothing holds is refused at the write, where the message can name
// the flow node.
func TestPatchFlowNodeWorkflowRefusesAWorkflowNothingHolds(t *testing.T) {
	_, flowNodes, _, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	ghost := "ghost"
	_, err := flowNodes.Patch(ctx, nodes[0].ID,
		entities.FlowNodePatch{WorkflowID: &ghost}, nil, "alex")
	if !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("patch = %v, want the workflow refused as not found", err)
	}
}

// Deleting the last flow node of a workflow takes the workflow with it: a rectangle with
// nothing in it is a shape nobody can pick up again, so the store does not keep it.
// A delete that leaves members behind keeps it.
func TestDeleteLastFlowNodeDeletesItsWorkflow(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	nodes := twoNodes(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{nodes[0].ID, nodes[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := flowNodes.Delete(ctx, []string{nodes[0].ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 1 {
		t.Fatalf("the board holds %d workflows, want the one with members left", len(held))
	}
	if err := flowNodes.Delete(ctx, []string{nodes[1].ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err = workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 0 {
		t.Errorf("the board holds %d workflows, want none", len(held))
	}
	if _, err := workflows.Find(ctx, made.ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("find = %v, want the emptied workflow gone", err)
	}
}

// A flow node made inside a rectangle says so at creation.
func TestCreateFlowNodeInsideAWorkflow(t *testing.T) {
	_, flowNodes, workflows, b := workflowCore(t)
	ctx := context.Background()
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{Name: "Sprint"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Inside", Workflow: made.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if nodes[0].WorkflowID != made.ID {
		t.Errorf("flow node names workflow %q, want %q", nodes[0].WorkflowID, made.ID)
	}
}
