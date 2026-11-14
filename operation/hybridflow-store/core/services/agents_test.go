package services_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestCreateFilesAnAgentWithAMintedID(t *testing.T) {
	_, _, agents, _ := newCore()
	made, err := agents.Create(context.Background(), services.NewAgentRequest{
		Name: "Reviewer", Harness: "claude", Model: "opus", Instructions: "Be concise.",
		Description: "  Review code for correctness.  ",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.ID == "" {
		t.Error("the agent has no id")
	}
	if made.Name != "Reviewer" || made.Harness != entities.HarnessClaude ||
		made.Model != "opus" || made.Instructions != "Be concise." || made.Description != "Review code for correctness." {
		t.Errorf("agent = %+v", made)
	}
	if made.Revision != 1 {
		t.Errorf("revision = %d, want 1", made.Revision)
	}
}

// The model and the instructions may both be empty: the CLI's own default, and no standing
// orders. Only the name and the harness make an agent one.
func TestCreateFilesABareAgent(t *testing.T) {
	_, _, agents, _ := newCore()
	made, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Runner", Harness: "codex"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Model != "" || made.Instructions != "" || made.Description != "" {
		t.Errorf("agent = %+v, want no model and no instructions", made)
	}
}

func TestAgentDescriptionCanChangeAndClearWithoutChangingInstructions(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	made, err := agents.Create(ctx, services.NewAgentRequest{
		Name: "Reviewer", Harness: "claude", Instructions: "Be concise.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	for _, description := range []string{"  Review code for correctness.  ", "  "} {
		patched, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Description: &description}, nil, "alex")
		if err != nil {
			t.Fatal(err)
		}
		if patched.Description != strings.TrimSpace(description) || patched.Instructions != made.Instructions {
			t.Errorf("agent = %+v, want only the description changed", patched)
		}
	}
}

func TestCreateRefusesAnAgentWithNoName(t *testing.T) {
	_, _, agents, _ := newCore()
	if _, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "  ", Harness: "claude"}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the missing name refused", err)
	}
}

func TestCreateRefusesAnUnknownHarness(t *testing.T) {
	_, _, agents, _ := newCore()
	if _, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Reviewer", Harness: "hal"}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the harness refused", err)
	}
}

// Every harness this build drives files an agent — claude, codex, muse and opencode alike.
func TestCreateFilesAnAgentOnEveryHarness(t *testing.T) {
	_, _, agents, _ := newCore()
	for _, tc := range []struct {
		name    string
		harness string
		model   string
		want    entities.Harness
	}{
		{"Reviewer", "claude", "opus", entities.HarnessClaude},
		{"Runner", "codex", "", entities.HarnessCodex},
		{"Spark", "muse", "", entities.HarnessMuse},
		{"Deep", "opencode", "deepseek/deepseek-v4-pro", entities.HarnessOpenCode},
		{"Mistral", "opencode", "mistral/mistral-large-4", entities.HarnessOpenCode},
	} {
		made, err := agents.Create(context.Background(), services.NewAgentRequest{
			Name: tc.name, Harness: tc.harness, Model: tc.model,
		}, "alex")
		if err != nil {
			t.Errorf("create %s/%s = %v, want it filed", tc.harness, tc.model, err)
			continue
		}
		if made.Harness != tc.want {
			t.Errorf("harness = %q, want %q", made.Harness, tc.want)
		}
	}
}

// The harness is forgiving about case and space, and about nothing else.
func TestCreateReadsTheHarnessLoosely(t *testing.T) {
	_, _, agents, _ := newCore()
	made, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Reviewer", Harness: " Claude "}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Harness != entities.HarnessClaude {
		t.Errorf("harness = %q, want claude", made.Harness)
	}
}

func TestCreateRefusesATakenName(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	if _, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Harness: "claude"}, "alex"); err != nil {
		t.Fatal(err)
	}
	// However it is cased: two agents called the same thing would be two rows of a select nobody
	// can tell apart.
	if _, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "reviewer", Harness: "codex"}, "alex"); !errors.Is(err, entities.ErrAgentNameTaken) {
		t.Errorf("create = %v, want the name refused as taken", err)
	}
}

func TestListIsEveryAgentByName(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	for _, name := range []string{"Writer", "Reviewer"} {
		if _, err := agents.Create(ctx,
			services.NewAgentRequest{Name: name, Harness: "claude"}, "alex"); err != nil {
			t.Fatal(err)
		}
	}
	listed, err := agents.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].Name != "Reviewer" || listed[1].Name != "Writer" {
		t.Errorf("agents = %+v, want both by name", listed)
	}
}

func TestPatchChangesWhatItNames(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	made, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Harness: "claude", Model: "opus"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	model, instructions := "sonnet", "Be kind."
	patched, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Model: &model, Instructions: &instructions},
		nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Model != "sonnet" || patched.Instructions != "Be kind." ||
		patched.Name != "Reviewer" || patched.Harness != entities.HarnessClaude {
		t.Errorf("agent = %+v, want only the model and the instructions changed", patched)
	}
}

func TestPatchRefusesAnEmptiedNameAndAnUnknownHarness(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	made, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Harness: "claude"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	empty := "  "
	if _, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Name: &empty}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want the emptied name refused", err)
	}
	harness := entities.Harness("hal")
	if _, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Harness: &harness}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want the harness refused", err)
	}
	if _, err := agents.Patch(ctx, made.ID, entities.AgentPatch{}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want an empty patch refused", err)
	}
}

// Deleting an agent touches no card: a flow node naming it still says which agent it wanted, and
// the next play says it is gone rather than failing on a reference nobody can see.
func TestDeleteLeavesTheFlowNodesNamingIt(t *testing.T) {
	boards, flowNodes, agents, _ := newCore()
	ctx := context.Background()
	made, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Harness: "claude", Model: "opus"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	cards, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Play it", Body: "Go.",
		Settings: entities.TaskSettings{
			Agent: made.ID, Effort: "high", Permission: "bypassPermissions", Folder: "/",
		},
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := agents.Delete(ctx, made.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	card, err := flowNodes.Find(ctx, cards[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if card.Settings().Agent != made.ID {
		t.Errorf("the card names %q, want the deleted agent still named", card.Settings().Agent)
	}
}

func TestPiAgentKeepsAnUnresolvedRunnerProfileReference(t *testing.T) {
	_, _, agents, _ := newCore()
	agent, err := agents.Create(context.Background(), services.NewAgentRequest{Name: "Pi reviewer", Harness: "pi", ProfileID: "pi-work", Model: "openai/gpt-test"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if agent.ProfileID != "pi-work" || agent.Harness != entities.HarnessPi {
		t.Fatalf("agent lost profile: %+v", agent)
	}
	missing := "missing-on-this-runner"
	patched, err := agents.Patch(context.Background(), agent.ID, entities.AgentPatch{ProfileID: &missing}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.ProfileID != missing {
		t.Fatal("runner-local reference was rewritten by the boards store")
	}
}
