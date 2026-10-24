package postgres

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
	"kiao/hybridflow-store/lib/logging"
)

// ── Being told, rather than asking ────────────────────────────────────────────
//
// Every write appends a row to `change_event` from a trigger, and `pg_notify` announces its
// sequence number. This adapter is the reading end: `Since` hands back the rows after a cursor, and
// `Await` blocks until there are some.
//
// **One connection listens for the whole process**, not one per waiting client. A board open in
// three tabs and a runner following the same board are four waiters, and four LISTEN connections
// would be four of the eight the pool has. So the listener keeps the high-water mark and wakes
// everybody who is behind it — which is also what makes the wait cheap enough to be the default.
//
// The fallback matters as much as the mechanism: if the listening connection dies, `Await` returns
// after a short sleep instead of failing, and the caller polls. A missed notification then costs a
// second of latency rather than a client that never updates again.
type ChangeStore struct {
	pool *pgxpool.Pool

	mu sync.Mutex
	// latest is the highest sequence number the listener has seen announced. It is a hint: `Since`
	// reads the table, and this only decides when to bother.
	latest int64
	// waiters are the channels to close when the log moves. Closed rather than sent to, so a waiter
	// that has gone away costs nothing and no send can block.
	waiters []chan struct{}
	// listening says the LISTEN connection is up. When it is not, Await falls back to a short sleep.
	listening bool
}

// NewChangeStore wires the reading end. Listen must be started for Await to be a wait rather than a
// sleep.
func NewChangeStore(pool *pgxpool.Pool) *ChangeStore { return &ChangeStore{pool: pool} }

var _ ports.ChangeLog = (*ChangeStore)(nil)

// Listen holds a connection on `LISTEN kiao_hybridflow` and wakes the waiters. It returns when ctx
// ends; the program runs it in a goroutine for the life of the process, and it reconnects on its
// own, because a database restart must not cost every client its live updates for ever.
func (s *ChangeStore) Listen(ctx context.Context) {
	for ctx.Err() == nil {
		if err := s.listenOnce(ctx); err != nil && ctx.Err() == nil {
			logging.DB.Warn("the change listener dropped; clients will poll until it is back", "error", err)
			select {
			case <-ctx.Done():
			case <-time.After(2 * time.Second):
			}
		}
	}
}

func (s *ChangeStore) listenOnce(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN kiao_hybridflow"); err != nil {
		return err
	}
	s.setListening(true)
	defer s.setListening(false)
	logging.DB.Info("listening for changes")
	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		seq, err := strconv.ParseInt(notification.Payload, 10, 64)
		if err != nil {
			continue
		}
		s.advance(seq)
	}
}

func (s *ChangeStore) setListening(up bool) {
	s.mu.Lock()
	s.listening = up
	var waiters []chan struct{}
	if !up {
		// Everybody waiting is released, so a dropped listener turns into polling immediately
		// rather than into a wait that will never be woken.
		waiters = s.waiters
		s.waiters = nil
	}
	s.mu.Unlock()
	for _, waiter := range waiters {
		close(waiter)
	}
}

// advance returns the highest committed cursor seen and releases the waiters only when it moves.
// Latest also calls it on reads: waking on an unchanged cursor would make idle clients repeatedly
// wake each other.
func (s *ChangeStore) advance(seq int64) int64 {
	s.mu.Lock()
	if seq <= s.latest {
		latest := s.latest
		s.mu.Unlock()
		return latest
	}
	s.latest = seq
	waiters := s.waiters
	s.waiters = nil
	s.mu.Unlock()
	for _, waiter := range waiters {
		close(waiter)
	}
	return seq
}

// Since is the changes after seq, oldest first, and the latest sequence number the log holds.
func (s *ChangeStore) Since(ctx context.Context, seq int64, boardID string, limit int) ([]entities.Change, int64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	args := []any{seq, limit}
	where := "seq > $1"
	if boardID != "" {
		args = append(args, boardID)
		// A client watching one board is told about that board and the cards on it, and about
		// nothing else — which is what keeps a tab showing one board idle while another plays.
		where += " AND board_id::text = $3"
	}
	rows, err := s.pool.Query(ctx, `
		SELECT seq, at, scope, kind, coalesce(board_id::text, ''),
			coalesce(flow_node_id::text, ''), coalesce(flow_node_class_id::text, ''),
			coalesce(agent_id::text, ''),
			coalesce(runner_id::text, ''),
			coalesce(workflow_id::text, ''), coalesce(workflow_class_id::text, ''),
			actor, coalesce(revision, 0)
		FROM change_event WHERE `+where+` ORDER BY seq LIMIT $2`, args...)
	if err != nil {
		return nil, 0, translate(err, "the changes")
	}
	defer rows.Close()
	out := []entities.Change{}
	for rows.Next() {
		var change entities.Change
		if err := rows.Scan(&change.Seq, &change.At, &change.Scope, &change.Kind, &change.BoardID,
			&change.FlowNodeID, &change.FlowNodeClassID, &change.AgentID, &change.RunnerID,
			&change.WorkflowID, &change.WorkflowClassID,
			&change.Actor, &change.Revision); err != nil {
			return nil, 0, err
		}
		out = append(out, change)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	latest, err := s.Latest(ctx)
	return out, latest, err
}

// Latest is the sequence number a client should start watching from.
func (s *ChangeStore) Latest(ctx context.Context) (int64, error) {
	var latest int64
	// `last_value` of the sequence would be cheaper and is wrong: it counts rows that a rolled-back
	// transaction consumed, so a client given it would wait for a change that never lands.
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(seq), 0) FROM change_event`).Scan(&latest)
	if err != nil {
		return 0, translate(err, "the change cursor")
	}
	// Retention can empty the table, but a cursor already seen committed must not rewind:
	// Await would otherwise keep waking on the listener's higher mark until the timeout.
	return s.advance(latest), nil
}

// Await blocks until the log passes seq, or ctx ends, and reports whether it did.
//
// It registers *before* re-reading the mark, so a change landing between the two is not missed —
// the waiter is already in the list when the listener releases it.
func (s *ChangeStore) Await(ctx context.Context, seq int64) bool {
	s.mu.Lock()
	if s.latest > seq {
		s.mu.Unlock()
		return true
	}
	if !s.listening {
		s.mu.Unlock()
		// No listener: a short sleep, and the caller reads again. Polling at this rate is what the
		// whole store did before the feed existed, so the degraded mode is the old behaviour.
		select {
		case <-ctx.Done():
			return false
		case <-time.After(time.Second):
			return true
		}
	}
	waiter := make(chan struct{})
	s.waiters = append(s.waiters, waiter)
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		// Idle feeds regularly time out without a write. Do not retain their channels until
		// the next change, which may be arbitrarily far away on an inactive installation.
		s.mu.Lock()
		for i, pending := range s.waiters {
			if pending == waiter {
				last := len(s.waiters) - 1
				s.waiters[i] = s.waiters[last]
				s.waiters[last] = nil
				s.waiters = s.waiters[:last]
				break
			}
		}
		s.mu.Unlock()
		return false
	case <-waiter:
		return true
	}
}
