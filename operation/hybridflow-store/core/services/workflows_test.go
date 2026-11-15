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

func workflowCore(t *testing.T) (*services.Boards, *services.FlowNodes, *services.FlowNodeClasses, *services.Workflows, *entities.Board) {
	t.Helper()
	store := memory.New()
	clock := fixedClock{at: time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)}
	ids := &countingIDs{}
	boards := services.NewBoards(store, clock, ids)
	flowNodes := services.NewFlowNodes(store, store, store, store, store, clock, ids)
	classes := services.NewFlowNodeClasses(store, store, store, store, store, clock, ids)
	workflows := services.NewWorkflows(store, store, store, clock, ids)
	made, err := boards.Create(context.Background(), services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return boards, flowNodes, classes, workflows, made
}

func twoCards(t *testing.T, flowNodes *services.FlowNodes, boardID string) []entities.FlowNode {
	t.Helper()
	made, err := flowNodes.Create(context.Background(), boardID, []services.NewFlowNodeRequest{
		{Title: "One"}, {Title: "Two"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return made
}

// Creating a workflow groups its cards in it: each names the workflow afterwards.
func TestCreateWorkflowGroupsItsCards(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{cards[0].ID, cards[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Name != "Sprint" {
		t.Errorf("workflow name = %q, want Sprint", made.Name)
	}
	for _, card := range cards {
		found, err := flowNodes.Find(ctx, card.ID)
		if err != nil {
			t.Fatal(err)
		}
		if found.WorkflowID != made.ID {
			t.Errorf("card %q names workflow %q, want %q", card.Title, found.WorkflowID, made.ID)
		}
	}
}

// A member that is not a card of this board refuses the whole call — and no workflow is filed
// for it.
func TestCreateWorkflowRefusesACardOfAnotherBoard(t *testing.T) {
	boards, flowNodes, _, workflows, b := workflowCore(t)
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
		t.Errorf("create = %v, want the card of another board refused", err)
	}
	held, err := workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 0 {
		t.Errorf("board holds %d workflows, want none", len(held))
	}
}

// A card already grouped is moved: creating a second workflow with it takes it out of the
// first, a card being in at most one workflow.
func TestCreateWorkflowMovesACardAlreadyGrouped(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	first, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "First", FlowNodes: []string{cards[0].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Second", FlowNodes: []string{cards[0].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	found, err := flowNodes.Find(ctx, cards[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if found.WorkflowID != second.ID {
		t.Errorf("card names workflow %q, want the second one %q", found.WorkflowID, second.ID)
	}
	if _, err := workflows.Find(ctx, first.ID); err != nil {
		t.Errorf("the first workflow should still be there: %v", err)
	}
}

// Deleting a workflow ungroups its cards and leaves them where they are: the rectangle goes,
// the cards stay.
func TestDeleteWorkflowUngroupsItsCards(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{cards[0].ID, cards[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := workflows.Delete(ctx, []string{made.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	for _, card := range cards {
		found, err := flowNodes.Find(ctx, card.ID)
		if err != nil {
			t.Fatalf("card %q should still be there: %v", card.Title, err)
		}
		if found.WorkflowID != "" {
			t.Errorf("card %q still names workflow %q", card.Title, found.WorkflowID)
		}
	}
}

// Patching a card's workflow groups it, and the empty string takes it out again.
func TestPatchCardWorkflowGroupsAndUngroups(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{Name: "Sprint"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	patched, err := flowNodes.Patch(ctx, cards[0].ID,
		entities.FlowNodePatch{WorkflowID: &made.ID}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.WorkflowID != made.ID {
		t.Errorf("card names workflow %q, want %q", patched.WorkflowID, made.ID)
	}
	empty := ""
	patched, err = flowNodes.Patch(ctx, cards[0].ID,
		entities.FlowNodePatch{WorkflowID: &empty}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.WorkflowID != "" {
		t.Errorf("card still names workflow %q", patched.WorkflowID)
	}
}

// A card naming a workflow nothing holds is refused at the write, where the message can name
// the card.
func TestPatchCardWorkflowRefusesAWorkflowNothingHolds(t *testing.T) {
	_, flowNodes, _, _, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	ghost := "ghost"
	_, err := flowNodes.Patch(ctx, cards[0].ID,
		entities.FlowNodePatch{WorkflowID: &ghost}, nil, "alex")
	if !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("patch = %v, want the workflow refused as not found", err)
	}
}

// Deleting the last card of a workflow takes the workflow with it: a rectangle with
// nothing in it is a shape nobody can pick up again, so the store does not keep it.
// A delete that leaves members behind keeps it.
func TestDeleteLastCardDeletesItsWorkflow(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	cards := twoCards(t, flowNodes, b.ID)
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{cards[0].ID, cards[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := flowNodes.Delete(ctx, []string{cards[0].ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 1 {
		t.Fatalf("the board holds %d workflows, want the one with members left", len(held))
	}
	if err := flowNodes.Delete(ctx, []string{cards[1].ID}, "alex"); err != nil {
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

// The workflow classes mirror it: deleting the last class of one takes it with it.
func TestDeleteLastClassDeletesItsWorkflowClass(t *testing.T) {
	_, _, classes, workflows, b := workflowCore(t)
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "One"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Two"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{
		Name: "Shapes", Classes: []string{first.Class.ID, second.Class.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := classes.Delete(ctx, []string{first.Class.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := workflows.BoardClasses(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 1 {
		t.Fatalf("the board holds %d workflow classes, want the one with members left", len(held))
	}
	if err := classes.Delete(ctx, []string{second.Class.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err = workflows.BoardClasses(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 0 {
		t.Errorf("the board holds %d workflow classes, want none", len(held))
	}
	if _, err := workflows.FindClass(ctx, made.ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("find = %v, want the emptied workflow class gone", err)
	}
}

// A card made inside a rectangle says so at creation.
func TestCreateCardInsideAWorkflow(t *testing.T) {
	_, flowNodes, _, workflows, b := workflowCore(t)
	ctx := context.Background()
	made, err := workflows.Create(ctx, b.ID, services.NewWorkflowRequest{Name: "Sprint"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Inside", Workflow: made.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if cards[0].WorkflowID != made.ID {
		t.Errorf("card names workflow %q, want %q", cards[0].WorkflowID, made.ID)
	}
}

// The workflow classes mirror the workflows: created with their classes, deleted into
// ungrouped ones.
func TestWorkflowClassesGroupAndUngroup(t *testing.T) {
	_, _, classes, workflows, b := workflowCore(t)
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "One"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Two"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{
		Name: "Shapes", Classes: []string{first.Class.ID, second.Class.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{first.Class.ID, second.Class.ID} {
		found, err := classes.Find(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if found.Class.WorkflowClassID != made.ID {
			t.Errorf("class %q names workflow class %q, want %q",
				found.Class.Title, found.Class.WorkflowClassID, made.ID)
		}
	}
	renamed, err := workflows.PatchClass(ctx, made.ID,
		entities.WorkflowClassPatch{Name: &[]string{"Forms"}[0]}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Forms" {
		t.Errorf("workflow class name = %q, want Forms", renamed.Name)
	}
	if err := workflows.DeleteClasses(ctx, []string{made.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{first.Class.ID, second.Class.ID} {
		found, err := classes.Find(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if found.Class.WorkflowClassID != "" {
			t.Errorf("class %q still names workflow class %q",
				found.Class.Title, found.Class.WorkflowClassID)
		}
	}
}

// A class of another board refuses the workflow class, like a card of another board refuses
// the workflow.
func TestCreateWorkflowClassRefusesAClassOfAnotherBoard(t *testing.T) {
	boards, _, classes, workflows, b := workflowCore(t)
	ctx := context.Background()
	other, err := boards.Create(ctx, services.NewBoardRequest{Name: "Minor"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	away, err := classes.Create(ctx, other.ID, services.NewClassRequest{Title: "Away"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	_, err = workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{
		Name: "Shapes", Classes: []string{away.Class.ID},
	}, "alex")
	if !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the class of another board refused", err)
	}
}
