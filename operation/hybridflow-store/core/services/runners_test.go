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

func newRunners() (*services.Runners, *memory.Store) {
	store := memory.New()
	clock := fixedClock{at: time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)}
	return services.NewRunners(store, clock, &countingIDs{}), store
}

func TestCreateFilesARunnerWithAMintedID(t *testing.T) {
	runners, _ := newRunners()
	made, err := runners.Create(context.Background(),
		services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.ID == "" {
		t.Error("the runner has no id")
	}
	if made.Name != "Server" {
		t.Errorf("runner = %+v", made)
	}
	if made.LastSeen != nil {
		t.Errorf("last seen = %v, want none until the first heartbeat", made.LastSeen)
	}
	if made.Revision != 1 {
		t.Errorf("revision = %d, want 1", made.Revision)
	}
}

func TestCreateRefusesARunnerWithNoName(t *testing.T) {
	runners, _ := newRunners()
	if _, err := runners.Create(context.Background(),
		services.NewRunnerRequest{Name: "  "}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("create = %v, want the missing name refused", err)
	}
}

func TestCreateRunnerRefusesATakenName(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	if _, err := runners.Create(ctx,
		services.NewRunnerRequest{Name: "Server"}, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := runners.Create(ctx,
		services.NewRunnerRequest{Name: "server"}, "alex"); !errors.Is(err, entities.ErrRunnerNameTaken) {
		t.Errorf("create = %v, want the taken name refused", err)
	}
}

func TestListIsEveryRunnerByName(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	for _, name := range []string{"Server", "Desktop"} {
		if _, err := runners.Create(ctx, services.NewRunnerRequest{Name: name}, "alex"); err != nil {
			t.Fatal(err)
		}
	}
	list, err := runners.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Name != "Desktop" || list[1].Name != "Server" {
		t.Errorf("list = %v, want both runners by name", list)
	}
}

func TestPatchRenamesARunner(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	made, err := runners.Create(ctx, services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	name := "Desktop"
	patched, err := runners.Patch(ctx, made.ID, entities.RunnerPatch{Name: &name}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Name != "Desktop" {
		t.Errorf("name = %q", patched.Name)
	}
}

func TestPatchRefusesAnEmptiedName(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	made, err := runners.Create(ctx, services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	empty := "  "
	if _, err := runners.Patch(ctx, made.ID,
		entities.RunnerPatch{Name: &empty}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want the emptied name refused", err)
	}
}

func TestDeleteRemovesARunner(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	made, err := runners.Create(ctx, services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := runners.Delete(ctx, made.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := runners.Find(ctx, made.ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("find = %v, want the runner gone", err)
	}
}

// The heartbeat stamps last seen and nothing else: the revision stands still, so renaming a
// runner never races the calls its own process keeps making.
func TestHeartbeatStampsLastSeen(t *testing.T) {
	runners, _ := newRunners()
	ctx := context.Background()
	made, err := runners.Create(ctx, services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	seen, err := runners.Heartbeat(ctx, made.ID, "runner")
	if err != nil {
		t.Fatal(err)
	}
	if seen.LastSeen == nil || seen.LastSeen.IsZero() {
		t.Fatalf("last seen = %v, want the heartbeat stamped", seen.LastSeen)
	}
	if seen.Revision != made.Revision {
		t.Errorf("revision = %d, want %d", seen.Revision, made.Revision)
	}
}

func TestHeartbeatOfAGoneRunnerIsNotFound(t *testing.T) {
	runners, _ := newRunners()
	if _, err := runners.Heartbeat(context.Background(), "nope", "runner"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("heartbeat = %v, want the gone runner refused", err)
	}
}

// A card naming a runner nothing holds is refused at the write, like a card naming no such
// agent — and one naming a runner there is goes in with the pin on it.
func TestCardNamingAnUnknownRunnerIsRefused(t *testing.T) {
	boards, flowNodes, _, _ := newCore()
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	_, err = flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Write the plan", Type: "ai",
		Settings: entities.TaskSettings{Runner: "nope"},
	}}, "alex")
	if !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("create = %v, want the unknown runner refused", err)
	}
}

func TestCardKeepsTheRunnerItNames(t *testing.T) {
	boards, flowNodes, _, store := newCore()
	ctx := context.Background()
	clock := fixedClock{at: time.Now()}
	ids := &countingIDs{}
	agents := services.NewAgents(store, clock, ids)
	agent, err := agents.Create(ctx, services.NewAgentRequest{Name: "Reviewer", Platform: "claude"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	runners := services.NewRunners(store, clock, ids)
	runner, err := runners.Create(ctx, services.NewRunnerRequest{Name: "Server"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Write the plan", Type: "ai",
		Settings: entities.TaskSettings{
			Agent: agent.ID, Effort: "high", Permission: "manualLive", Folder: "/",
			Runner: runner.ID,
		},
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if got := made[0].Task.Settings.Runner; got != runner.ID {
		t.Errorf("runner = %q, want %q", got, runner.ID)
	}
}
