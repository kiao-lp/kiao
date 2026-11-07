package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// BoardStore is ports.BoardRepository over PostgreSQL.
//
// Three habits run through every method here, and they are the adapter's whole contribution to the
// concurrency story:
//
//   - **A write is a transaction that names its actor**, so the change log written by the triggers
//     says who did it (see inTx).
//   - **A conditional write is one statement.** A claim, a release, a revision-checked patch: each
//     is a single `UPDATE … WHERE …` whose row count is the answer. Nothing reads a row, decides,
//     and writes it back — that shape is the one that loses a race.
//   - **A patch updates the columns it was given.** The SQL is assembled from the fields the patch
//     names, so two writers touching two fields of one card are two `UPDATE`s that do not overlap.
type BoardStore struct {
	pool *pgxpool.Pool
}

// NewBoardStore wires the store to a pool.
func NewBoardStore(pool *pgxpool.Pool) *BoardStore { return &BoardStore{pool: pool} }

var _ ports.BoardRepository = (*BoardStore)(nil)

// ── boards ────────────────────────────────────────────────────────────────────

const boardColumns = `id, name, slug, created_at, updated_at, revision, archived_at`

func scanBoard(row pgx.Row) (*entities.Board, error) {
	var (
		board    entities.Board
		archived *time.Time
	)
	err := row.Scan(&board.ID, &board.Name, &board.Slug,
		&board.CreatedAt, &board.UpdatedAt, &board.Revision, &archived)
	if err != nil {
		return nil, err
	}
	if archived != nil {
		board.ArchivedAt = *archived
	}
	return &board, nil
}

func (s *BoardStore) CreateBoard(ctx context.Context, board *entities.Board, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO board (id, name, slug, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			board.ID, board.Name, board.Slug,
			board.CreatedAt, board.UpdatedAt, board.Revision)
		if err != nil {
			return translate(err, fmt.Sprintf("board %q", board.Name))
		}
		return nil
	})
}

func (s *BoardStore) ListBoards(ctx context.Context, filter ports.BoardFilter) ([]entities.Board, error) {
	where := "WHERE archived_at IS NULL"
	if filter.IncludeArchived {
		where = ""
	}
	// Ordered by name, because the boards page is a list a person reads. Collated by the database's
	// own rule here rather than by "C": this one is for human eyes, not for a total order a rank
	// depends on.
	rows, err := s.pool.Query(ctx, `SELECT `+boardColumns+` FROM board `+where+` ORDER BY lower(name)`)
	if err != nil {
		return nil, translate(err, "the boards")
	}
	defer rows.Close()
	out := []entities.Board{}
	for rows.Next() {
		board, err := scanBoard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *board)
	}
	return out, rows.Err()
}

func (s *BoardStore) FindBoard(ctx context.Context, id string) (*entities.Board, error) {
	// The id is a uuid and a slug is not, so a handle that is not a uuid would fail the cast rather
	// than miss: it is compared as text, and the service falls through to the slug lookup.
	row := s.pool.QueryRow(ctx, `SELECT `+boardColumns+` FROM board WHERE id::text = $1`, id)
	board, err := scanBoard(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("board %s", id))
	}
	return board, nil
}

func (s *BoardStore) FindBoardBySlug(ctx context.Context, slug string) (*entities.Board, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+boardColumns+` FROM board WHERE slug = $1`, slug)
	board, err := scanBoard(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("board %q", slug))
	}
	return board, nil
}

func (s *BoardStore) PatchBoard(ctx context.Context, id string, patch entities.BoardPatch, expected *int64, actor string) (*entities.Board, error) {
	set := newAssignments()
	if patch.Name != nil {
		set.add("name", *patch.Name)
	}
	if patch.Archive != nil {
		if *patch.Archive {
			set.raw("archived_at = now()")
		} else {
			set.raw("archived_at = NULL")
		}
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var board *entities.Board
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("board", "id::text = ", id, expected)
		row := tx.QueryRow(ctx, sql+` RETURNING `+boardColumns, args...)
		found, err := scanBoard(row)
		if err != nil {
			return s.missed(ctx, err, "board", "id::text = ", id, expected)
		}
		board = found
		return nil
	})
	return board, err
}

