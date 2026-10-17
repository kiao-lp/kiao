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
		Name: "Reviewer", Platform: "claude", Model: "opus", Instructions: "Be concise.",
		Description: "  Review code for correctness.  ",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.ID == "" {
		t.Error("the agent has no id")
	}
	if made.Name != "Reviewer" || made.Platform != entities.PlatformClaude ||
		made.Model != "opus" || made.Instructions != "Be concise." || made.Description != "Review code for correctness." {
		t.Errorf("agent = %+v", made)
	}
	if made.Revision != 1 {
		t.Errorf("revision = %d, want 1", made.Revision)
	}
}

// The model and the instructions may both be empty: the CLI's own default, and no standing
// orders. Only the name and the platform make an agent one.
func TestCreateFilesABareAgent(t *testing.T) {
	_, _, agents, _ := newCore()
	made, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Runner", Platform: "codex"}, "alex")
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
		Name: "Reviewer", Platform: "claude", Instructions: "Be concise.",
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
		services.NewAgentRequest{Name: "  ", Platform: "claude"}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the missing name refused", err)
	}
}

func TestCreateRefusesAnUnknownPlatform(t *testing.T) {
	_, _, agents, _ := newCore()
	if _, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Reviewer", Platform: "hal"}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the platform refused", err)
	}
}

// Every platform this build drives files an agent — claude, codex, muse and opencode alike.
func TestCreateFilesAnAgentOnEveryPlatform(t *testing.T) {
	_, _, agents, _ := newCore()
	for _, tc := range []struct {
		name     string
		platform string
		model    string
		want     entities.AgentPlatform
	}{
		{"Reviewer", "claude", "opus", entities.PlatformClaude},
		{"Runner", "codex", "", entities.PlatformCodex},
		{"Spark", "muse", "", entities.PlatformMuse},
		{"Deep", "opencode", "deepseek/deepseek-v4-pro", entities.PlatformOpenCode},
		{"Mistral", "opencode", "mistral/mistral-large-4", entities.PlatformOpenCode},
	} {
		made, err := agents.Create(context.Background(), services.NewAgentRequest{
			Name: tc.name, Platform: tc.platform, Model: tc.model,
		}, "alex")
		if err != nil {
			t.Errorf("create %s/%s = %v, want it filed", tc.platform, tc.model, err)
			continue
		}
		if made.Platform != tc.want {
			t.Errorf("platform = %q, want %q", made.Platform, tc.want)
		}
	}
}

// The platform is forgiving about case and space, and about nothing else.
func TestCreateReadsThePlatformLoosely(t *testing.T) {
	_, _, agents, _ := newCore()
	made, err := agents.Create(context.Background(),
		services.NewAgentRequest{Name: "Reviewer", Platform: " Claude "}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Platform != entities.PlatformClaude {
		t.Errorf("platform = %q, want claude", made.Platform)
	}
}

func TestCreateRefusesATakenName(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	if _, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Platform: "claude"}, "alex"); err != nil {
		t.Fatal(err)
	}
	// However it is cased: two agents called the same thing would be two rows of a select nobody
	// can tell apart.
	if _, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "reviewer", Platform: "codex"}, "alex"); !errors.Is(err, entities.ErrAgentNameTaken) {
		t.Errorf("create = %v, want the name refused as taken", err)
	}
}

func TestListIsEveryAgentByName(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	for _, name := range []string{"Writer", "Reviewer"} {
		if _, err := agents.Create(ctx,
			services.NewAgentRequest{Name: name, Platform: "claude"}, "alex"); err != nil {
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
		services.NewAgentRequest{Name: "Reviewer", Platform: "claude", Model: "opus"}, "alex")
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
		patched.Name != "Reviewer" || patched.Platform != entities.PlatformClaude {
		t.Errorf("agent = %+v, want only the model and the instructions changed", patched)
	}
}

func TestPatchRefusesAnEmptiedNameAndAnUnknownPlatform(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	made, err := agents.Create(ctx,
		services.NewAgentRequest{Name: "Reviewer", Platform: "claude"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	empty := "  "
	if _, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Name: &empty}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want the emptied name refused", err)
	}
	platform := entities.AgentPlatform("hal")
	if _, err := agents.Patch(ctx, made.ID, entities.AgentPatch{Platform: &platform}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want the platform refused", err)
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
		services.NewAgentRequest{Name: "Reviewer", Platform: "claude", Model: "opus"}, "alex")
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
