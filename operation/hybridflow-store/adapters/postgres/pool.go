// Package postgres is the storage adapter: the ports of the core implemented over PostgreSQL, and
// the only package in this service that knows SQL exists.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/lib/logging"
)

// Options is what the adapter is built with. It is the adapter's own struct rather than the
// program's Config, so that nothing here depends on how the deployment is configured — which is
// what lets a test build a store against a throwaway database in two lines.
type Options struct {
	DatabaseURL string
	MaxConns    int
	// ChangeRetention is how long a row of the change log is kept. Zero keeps them for ever, which
	// is what a test wants and no deployment does.
	ChangeRetention time.Duration
}

// Open connects, brings the schema up to date, and returns the pool.
//
// **The schema pass happens here, before the pool is handed to anybody.** A service that served one
// request against a schema half a version old would be a bug with no symptom until the one query
// that needed the new column.
func Open(ctx context.Context, opts Options) (*pgxpool.Pool, []AppliedMigration, error) {
	cfg, err := pgxpool.ParseConfig(opts.DatabaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("the database URL could not be read: %w", err)
	}
	if opts.MaxConns > 0 {
		cfg.MaxConns = int32(opts.MaxConns)
	}
	// A connection that has been idle for half an hour is one the database or a proxy in between
	// may already have closed; taking it from the pool would fail the request that drew it.
	cfg.MaxConnIdleTime = 15 * time.Minute
	cfg.MaxConnLifetime = time.Hour
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("the connection pool could not be built: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, nil, fmt.Errorf("the database is not reachable: %w", err)
	}
	applied, err := Migrate(ctx, pool)
	if err != nil {
		pool.Close()
		return nil, nil, err
	}
	logging.DB.Info("database ready", "schema_version", schemaVersion(applied), "max_conns", cfg.MaxConns)
	return pool, applied, nil
}

func schemaVersion(applied []AppliedMigration) int {
	if len(applied) == 0 {
		return 0
	}
	return applied[len(applied)-1].Version
}

// ── the actor, and why every write opens a transaction ────────────────────────
//
// The change log is written by triggers, and a trigger has no arguments: the only way to tell it
// who is writing is a transaction-local setting. So every write here runs in a transaction that
// sets `kiao.actor` first — which also means every write is atomic, and a multi-row write cannot
// leave half of itself behind.
//
// `set_config` with a parameter rather than `SET LOCAL`, because `SET` takes a literal and this
// value comes from a token.

// inTx runs body in a transaction whose actor is set, and commits if body returns no error.
func inTx(ctx context.Context, pool *pgxpool.Pool, actor string, body func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("could not begin a transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('kiao.actor', $1, true)`, actor); err != nil {
		return fmt.Errorf("could not record the actor: %w", err)
	}
	if err := body(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── what the database says went wrong, in the core's words ────────────────────

// PostgreSQL error codes this adapter reads. Anything else is somebody's bug and becomes a 500.
const (
	codeUniqueViolation     = "23505"
	codeForeignKeyViolation = "23503"
	codeCheckViolation      = "23514"
)

// translate turns a driver error into one of the core's sentinels, so that no caller outside this
// package has to know what a `23505` is. A constraint is named after what it protects, which is
// what lets one code mean two different things here and say the right one.
func translate(err error, what string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.NotFoundf("%s", what)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case codeUniqueViolation:
		switch pgErr.ConstraintName {
		case "board_name_key":
			return entities.ErrNameTaken
		case "agent_name_key":
			return entities.ErrAgentNameTaken
		case "runner_name_key":
			return entities.ErrRunnerNameTaken
		case "board_slug_key":
			return entities.Conflictf("that board handle is taken")
		case "flow_node_tag_word_key":
			return entities.Invalidf("a card wears each tag once")
		default:
			return entities.Conflictf("%s already exists (%s)", what, pgErr.ConstraintName)
		}
	case codeForeignKeyViolation:
		// A chain onto a card that has gone, a task for a card that is not there: all of them are
		// the caller naming something absent.
		return entities.NotFoundf("%s names something this store does not hold (%s)", what, pgErr.ConstraintName)
	case codeCheckViolation:
		return entities.Invalidf("%s is not a shape this store accepts (%s)", what, pgErr.ConstraintName)
	}
	return fmt.Errorf("%s: %w", what, err)
}

// PruneChanges drops change rows older than the retention window and reports how many went. Called
// at startup and then daily: the feed is a cursor, not an archive.
func PruneChanges(ctx context.Context, pool *pgxpool.Pool, retention time.Duration) (int64, error) {
	if retention <= 0 {
		return 0, nil
	}
	tag, err := pool.Exec(ctx, `DELETE FROM change_event WHERE at < now() - $1::interval`,
		fmt.Sprintf("%d seconds", int64(retention.Seconds())))
	if err != nil {
		return 0, fmt.Errorf("could not prune the change log: %w", err)
	}
	return tag.RowsAffected(), nil
}
