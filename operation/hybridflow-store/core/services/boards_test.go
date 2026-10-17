package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestCreateBoardIsANameAndAHandle(t *testing.T) {
	boards, _, _, _ := newCore()
	board, err := boards.Create(context.Background(), services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if board.Slug != "major" {
		t.Errorf("slug = %q, want %q", board.Slug, "major")
	}
	if board.Name != "Major" || board.Revision != 1 {
		t.Errorf("board = %+v, want the name at revision 1", board)
	}
}

// Two names that slug onto one handle are both accepted, and the second is reachable at a handle of
// its own: a URL that opens the wrong board is worse than an ugly one.
func TestCreateBoardWorksAroundATakenHandle(t *testing.T) {
	boards, _, _, _ := newCore()
	ctx := context.Background()
	first, err := boards.Create(ctx, services.NewBoardRequest{Name: "Tech Debt"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := boards.Create(ctx, services.NewBoardRequest{Name: "tech debt!"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if first.Slug != "tech-debt" || second.Slug != "tech-debt-2" {
		t.Errorf("slugs = %q and %q", first.Slug, second.Slug)
	}
	found, err := boards.Find(ctx, "tech-debt-2")
	if err != nil || found.ID != second.ID {
		t.Errorf("Find(%q) = %v, %v", "tech-debt-2", found, err)
	}
}

func TestCreateBoardRefusesADuplicateName(t *testing.T) {
	boards, _, _, _ := newCore()
	ctx := context.Background()
	if _, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex"); err != nil {
		t.Fatal(err)
	}
	_, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if !errors.Is(err, entities.ErrNameTaken) {
		t.Errorf("second Major = %v, want ErrNameTaken", err)
	}
}

// A rename leaves the handle alone: the slug is what a bookmark and a pasted link hold.
func TestRenamingABoardKeepsItsURL(t *testing.T) {
	boards, _, _, _ := newCore()
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	name := "Majeur"
	renamed, err := boards.Patch(ctx, board.Slug, entities.BoardPatch{Name: &name}, &board.Revision, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != name || renamed.Slug != "major" {
		t.Errorf("renamed to %q at %q, want the handle to stay %q", renamed.Name, renamed.Slug, "major")
	}
}

func TestPatchBoardRefusesAStaleRevision(t *testing.T) {
	boards, _, _, _ := newCore()
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	stale := board.Revision
	name := "Once"
	if _, err := boards.Patch(ctx, board.ID, entities.BoardPatch{Name: &name}, &stale, "alex"); err != nil {
		t.Fatal(err)
	}
	name = "Twice"
	_, err = boards.Patch(ctx, board.ID, entities.BoardPatch{Name: &name}, &stale, "someone")
	if !errors.Is(err, entities.ErrConflict) {
		t.Errorf("second write from the same revision = %v, want ErrConflict", err)
	}
}

// Deleting a board takes its cards with it: they belong to no other board.
func TestDeletingABoardTakesItsCardsWithIt(t *testing.T) {
	boards, flowNodes, _, _ := newCore()
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{Title: "Write it"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := boards.Delete(ctx, board.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Find(ctx, made[0].ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("the card survived its board: %v", err)
	}
}
