package postgres

import (
	"context"
	"errors"
	"fmt"

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

const agentColumns = `id, name, platform, model, description, instructions, created_at, updated_at, revision`

func scanAgent(row pgx.Row) (*entities.Agent, error) {
	var agent entities.Agent
	err := row.Scan(&agent.ID, &agent.Name, &agent.Platform, &agent.Model, &agent.Description, &agent.Instructions,
		&agent.CreatedAt, &agent.UpdatedAt, &agent.Revision)
	if err != nil {
		return nil, err
	}
	return &agent, nil
}

func (s *AgentStore) CreateAgent(ctx context.Context, agent *entities.Agent, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO agent (id, name, platform, model, description, instructions, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			agent.ID, agent.Name, string(agent.Platform), agent.Model, agent.Description, agent.Instructions,
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
	if patch.Model != nil {
		set.add("model", *patch.Model)
	}
	if patch.Instructions != nil {
		set.add("instructions", *patch.Instructions)
	}
	if patch.Description != nil {
		set.add("description", *patch.Description)
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
