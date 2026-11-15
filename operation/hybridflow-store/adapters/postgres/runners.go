package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// RunnerStore is ports.RunnerRepository over PostgreSQL: the runners, each on its own row, each
// with a revision of its own.
//
// It is a store of its own rather than a method set on the board's, for the reason the port is one:
// a runner belongs to no board, so nothing here joins to one, filters by one, or cascades from one.
type RunnerStore struct {
	pool *pgxpool.Pool
}

// NewRunnerStore wires the store to a pool.
func NewRunnerStore(pool *pgxpool.Pool) *RunnerStore { return &RunnerStore{pool: pool} }

var _ ports.RunnerRepository = (*RunnerStore)(nil)

const runnerColumns = `id, name, last_seen, created_at, updated_at, revision`

func scanRunner(row pgx.Row) (*entities.Runner, error) {
	var runner entities.Runner
	err := row.Scan(&runner.ID, &runner.Name, &runner.LastSeen,
		&runner.CreatedAt, &runner.UpdatedAt, &runner.Revision)
	if err != nil {
		return nil, err
	}
	return &runner, nil
}

func (s *RunnerStore) CreateRunner(ctx context.Context, runner *entities.Runner, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO runner (id, name, last_seen, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			runner.ID, runner.Name, runner.LastSeen,
			runner.CreatedAt, runner.UpdatedAt, runner.Revision)
		return translate(err, fmt.Sprintf("runner %q", runner.Name))
	})
}

func (s *RunnerStore) ListRunners(ctx context.Context) ([]entities.Runner, error) {
	// Ordered by name, because the panel listing them is a list a person reads. By the database's
	// own rule rather than by "C", for the same reason the boards page is: this one is for human
	// eyes, not for a total order a rank depends on.
	rows, err := s.pool.Query(ctx, `SELECT `+runnerColumns+` FROM runner ORDER BY lower(name)`)
	if err != nil {
		return nil, translate(err, "the runners")
	}
	defer rows.Close()
	out := []entities.Runner{}
	for rows.Next() {
		runner, err := scanRunner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *runner)
	}
	return out, rows.Err()
}

func (s *RunnerStore) FindRunner(ctx context.Context, id string) (*entities.Runner, error) {
	// Compared as text rather than cast: an id that is not a uuid misses rather than failing the
	// cast.
	row := s.pool.QueryRow(ctx, `SELECT `+runnerColumns+` FROM runner WHERE id::text = $1`, id)
	runner, err := scanRunner(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("runner %s", id))
	}
	return runner, nil
}

func (s *RunnerStore) PatchRunner(ctx context.Context, id string, patch entities.RunnerPatch, expected *int64, actor string) (*entities.Runner, error) {
	set := newAssignments()
	if patch.Name != nil {
		set.add("name", *patch.Name)
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var runner *entities.Runner
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("runner", "id::text = ", id, expected)
		found, err := scanRunner(tx.QueryRow(ctx, sql+` RETURNING `+runnerColumns, args...))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return whyNoRows(ctx, s.pool, "runner", "id::text = ", id, expected)
			}
			return translate(err, fmt.Sprintf("runner %s", id))
		}
		runner = found
		return nil
	})
	return runner, err
}

func (s *RunnerStore) DeleteRunner(ctx context.Context, id string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM runner WHERE id::text = $1`, id)
		if err != nil {
			return translate(err, fmt.Sprintf("runner %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("runner %s", id)
		}
		// The tasks naming it are left as they are: they still say which runner they wanted, and
		// the next play says it is gone. There is deliberately no foreign key to cascade or to
		// refuse this.
		return nil
	})
}

// Heartbeat stamps last seen with now, and nothing else: the row's triggers fire on a rename
// alone, so a heartbeat moves neither the revision — renaming a runner would otherwise race it —
// nor the change feed, which no client redraws a heartbeat on.
func (s *RunnerStore) Heartbeat(ctx context.Context, id string, now time.Time, actor string) (*entities.Runner, error) {
	var runner *entities.Runner
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		found, err := scanRunner(tx.QueryRow(ctx, `
			UPDATE runner SET last_seen = $1 WHERE id::text = $2
			RETURNING `+runnerColumns, now, id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return entities.NotFoundf("runner %s", id)
			}
			return translate(err, fmt.Sprintf("runner %s", id))
		}
		runner = found
		return nil
	})
	return runner, err
}
