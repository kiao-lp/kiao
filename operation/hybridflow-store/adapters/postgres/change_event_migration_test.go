package postgres

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestChangeEventSubtypeUpgradePreservesHistory(t *testing.T) {
	pool := testPoolAtVersion(t, 29)
	ctx := context.Background()
	const boardID = "11111111-1111-4111-8111-111111111111"
	// These subjects are absent: retained events must also describe deleted rows.
	if _, err := pool.Exec(ctx, `
		INSERT INTO change_event (at, scope, kind, board_id, flow_node_id, flow_node_class_id,
			workflow_id, workflow_class_id, agent_id, runner_id, actor, revision) VALUES
		('2026-10-20 10:00:00+00', 'board', 'deleted', $1, NULL, NULL, NULL, NULL, NULL, NULL, 'legacy', NULL),
		('2026-10-20 10:00:01+00', 'flowNode', 'created', $1, $1, NULL, NULL, NULL, NULL, NULL, 'run-1', 1),
		('2026-10-20 10:00:02+00', 'flowNodeClass', 'updated', $1, NULL, $1, NULL, NULL, NULL, NULL, 'sql', 12),
		('2026-10-20 10:00:03+00', 'workflow', 'deleted', $1, NULL, NULL, $1, NULL, NULL, NULL, 'legacy', NULL),
		('2026-10-20 10:00:04+00', 'workflowClass', 'created', $1, NULL, NULL, NULL, $1, NULL, NULL, 'legacy', 1),
		('2026-10-20 10:00:05+00', 'agent', 'updated', NULL, NULL, NULL, NULL, NULL, $1, NULL, 'sql', 8),
		('2026-10-20 10:00:06+00', 'runner', 'deleted', NULL, NULL, NULL, NULL, NULL, NULL, $1, 'legacy', NULL),
		('2026-10-20 10:00:07+00', 'flowNodeClass', 'deleted', NULL, NULL, $1, NULL, NULL, NULL, NULL, 'sql', NULL)`, boardID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `SELECT nextval(pg_get_serial_sequence('change_event', 'seq'))`); err != nil {
		t.Fatal(err)
	}
	var before, after string
	var cursor int64
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(e) ORDER BY seq)::text, max(seq)
		FROM change_event e`).Scan(&before, &cursor); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatalf("a second pass failed: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(e) ORDER BY seq)::text
		FROM change_event_feed e`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("history changed during migration:\nbefore: %s\nafter: %s", before, after)
	}
	var columns []string
	if err := pool.QueryRow(ctx, `SELECT array_agg(column_name::text ORDER BY column_name)
		FROM information_schema.columns WHERE table_schema = current_schema()
		AND table_name = 'change_event'`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(columns, []string{"actor", "at", "kind", "revision", "scope", "seq"}) {
		t.Fatalf("shared event fields = %v", columns)
	}
	changes := NewChangeStore(pool)
	var from int64
	total := 0
	for {
		page, latest, err := changes.Since(ctx, from, boardID, 2)
		if err != nil {
			t.Fatal(err)
		}
		if latest != cursor {
			t.Fatalf("committed cursor changed from %d to %d", cursor, latest)
		}
		if len(page) == 0 {
			break
		}
		for _, change := range page {
			if change.Seq <= from || change.BoardID != boardID {
				t.Fatalf("unexpected event in board page: %+v", change)
			}
			from = change.Seq
			total++
		}
	}
	if total != 5 {
		t.Fatalf("replayed %d board events, want 5", total)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO board(id, name, slug) VALUES ($1, 'After upgrade', 'after-upgrade')`, boardID); err != nil {
		t.Fatal(err)
	}
	page, _, err := changes.Since(ctx, cursor, boardID, 2)
	if err != nil || len(page) != 1 || page[0].Seq <= cursor+1 || page[0].Actor != "sql" {
		t.Fatalf("post-upgrade event = %+v, %v", page, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE change_event SET at = now() - interval '10 days'`); err != nil {
		t.Fatal(err)
	}
	if _, err := PruneChanges(ctx, pool, 72*time.Hour); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"change_event", "board_change_event", "flow_node_change_event",
		"flow_node_class_change_event", "workflow_change_event", "workflow_class_change_event",
		"agent_change_event", "runner_change_event"} {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Errorf("%s retains %d rows after pruning", table, count)
		}
	}
}

