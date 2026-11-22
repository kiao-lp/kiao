package postgres

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/lib/logging"
)

// ── The schema's history, and how it moves ────────────────────────────────────
//
// The schema is a numbered series of SQL scripts compiled into the binary, and the database keeps a
// **ledger** of which of them it has run. Starting the service applies whatever is missing, in
// order, each in its own transaction, and then serves. There is no separate migration step to
// remember and no way to serve against a schema the binary was not built for.
//
// Three rules, and each of them is one class of production accident:
//
//   - **An applied migration is frozen.** The ledger keeps the checksum of every script it ran, and
//     startup refuses to go on if one of them has changed — even by a comment. A database that ran
//     `V001` and a binary carrying a different `V001` do not disagree about one statement, they
//     disagree about what the tables *are*, and the only safe thing to do is stop and say so. Fix
//     what a past migration did in a new one.
//   - **One at a time, across processes.** A session advisory lock is taken before the ledger is
//     read, so two instances starting together do not both apply `V002`. The one that gets there
//     second waits, then finds nothing to do.
//   - **A migration is a transaction.** A script that fails halfway leaves nothing behind, and the
//     ledger never records a version that is only half there.
//
// The layout is deliberately the one worker uses for the *content* migrations in the repo
// root (`migrations/`, `V###__kebab-name.js`): a store's files and a store's database move the same
// way, and somebody reading one has already read the other.

//go:embed schema/*.sql
var schemaFS embed.FS

// migrationName is the shape a script's file name takes: `V###__kebab-case-name.sql`. The number
// orders them and the name is what the ledger and the log lines say.
var migrationName = regexp.MustCompile(`^V(\d+)__([a-z0-9-]+)\.sql$`)

// migrationLockKey is the advisory lock two starting instances contend for. An arbitrary constant,
// and the only thing that matters about it is that nothing else in this database uses it.
const migrationLockKey = 8_713_405_261

type migration struct {
	version  int
	name     string
	sql      string
	checksum string
}

// loadMigrations reads the embedded scripts in version order and refuses a series that is not one:
// a duplicate version, or a file that does not name itself the way the others do.
func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(schemaFS, "schema")
	if err != nil {
		return nil, fmt.Errorf("the embedded schema could not be read: %w", err)
	}
	out := make([]migration, 0, len(entries))
	seen := map[int]string{}
	for _, entry := range entries {
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("schema/%s is not named V###__kebab-name.sql", entry.Name())
		}
		version, err := strconv.Atoi(match[1])
		if err != nil {
			return nil, fmt.Errorf("schema/%s: %w", entry.Name(), err)
		}
		if held, taken := seen[version]; taken {
			return nil, fmt.Errorf("schema/%s and schema/%s are both version %d", held, entry.Name(), version)
		}
		seen[version] = entry.Name()
		body, err := schemaFS.ReadFile("schema/" + entry.Name())
		if err != nil {
			return nil, fmt.Errorf("schema/%s: %w", entry.Name(), err)
		}
		sum := sha256.Sum256(body)
		out = append(out, migration{
			version: version, name: match[2], sql: string(body),
			checksum: hex.EncodeToString(sum[:]),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// ledgerDDL creates the ledger. It is not a migration itself — nothing could record having applied
// it — so it is written here and is the one piece of schema that must stay backwards compatible for
// ever.
const ledgerDDL = `
CREATE TABLE IF NOT EXISTS schema_migration (
    version     integer     PRIMARY KEY,
    name        text        NOT NULL,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    duration_ms integer     NOT NULL
)`

// AppliedMigration is one line of the ledger, for the endpoint that reports the schema's history.
type AppliedMigration struct {
	Version    int       `json:"version"`
	Name       string    `json:"name"`
	Checksum   string    `json:"checksum"`
	AppliedAt  time.Time `json:"appliedAt"`
	DurationMs int       `json:"durationMs"`
}

// Migrate brings the database up to the schema this binary carries, and reports what it applied.
//
// It is called before the listener opens: serving a request against a schema half a version old is
// a bug with no symptom until the one query that needs the new column.
func Migrate(ctx context.Context, pool *pgxpool.Pool) ([]AppliedMigration, error) {
	scripts, err := loadMigrations()
	if err != nil {
		return nil, err
	}
	// A single connection for the whole pass: the advisory lock is session-scoped, so it has to be
	// taken and released on the same one.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("no connection for the schema pass: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationLockKey); err != nil {
		return nil, fmt.Errorf("could not take the migration lock: %w", err)
	}
	defer func() {
		if _, err := conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", migrationLockKey); err != nil {
			logging.DB.Warn("could not release the migration lock", "error", err)
		}
	}()

	if _, err := conn.Exec(ctx, ledgerDDL); err != nil {
		return nil, fmt.Errorf("could not create the migration ledger: %w", err)
	}
	applied, err := readLedger(ctx, conn)
	if err != nil {
		return nil, err
	}
	if err := checkFrozen(scripts, applied); err != nil {
		return nil, err
	}
	for _, script := range scripts {
		if _, done := applied[script.version]; done {
			continue
		}
		started := time.Now()
		if err := applyOne(ctx, conn, script, started); err != nil {
			return nil, err
		}
		logging.DB.Info("schema migration applied", "version", script.version, "name", script.name,
			"duration_ms", time.Since(started).Milliseconds())
	}
	return ledgerLines(ctx, conn)
}

