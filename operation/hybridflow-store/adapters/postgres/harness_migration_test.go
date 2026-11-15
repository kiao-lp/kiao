package postgres

import (
	"context"
	"testing"
)

func TestHarnessMigrationPreservesAgentsAndPublishedConfigurations(t *testing.T) {
	pool := testPoolAtVersion(t, 34)
	ctx := context.Background()
	const id = "11111111-1111-4111-8111-111111111111"
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent(id, name, platform, model, profile_id, description, instructions)
		VALUES ($1, 'Reviewer', 'pi', 'provider/model', 'account', 'Choose this agent', 'agent platform')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_version(agent_id, version, configuration, published_at)
		SELECT id, n, jsonb_build_object('agentId', id, 'version', n, 'name', name,
			'platform', platform, 'model', model, 'profileId', profile_id, 'description', description,
			'instructions', instructions, 'publishedAt', updated_at), updated_at
		FROM agent CROSS JOIN generate_series(1, 2) AS n`); err != nil {
		t.Fatal(err)
	}
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT revision FROM agent WHERE id = $1`, id).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	agent, err := NewAgentStore(pool).FindAgent(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if agent.ID != id || agent.Harness != "pi" || agent.Revision != revision || agent.Instructions != "agent platform" {
		t.Fatalf("agent changed during upgrade: %+v", agent)
	}
	versions, err := NewAgentStore(pool).AgentVersions(ctx, id)
	if err != nil || len(versions) != 2 {
		t.Fatalf("publication history: %+v, %v", versions, err)
	}
	for _, version := range versions {
		if version.AgentID != id || version.Harness != "pi" || version.ProfileID != "account" ||
			version.Model != "provider/model" || version.Instructions != "agent platform" {
			t.Fatalf("published configuration changed: %+v", version)
		}
	}
	var oldKeys int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM agent_version WHERE configuration ? 'platform'`).Scan(&oldKeys); err != nil || oldKeys != 0 {
		t.Fatalf("legacy snapshot keys remain: %d, %v", oldKeys, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_version SET configuration = '{}' WHERE agent_id = $1`, id); err == nil {
		t.Fatal("published configurations must remain immutable")
	}
}