func TestChangeEventRequiresOneMatchingSubtype(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name string
		sql  string
	}{
		{"missing subtype", `INSERT INTO change_event(scope, kind) VALUES ('board', 'created')`},
		{"wrong subtype", `WITH event AS (
			INSERT INTO change_event(scope, kind) VALUES ('board', 'created') RETURNING seq
		) INSERT INTO agent_change_event SELECT seq, gen_random_uuid() FROM event`},
		{"two subtypes", `WITH event AS (
			INSERT INTO change_event(scope, kind) VALUES ('board', 'created') RETURNING seq
		), detail AS (
			INSERT INTO board_change_event SELECT seq, gen_random_uuid() FROM event
		) INSERT INTO agent_change_event SELECT seq, gen_random_uuid() FROM event`},
		{"remove subtype", `DELETE FROM runner_change_event`},
		{"change scope", `UPDATE change_event SET scope = 'board' WHERE scope = 'runner'`},
		{"move subtype", `WITH event AS (
			INSERT INTO change_event(scope, kind) VALUES ('runner', 'created') RETURNING seq
		) UPDATE runner_change_event SET seq = (SELECT seq FROM event)
		  WHERE seq = (SELECT min(seq) FROM runner_change_event)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, tc.sql)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != codeCheckViolation || pgErr.ConstraintName != "change_event_one_subtype" {
				t.Fatalf("invalid event returned %v, want a subtype constraint violation", err)
			}
		})
	}
}

func TestTriggersRecordEveryEventSubtype(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO board(id, name, slug) VALUES ('11111111-1111-4111-8111-111111111111', 'Events', 'events');
		INSERT INTO flow_node(id, board_id, title) SELECT id, id, 'Node' FROM board;
		INSERT INTO flow_node_class(id, board_id, title) SELECT id, id, 'Class' FROM board;
		INSERT INTO flow_node_class_version(id, flow_node_class_id, version_number) SELECT id, id, 1 FROM board;
		INSERT INTO workflow(id, board_id, name) SELECT id, id, 'Workflow' FROM board;
		INSERT INTO workflow_class(id, board_id, name) SELECT id, id, 'Workflow class' FROM board;
		INSERT INTO agent(id, name, platform) SELECT id, 'Agent', 'claude' FROM board;
		INSERT INTO runner(id, name) SELECT id, 'Runner' FROM board;`); err != nil {
		t.Fatal(err)
	}
	changes := NewChangeStore(pool)
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		SELECT set_config('kiao.actor', 'manual-edit', true);
		UPDATE board SET name = 'Renamed';
		UPDATE flow_node SET title = 'Renamed';
		UPDATE flow_node_class SET title = 'Renamed';
		UPDATE flow_node_class_version SET body = 'Revised';
		UPDATE workflow SET name = 'Renamed';
		UPDATE workflow_class SET name = 'Renamed';
		UPDATE agent SET name = 'Renamed';
		UPDATE runner SET name = 'Renamed' WHERE name = 'Runner';`); err != nil {
		t.Fatal(err)
	}
	feed, _, err := changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	scopes := map[string]int{}
	for _, change := range feed {
		if change.Kind != "updated" || change.Revision != 2 || change.Actor != "manual-edit" {
			t.Fatalf("unexpected event: %+v", change)
		}
		scopes[string(change.Scope)]++
	}
	want := map[string]int{"board": 1, "flowNode": 1, "flowNodeClass": 2, "workflow": 1,
		"workflowClass": 1, "agent": 1, "runner": 1}
	if !reflect.DeepEqual(scopes, want) {
		t.Fatalf("event scopes = %v, want %v", scopes, want)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM board; DELETE FROM agent; DELETE FROM runner;`); err != nil {
		t.Fatalf("deleting subjects failed: %v", err)
	}
	feed, _, err = changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	deleted := map[string]int{}
	for _, change := range feed {
		if change.Kind == "deleted" {
			deleted[string(change.Scope)]++
		}
	}
	want["runner"] = 3 // The two seeded runners also disappear.
	if !reflect.DeepEqual(deleted, want) {
		t.Fatalf("deletion scopes = %v, want %v", deleted, want)
	}
}