func (s *BoardStore) DeleteBoard(ctx context.Context, id string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM board WHERE id::text = $1`, id)
		if err != nil {
			return translate(err, fmt.Sprintf("board %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("board %s", id)
		}
		return nil
	})
}

// ── the assignment list a patch becomes ───────────────────────────────────────
//
// A patch names some fields; the SQL has to name exactly those. Built rather than written out,
// because the alternative is one `UPDATE` per combination of fields — and the combination is
// whatever two clients happened to send.

type assignments struct {
	parts []string
	args  []any
}

func newAssignments() *assignments { return &assignments{} }

func (a *assignments) add(column string, value any) {
	a.args = append(a.args, value)
	a.parts = append(a.parts, fmt.Sprintf("%s = $%d", column, len(a.args)))
}

// addExpr assigns an expression that mentions the value once, as `%s`. What a cast needs.
func (a *assignments) addExpr(format string, value any) {
	a.args = append(a.args, value)
	a.parts = append(a.parts, fmt.Sprintf(format, fmt.Sprintf("$%d", len(a.args))))
}

// raw assigns something with no value of its own.
func (a *assignments) raw(part string) { a.parts = append(a.parts, part) }

func (a *assignments) empty() bool { return len(a.parts) == 0 }

// update builds the statement. `updated_at` and `revision` are **not** in it: a trigger does those,
// so that a row changed by hand in psql still tells every client it moved.
//
// expected is the revision the caller worked from. When it is given it goes into the WHERE, so the
// write either lands on that revision or lands nowhere — and "nowhere" comes back as no rows, which
// explainMiss turns into a conflict or a not-found by asking which it was.
func (a *assignments) update(table, keyExpr string, key any, expected *int64) (string, []any) {
	args := append([]any{}, a.args...)
	args = append(args, key)
	where := fmt.Sprintf("%s$%d", keyExpr, len(args))
	if expected != nil {
		args = append(args, *expected)
		where += fmt.Sprintf(" AND revision = $%d", len(args))
	}
	return fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, strings.Join(a.parts, ", "), where), args
}

// whyNoRows says why a conditional update matched nothing: the row is not there, or it is there at
// another revision. Worth the extra query — "conflict" and "not found" are two different things for
// the client, and a single answer covering both would have every stale write look like a delete.
//
// **It is asked whenever the write touched no row**, and the row count is the only thing that
// decides. Comparing the revision that came back instead would be a subtle trap: a stale write is
// refused because the revision has *moved*, and the revision it moved to is whatever the last
// writer left — almost never the one the caller sent, so a comparison against it reads as success.
func whyNoRows(ctx context.Context, pool *pgxpool.Pool, table, keyExpr, key string, expected *int64) error {
	var revision int64
	err := pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT revision FROM %s WHERE %s$1`, table, keyExpr), key).Scan(&revision)
	if err != nil {
		return entities.NotFoundf("%s %s", table, key)
	}
	if expected != nil {
		return entities.Conflictf("%s %s is at revision %d, not %d", table, key, revision, *expected)
	}
	// There, at some revision, and the update still matched nothing: the WHERE held something else
	// — a claim on a card another run holds is the one that gets here.
	return entities.Conflictf("%s %s could not be written as asked", table, key)
}

// missed is the pair every RETURNING-based write ends with: no rows is a miss to be explained, and
// anything else is a driver error to be translated.
func (s *BoardStore) missed(ctx context.Context, cause error, table, keyExpr, key string, expected *int64) error {
	if errors.Is(cause, pgx.ErrNoRows) {
		return whyNoRows(ctx, s.pool, table, keyExpr, key, expected)
	}
	return translate(cause, fmt.Sprintf("%s %s", table, key))
}

// jsonMap reads a jsonb column into the string map the settings carry. A column holding anything
// that is not an object of strings is read as nothing rather than refused: it is a carried field,
// and nothing in this build depends on it.
func jsonMap(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var out map[string]string
	if err := json.Unmarshal(raw, &out); err != nil || len(out) == 0 {
		return nil
	}
	return out
}

func jsonBytes(value any) ([]byte, error) {
	if value == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(value)
}

// decodeInto reads a jsonb column into its target, leaving it alone for a column holding null
// or something unreadable: a payload this build cannot parse is read as absent rather than as a
// row that will not open.
func decodeInto(raw []byte, out any) {
	if len(raw) == 0 {
		return
	}
	_ = json.Unmarshal(raw, out)
}
