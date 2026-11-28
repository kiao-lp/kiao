package postgres

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestBoardFolderMigrationAndMembership(t *testing.T) {
	ctx := context.Background()
	pool := testPoolAtVersion(t, 44)
	const boardID = "bd50a449-11d9-4014-a807-98181c042308"
	if _, err := pool.Exec(ctx, `INSERT INTO board (id, name, slug, archived_at) VALUES ($1, 'Existing board', 'existing', now())`, boardID); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	boards := NewBoardStore(pool)
	folders := NewFolderStore(pool)
	ids := uuidIDs{store: boards}
	boardFolders := services.NewFolders(entities.BoardFolderScope, folders, ids)
	otherFolders := services.NewFolders("other", folders, ids)

	before, err := boards.FindBoardBySlug(ctx, "existing")
	if err != nil {
		t.Fatal(err)
	}
	if before.ID != boardID || before.FolderID != "" || !before.Archived() || before.Revision != 1 {
		t.Fatalf("migrated board = %+v", before)
	}

	planning, err := boardFolders.Create(ctx, "Planning")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := boardFolders.Create(ctx, "planning"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("duplicate name error = %v", err)
	}
	other, err := otherFolders.Create(ctx, "Planning")
	if err != nil {
		t.Fatal(err)
	}
	list, err := boardFolders.List(ctx)
	if err != nil || len(list) != 1 || list[0] != *planning {
		t.Fatalf("board folders = %+v, %v", list, err)
	}
	if _, err := boards.PatchBoard(ctx, boardID, entities.BoardPatch{FolderID: &other.ID}, nil, "owner"); !errors.Is(err, entities.ErrNotFound) {
		t.Fatalf("move to another scope error = %v", err)
	}

	boardService := services.NewBoards(boards, realClock{}, ids)
	if _, err := boardService.Create(ctx, services.NewBoardRequest{Name: "Nested", FolderID: other.ID}, "owner"); !errors.Is(err, entities.ErrNotFound) {
		t.Fatalf("create board in another scope error = %v", err)
	}
	nested, err := boardService.Create(ctx, services.NewBoardRequest{Name: "Nested", FolderID: planning.ID}, "owner")
	if err != nil {
		t.Fatal(err)
	}
	stored, err := boards.FindBoard(ctx, nested.ID)
	if err != nil || stored.Slug != "nested" || stored.FolderID != planning.ID || stored.Revision != 1 {
		t.Fatalf("board created in folder = %+v, %v", stored, err)
	}

	moved, err := boards.PatchBoard(ctx, boardID, entities.BoardPatch{FolderID: &planning.ID}, &before.Revision, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if moved.FolderID != planning.ID || moved.Slug != before.Slug || moved.Revision != before.Revision+1 {
		t.Fatalf("moved board = %+v", moved)
	}
	top := ""
	if _, err := boards.PatchBoard(ctx, boardID, entities.BoardPatch{FolderID: &top}, &before.Revision, "owner"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale move error = %v", err)
	}
	unfiled, err := boards.PatchBoard(ctx, boardID, entities.BoardPatch{FolderID: &top}, &moved.Revision, "owner")
	if err != nil || unfiled.FolderID != "" {
		t.Fatalf("move to top level = %+v, %v", unfiled, err)
	}
	moved, err = boards.PatchBoard(ctx, boardID, entities.BoardPatch{FolderID: &planning.ID}, &unfiled.Revision, "owner")
	if err != nil {
		t.Fatal(err)
	}
	changes := NewChangeStore(pool)
	cursor, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := boardFolders.Delete(ctx, planning.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	after, err := boards.FindBoardBySlug(ctx, "existing")
	if err != nil {
		t.Fatal(err)
	}
	if after.ID != before.ID || after.FolderID != "" || !after.Archived() || after.Revision != moved.Revision+1 {
		t.Fatalf("board after folder deletion = %+v", after)
	}
	events, _, err := changes.Since(ctx, cursor, boardID, 10)
	if err != nil || len(events) != 1 || events[0].Revision != after.Revision || events[0].Actor != "owner" {
		t.Fatalf("folder deletion board changes = %+v, %v", events, err)
	}
}
