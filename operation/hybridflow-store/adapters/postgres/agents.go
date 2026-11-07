package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// AgentStore is ports.AgentRepository over PostgreSQL: the managed agents, each on its own row,
// each with a revision of its own.
//
// It is a store of its own rather than a method set on the board's, for the reason the port is one:
// an agent belongs to no board, so nothing here joins to one, filters by one, or cascades from one.
type AgentStore struct {
	pool *pgxpool.Pool
}

// NewAgentStore wires the store to a pool.
func NewAgentStore(pool *pgxpool.Pool) *AgentStore { return &AgentStore{pool: pool} }

var _ ports.AgentRepository = (*AgentStore)(nil)

const agentColumns = `id, name, platform, model, profile_id, description, instructions, created_at, updated_at, revision, archived,
    (SELECT configuration FROM agent_version WHERE agent_id = agent.id ORDER BY version DESC LIMIT 1)`

func scanAgent(row pgx.Row) (*entities.Agent, error) {
	var agent entities.Agent
	var published []byte
	err := row.Scan(&agent.ID, &agent.Name, &agent.Platform, &agent.Model, &agent.ProfileID, &agent.Description, &agent.Instructions,
		&agent.CreatedAt, &agent.UpdatedAt, &agent.Revision, &agent.Archived, &published)
	if err != nil {
		return nil, err
	}
	if published != nil {
		if err := json.Unmarshal(published, &agent.Published); err != nil {
			return nil, err
		}
	}
	return &agent, nil
}

func (s *AgentStore) CreateAgent(ctx context.Context, agent *entities.Agent, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO agent (id, name, platform, model, profile_id, description, instructions, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			agent.ID, agent.Name, string(agent.Platform), agent.Model, agent.ProfileID, agent.Description, agent.Instructions,
			agent.CreatedAt, agent.UpdatedAt, agent.Revision)
		return translate(err, fmt.Sprintf("agent %q", agent.Name))
	})
}

func (s *AgentStore) ListAgents(ctx context.Context) ([]entities.Agent, error) {
	// Ordered by name, because the panel listing them is a list a person reads. By the database's
	// own rule rather than by "C", for the same reason the boards page is: this one is for human
	// eyes, not for a total order a rank depends on.
	rows, err := s.pool.Query(ctx, `SELECT `+agentColumns+` FROM agent ORDER BY lower(name)`)
	if err != nil {
		return nil, translate(err, "the agents")
	}
	defer rows.Close()
	out := []entities.Agent{}
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *agent)
	}
	return out, rows.Err()
}

func (s *AgentStore) FindAgent(ctx context.Context, id string) (*entities.Agent, error) {
	// Compared as text rather than cast: an id that is not a uuid misses rather than failing the
	// cast, which is what a card naming an engine — a board written before agents — must do.
	row := s.pool.QueryRow(ctx, `SELECT `+agentColumns+` FROM agent WHERE id::text = $1`, id)
	agent, err := scanAgent(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("agent %s", id))
	}
	return agent, nil
}

func (s *AgentStore) PatchAgent(ctx context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error) {
	set := newAssignments()
	if patch.Name != nil {
		set.add("name", *patch.Name)
	}
	if patch.Platform != nil {
		set.add("platform", string(*patch.Platform))
	}
	if patch.ProfileID != nil {
		set.add("profile_id", *patch.ProfileID)
	}
	if patch.Model != nil {
		set.add("model", *patch.Model)
	}
	if patch.Instructions != nil {
		set.add("instructions", *patch.Instructions)
	}
	if patch.Description != nil {
		set.add("description", *patch.Description)
	}
	if patch.Archived != nil {
		set.add("archived", *patch.Archived)
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var agent *entities.Agent
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("agent", "id::text = ", id, expected)
		found, err := scanAgent(tx.QueryRow(ctx, sql+` RETURNING `+agentColumns, args...))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return whyNoRows(ctx, s.pool, "agent", "id::text = ", id, expected)
			}
			return translate(err, fmt.Sprintf("agent %s", id))
		}
		agent = found
		return nil
	})
	return agent, err
}

func (s *AgentStore) DeleteAgent(ctx context.Context, id string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		var held string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM agent WHERE id::text = $1 FOR UPDATE`, id).Scan(&held); err != nil {
			return translate(err, fmt.Sprintf("agent %s", id))
		}
		var published bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_version WHERE agent_id::text = $1)`, id).Scan(&published); err != nil {
			return err
		}
		if published {
			return entities.Invalidf("published agents retain their history; archive this agent instead")
		}
		tag, err := tx.Exec(ctx, `DELETE FROM agent WHERE id::text = $1`, id)
		if err != nil {
			return translate(err, fmt.Sprintf("agent %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("agent %s", id)
		}
		// The flow nodes naming it are left as they are: they still say which agent they wanted, and
		// the next play says it is gone. There is deliberately no foreign key to cascade or to
		// refuse this.
		return nil
	})
}

func (s *AgentStore) PublishAgent(ctx context.Context, id string, expected *int64, at time.Time, actor string) (*entities.Agent, error) {
	var agent *entities.Agent
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		found, err := scanAgent(tx.QueryRow(ctx, `SELECT `+agentColumns+` FROM agent WHERE id::text = $1 FOR UPDATE`, id))
		if err != nil {
			return translate(err, fmt.Sprintf("agent %s", id))
		}
		if expected != nil && *expected != found.Revision {
			return entities.Conflictf("agent %s is at revision %d", id, found.Revision)
		}
		if found.Archived {
			return entities.Invalidf("an archived agent cannot be published")
		}
		var number int64
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(version), 0) + 1 FROM agent_version WHERE agent_id::text = $1`, id).Scan(&number); err != nil {
			return err
		}
		version := found.Publish(number, at)
		configuration, err := json.Marshal(version)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO agent_version (agent_id, version, configuration, published_at)
			VALUES ($1, $2, $3, $4)`, id, number, configuration, at); err != nil {
			return translate(err, "publishing the agent")
		}
		agent, err = scanAgent(tx.QueryRow(ctx, `UPDATE agent SET updated_at = $2 WHERE id::text = $1 RETURNING `+agentColumns, id, at))
		return err
	})
	return agent, err
}

func (s *AgentStore) AgentVersions(ctx context.Context, id string) ([]entities.AgentVersion, error) {
	rows, err := s.pool.Query(ctx, `SELECT configuration FROM agent_version WHERE agent_id::text = $1 ORDER BY version`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []entities.AgentVersion{}
	for rows.Next() {
		var data []byte
		var version entities.AgentVersion
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &version); err != nil {
			return nil, err
		}
		out = append(out, version)
	}
	return out, rows.Err()
}
