package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"kiao/hybridflow-store/core/entities"
)

func TestAgentPublicationsAreAtomicAndImmutable(t *testing.T) {
	pool := testPool(t)
	store := NewAgentStore(pool)
	ctx := context.Background()
	now := time.Now().UTC()
	agent := &entities.Agent{ID: "00000000-0000-4000-8000-000000000099", Name: "Reviewer",
		Platform: entities.PlatformClaude, Model: "old-model", Instructions: "Original orders.",
		ProfileID: "account-a", CreatedAt: now, UpdatedAt: now, Revision: 1}
	if err := store.CreateAgent(ctx, agent, "alex"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errorsSeen := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.PublishAgent(ctx, agent.ID, &agent.Revision, now, "alex")
			errorsSeen <- err
		}()
	}
	wg.Wait()
	close(errorsSeen)
	successes, conflicts := 0, 0
	for err := range errorsSeen {
		if err == nil {
			successes++
		} else if errors.Is(err, entities.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes = %d, conflicts = %d", successes, conflicts)
	}
	model := "replacement-model"
	changed, err := store.PatchAgent(ctx, agent.ID, entities.AgentPatch{Model: &model}, nil, "alex")
	if err != nil || changed.Published == nil || changed.Published.Model != "old-model" {
		t.Fatalf("draft = %+v, %v", changed, err)
	}
	second, err := store.PublishAgent(ctx, agent.ID, &changed.Revision, now, "alex")
	if err != nil || second.Published.Version != 2 || second.Published.Model != model {
		t.Fatalf("publication = %+v, %v", second, err)
	}
	versions, err := store.AgentVersions(ctx, agent.ID)
	if err != nil || len(versions) != 2 || versions[0].Model != "old-model" || versions[0].ProfileID != "account-a" {
		t.Fatalf("history = %+v, %v", versions, err)
	}
	for _, sql := range []string{`UPDATE agent_version SET configuration = '{}' WHERE agent_id = $1`, `DELETE FROM agent_version WHERE agent_id = $1`} {
		if _, err := pool.Exec(ctx, sql, agent.ID); err == nil {
			t.Fatal("published history was changed")
		}
	}
	if err := store.DeleteAgent(ctx, agent.ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("delete publication = %v", err)
	}
	errorsSeen = make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.PublishAgent(ctx, agent.ID, nil, now, "alex")
			errorsSeen <- err
		}()
	}
	wg.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatalf("unconditional publication: %v", err)
		}
	}
	versions, err = store.AgentVersions(ctx, agent.ID)
	if err != nil || len(versions) != 10 || versions[9].Version != 10 {
		t.Fatalf("concurrent publication history = %+v, %v", versions, err)
	}
}

func TestAgentPublicationMigrationPreservesExistingDefinitions(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DROP TABLE agent_version;
		DROP FUNCTION retain_agent_version();
		ALTER TABLE agent DROP COLUMN archived;
		DELETE FROM schema_migration WHERE version = 28;
		INSERT INTO agent(id, name, platform, model, profile_id, description, instructions)
		VALUES ('00000000-0000-4000-8000-000000000098', 'Existing', 'pi', 'provider/retired', 'account-a', 'Selection guidance', 'Keep these orders.');`); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	agent, err := NewAgentStore(pool).FindAgent(ctx, "00000000-0000-4000-8000-000000000098")
	if err != nil || agent.Published == nil || agent.Published.Version != 1 || agent.Archived {
		t.Fatalf("upgraded agent = %+v, %v", agent, err)
	}
	version := agent.Published
	if version.Model != agent.Model || version.ProfileID != agent.ProfileID || version.Instructions != agent.Instructions || version.Description != agent.Description {
		t.Fatalf("configuration was lost: %+v", version)
	}
}