// readLedger is what the database says it has run, by version.
func readLedger(ctx context.Context, conn pgxConn) (map[int]AppliedMigration, error) {
	rows, err := conn.Query(ctx, `SELECT version, name, checksum, applied_at, duration_ms FROM schema_migration`)
	if err != nil {
		return nil, fmt.Errorf("could not read the migration ledger: %w", err)
	}
	defer rows.Close()
	out := map[int]AppliedMigration{}
	for rows.Next() {
		var line AppliedMigration
		if err := rows.Scan(&line.Version, &line.Name, &line.Checksum, &line.AppliedAt, &line.DurationMs); err != nil {
			return nil, err
		}
		out[line.Version] = line
	}
	return out, rows.Err()
}

// checkFrozen is the rule that stops a deployment rather than letting it run on a schema nobody can
// describe. It compares the checksum of every script the database has already run, and refuses on a
// mismatch — and on a version the database has run that this binary does not carry, which is a
// binary older than its database.
func checkFrozen(scripts []migration, applied map[int]AppliedMigration) error {
	carried := map[int]migration{}
	for _, script := range scripts {
		carried[script.version] = script
	}
	versions := make([]int, 0, len(applied))
	for version := range applied {
		versions = append(versions, version)
	}
	sort.Ints(versions)
	for _, version := range versions {
		line := applied[version]
		script, held := carried[version]
		if !held {
			return fmt.Errorf("the database has applied V%03d__%s, which this build does not carry: "+
				"it was written by a newer version of the service, and running this one against it "+
				"would serve a schema it was not built for", version, line.Name)
		}
		if script.checksum != line.Checksum {
			return fmt.Errorf("V%03d__%s has changed since it was applied (ledger %s, build %s): "+
				"an applied migration is frozen, so fix what it did in a new migration rather than "+
				"in this one", version, line.Name, short(line.Checksum), short(script.checksum))
		}
	}
	return nil
}

func short(checksum string) string {
	if len(checksum) > 12 {
		return checksum[:12]
	}
	return checksum
}

// applyOne runs a script and records it, in one transaction: a script that fails halfway leaves
// nothing behind and no ledger line claiming it ran.
func applyOne(ctx context.Context, conn pgxConn, script migration, started time.Time) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("V%03d__%s: %w", script.version, script.name, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, script.sql); err != nil {
		return fmt.Errorf("V%03d__%s failed: %w", script.version, script.name, err)
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO schema_migration (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)`,
		script.version, script.name, script.checksum, int(time.Since(started).Milliseconds()))
	if err != nil {
		return fmt.Errorf("V%03d__%s: could not record it in the ledger: %w", script.version, script.name, err)
	}
	return tx.Commit(ctx)
}

// ledgerLines is the ledger in version order, which is what the schema endpoint reports.
func ledgerLines(ctx context.Context, conn pgxConn) ([]AppliedMigration, error) {
	applied, err := readLedger(ctx, conn)
	if err != nil {
		return nil, err
	}
	out := make([]AppliedMigration, 0, len(applied))
	for _, line := range applied {
		out = append(out, line)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// pgxConn is the little of a connection the pass uses, so that the functions above take a pooled
// connection and a test can hand them a plain one.
type pgxConn interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}
