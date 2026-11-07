package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestAgentPublicationsRetainConfigurationAndArchiveHistory(t *testing.T) {
	_, _, agents, _ := newCore()
	ctx := context.Background()
	draft, err := agents.Create(ctx, services.NewAgentRequest{
		Name: "Reviewer", Platform: "claude", Model: "opus", Instructions: "Review carefully.",
		Description: "For code reviews.", ProfileID: "account-a",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if draft.Published != nil {
		t.Fatal("a new draft is already published")
	}
	first, err := agents.Publish(ctx, draft.ID, &draft.Revision, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if first.Published == nil || first.Published.Version != 1 || first.Published.Instructions != "Review carefully." {
		t.Fatalf("first publication = %+v", first)
	}
	if _, err := agents.Publish(ctx, draft.ID, &draft.Revision, "alex"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale publication = %v", err)
	}
	model, instructions := "retired-model", "New instructions."
	changed, err := agents.Patch(ctx, draft.ID, entities.AgentPatch{Model: &model, Instructions: &instructions}, &first.Revision, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if changed.Published.Model != "opus" || changed.Published.Instructions != "Review carefully." {
		t.Fatal("draft edits changed the publication")
	}
	second, err := agents.Publish(ctx, draft.ID, &changed.Revision, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if second.Published.Version != 2 || second.Published.Model != model {
		t.Fatalf("second publication = %+v", second.Published)
	}
	archived := true
	if _, err := agents.Patch(ctx, draft.ID, entities.AgentPatch{Archived: &archived}, &second.Revision, "alex"); err != nil {
		t.Fatal(err)
	}
	active, err := agents.List(ctx)
	if err != nil || len(active) != 0 {
		t.Fatalf("active agents = %+v, %v", active, err)
	}
	all, err := agents.List(ctx, true)
	if err != nil || len(all) != 1 || !all[0].Archived || all[0].Model != model {
		t.Fatalf("archived agents = %+v, %v", all, err)
	}
	versions, err := agents.Versions(ctx, draft.ID)
	if err != nil || len(versions) != 2 || versions[0].Model != "opus" || versions[1].Model != model {
		t.Fatalf("history = %+v, %v", versions, err)
	}
	if versions[0].ProfileID != "account-a" || versions[0].Description != "For code reviews." || versions[0].PublishedAt.IsZero() {
		t.Fatalf("incomplete configuration = %+v", versions[0])
	}
	if _, err := agents.Publish(ctx, draft.ID, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("publishing an archive = %v", err)
	}
	if err := agents.Delete(ctx, draft.ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("deleting history = %v", err)
	}
	archived = false
	if _, err := agents.Patch(ctx, draft.ID, entities.AgentPatch{Archived: &archived}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	active, err = agents.List(ctx)
	if err != nil || len(active) != 1 {
		t.Fatalf("restored agents = %+v, %v", active, err)
	}
}
