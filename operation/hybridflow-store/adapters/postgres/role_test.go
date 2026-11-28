package postgres

import (
	"context"
	"errors"
	"slices"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestRoleFlowNodeRoundTrip(t *testing.T) {
	boards, nodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Roles"}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	request := services.NewFlowNodeRequest{
		Type: "role", Title: "Reviewers", RoleID: "reviewers",
		People:      []string{`"Alex Rivera" <alex@example.com>`, "Sam Lee"},
		Description: "Review proposed changes.",
	}
	created, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{request, {Title: "Review"}}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	id := created[0].ID
	role, err := nodes.Find(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if role.Type != entities.FlowNodeRole || role.RoleID != request.RoleID || role.RoleKind != entities.RoleKindHuman ||
		role.Description != request.Description || role.Task != nil || !slices.Equal(role.People, request.People) {
		t.Fatalf("stored role = %+v", role)
	}
	if _, err := nodes.StartPlay(ctx, id, "run", "tester"); !errors.Is(err, entities.ErrFlowNodeNotRunnable) {
		t.Fatalf("play role: %v", err)
	}
	if _, err := nodes.Chain(ctx, created[1].ID, id, "tester"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("chain to role: %v", err)
	}
	if _, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{request}, "tester"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("duplicate role ID: %v", err)
	}
	description := "  Review each release.  "
	agent := entities.RoleKindAgent
	role, err = nodes.Patch(ctx, id, entities.FlowNodePatch{Description: &description, RoleKind: &agent}, &role.Revision, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if role.Description != "Review each release." || role.RoleID != request.RoleID || !slices.Equal(role.People, request.People) {
		t.Fatalf("role with updated description = %+v", role)
	}
	renamed, nobody := "editors", []string{}
	role, err = nodes.Patch(ctx, id, entities.FlowNodePatch{RoleID: &renamed, People: &nobody}, &role.Revision, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if role.ID != id || role.RoleID != renamed || role.RoleKind != agent || len(role.People) != 0 || role.Description != "Review each release." {
		t.Fatalf("patched role = %+v", role)
	}
	archived := true
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Archived: &archived}, nil, "tester"); err != nil {
		t.Fatal(err)
	}
	request.RoleID = renamed
	if _, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{request}, "tester"); err != nil {
		t.Fatal(err)
	}
	archived = false
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Archived: &archived}, nil, "tester"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("restore duplicate role ID: %v", err)
	}
	human := entities.FlowNodeHuman
	flowNode, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Type: &human}, nil, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if flowNode.RoleID != "" || flowNode.RoleKind != "" || len(flowNode.People) != 0 || flowNode.Description != "" {
		t.Fatalf("retyped flow node = %+v", flowNode)
	}
	roleType := entities.FlowNodeRole
	flowNode, err = nodes.Patch(ctx, id, entities.FlowNodePatch{Type: &roleType}, &flowNode.Revision, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if flowNode.RoleKind != entities.RoleKindHuman {
		t.Fatalf("flow node retyped to role has kind %q", flowNode.RoleKind)
	}
}

func TestRoleKindMigrationPreservesExistingRoles(t *testing.T) {
	ctx := context.Background()
	pool := testPoolAtVersion(t, 50)
	if _, err := pool.Exec(ctx, `
		INSERT INTO board (id, name, slug) VALUES
			('11111111-1111-4111-8111-111111111111', 'Roles', 'roles');
		INSERT INTO flow_node (id, board_id, title, type, status, role_id) VALUES
			('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
			 'Reviewers', 'role', 'ready', 'reviewers')`); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var kind entities.RoleKind
	if err := pool.QueryRow(ctx, `SELECT role_kind FROM flow_node WHERE role_id = 'reviewers'`).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != entities.RoleKindHuman {
		t.Fatalf("existing role has kind %q", kind)
	}
}
