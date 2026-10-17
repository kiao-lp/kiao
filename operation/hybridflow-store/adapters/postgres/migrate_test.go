package postgres

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAgentDescriptionUpgradePreservesExistingInstructions(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// Recreate the agent row and ledger as they stood before V026.
	if _, err := pool.Exec(ctx, `
		ALTER TABLE agent DROP COLUMN description;
		DELETE FROM schema_migration WHERE version = 26;
		INSERT INTO agent (id, name, platform, instructions) VALUES
			('11111111-1111-4111-8111-111111111111', 'Reviewer', 'claude', 'Be concise.')`); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var description, instructions string
	if err := pool.QueryRow(ctx, `SELECT description, instructions FROM agent`).Scan(&description, &instructions); err != nil {
		t.Fatal(err)
	}
	if description != "" || instructions != "Be concise." {
		t.Errorf("description = %q, instructions = %q, want empty guidance and the original instructions", description, instructions)
	}
}

// The upgrade path a production database walks: V001 applied by the build that created it, and a
// newer binary applying everything after it on its first start. What it asserts is the database
// a production database wakes up to — the chat constraint gone, the agents table there, the board's provenance
// columns gone, the notify channel renamed, the card's log gone, the columns gone, the
// conversations gone, and the ledger holding every version.
func TestMigrationsApplyOverAV001Database(t *testing.T) {
	url := strings.TrimSpace(os.Getenv(testURLEnv))
	if url == "" {
		t.Skipf("%s is not set: skipping the tests that need a database", testURLEnv)
	}
	schema := fmt.Sprintf("t_upgrade_%d", time.Now().UnixNano()%1000000)
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	admin.Close()
	t.Cleanup(func() {
		cleaner, err := pgxpool.New(context.Background(), url)
		if err != nil {
			return
		}
		defer cleaner.Close()
		_, _ = cleaner.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`)
	})

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// The database as the first deploy left it: V001 applied and recorded.
	scripts, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	var first migration
	for _, script := range scripts {
		if script.version == 1 {
			first = script
		}
	}
	if first.sql == "" {
		t.Fatal("no V001 in the embedded schema")
	}
	if _, err := pool.Exec(ctx, first.sql); err != nil {
		t.Fatalf("applying V001 by hand: %v", err)
	}
	if _, err := pool.Exec(ctx, ledgerDDL); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO schema_migration (version, name, checksum, duration_ms) VALUES ($1, $2, $3, 0)`,
		first.version, first.name, first.checksum); err != nil {
		t.Fatal(err)
	}

	// Two cards written the way a V001 database holds them, so the pass has something to carry:
	// what V011 moves onto a task is only worth asserting over a row that was there before it.
	if _, err := pool.Exec(ctx, `
		INSERT INTO board (id, name, slug) VALUES
			('11111111-1111-4111-8111-111111111111', 'Major', 'major');
		INSERT INTO conversation (id) VALUES ('conv-1786543210123-ab12');
		INSERT INTO task (id, board_id, title, type, body, status, agent, effort, permission,
			folder, conversation_id, on_success_mode, rank) VALUES
			('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
			 'Write the plan', 'ai', 'Go on.', 'ready', 'claude', 'high', 'manual',
			 '/docs', 'conv-1786543210123-ab12', 'continue', '1'),
			('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
			 'And off', 'shutdown', '', 'ready', NULL, NULL, NULL, NULL, NULL, 'end', '2')`); err != nil {
		t.Fatalf("filing the V001-era cards: %v", err)
	}

	applied, err := Migrate(ctx, pool)
	if err != nil {
		t.Fatalf("the upgrade pass failed: %v", err)
	}
	// Whatever the binary now carries past V001: the ledger holds every version, in order, and the
	// last of them is the schema the binary serves.
	scripts, err = loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != len(scripts) {
		t.Fatalf("ledger after the pass = %+v, want %d versions", applied, len(scripts))
	}
	for i, line := range applied {
		if line.Version != scripts[i].version {
			t.Fatalf("ledger after the pass = %+v, want every version in order", applied)
		}
	}
	var held string
	err = pool.QueryRow(ctx, `SELECT conname FROM pg_constraint
		WHERE conrelid = 'flow_node'::regclass AND conname = 'flow_node_conversation_id_fkey'`).Scan(&held)
	if err == nil {
		t.Error("flow_node_conversation_id_fkey is still there after the upgrade")
	}
	err = pool.QueryRow(ctx, `SELECT tablename FROM pg_tables
		WHERE schemaname = current_schema() AND tablename = 'agent'`).Scan(&held)
	if err != nil {
		t.Errorf("the agent table is not there after the upgrade: %v", err)
	}
	for _, column := range []string{"origin_path", "doc_id"} {
		err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'board'
			AND column_name = $1`, column).Scan(&held)
		if err == nil {
			t.Errorf("board.%s is still there after the upgrade", column)
		}
	}
	err = pool.QueryRow(ctx, `SELECT prosrc FROM pg_proc
		WHERE pronamespace = current_schema()::regnamespace AND proname = 'announce'`).Scan(&held)
	if err != nil {
		t.Errorf("the announce function is not there after the upgrade: %v", err)
	} else if !strings.Contains(held, "kiao_hybridflow") {
		t.Error("announce still notifies on the old channel after the upgrade")
	}
	err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'flow_node'
		AND column_name = 'log'`).Scan(&held)
	if err == nil {
		t.Error("flow_node.log is still there after the upgrade")
	}
	// V009: the word is gone from the schema, and what carried it is still there under the name it
	// should have had. The table, the column naming the card played next and the change log's own
	// column are the three the rest of the service reads by name.
	//
	// `task` is a table again after V011 and is a different thing — the AI-or-Human half of a card
	// rather than the card — so what is asserted is that the **card** no longer lives there: the
	// row is identified by its flow node and carries no title of its own.
	err = pool.QueryRow(ctx, `SELECT tablename FROM pg_tables
		WHERE schemaname = current_schema() AND tablename = 'task_tag'`).Scan(&held)
	if err == nil {
		t.Error("the task_tag table is still there after the upgrade")
	}
	err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'task' AND column_name = 'title'`).Scan(&held)
	if err == nil {
		t.Error("the task table still holds a card's title after the upgrade")
	}
	for _, column := range [][2]string{
		{"flow_node", "on_success_flow_node_id"},
		{"flow_node_tag", "flow_node_id"},
		{"change_event", "flow_node_id"},
	} {
		err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = $1
			AND column_name = $2`, column[0], column[1]).Scan(&held)
		if err != nil {
			t.Errorf("%s.%s is not there after the upgrade: %v", column[0], column[1], err)
		}
	}
	// V010: the columns are gone — the table, the cards' filing and order, and the change log's
	// own column and scope word.
	err = pool.QueryRow(ctx, `SELECT tablename FROM pg_tables
		WHERE schemaname = current_schema() AND tablename = 'board_column'`).Scan(&held)
	if err == nil {
		t.Error("the board_column table is still there after the upgrade")
	}
	for _, column := range [][2]string{
		{"flow_node", "column_id"},
		{"flow_node", "rank"},
		{"change_event", "column_id"},
	} {
		err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = $1
			AND column_name = $2`, column[0], column[1]).Scan(&held)
		if err == nil {
			t.Errorf("%s.%s is still there after the upgrade", column[0], column[1])
		}
	}
	err = pool.QueryRow(ctx, `SELECT conname FROM pg_constraint
		WHERE conrelid = 'change_event'::regclass AND conname = 'change_event_scope_check'
		AND pg_get_constraintdef(oid) LIKE '%column%'`).Scan(&held)
	if err == nil {
		t.Error("the change log still accepts the column scope after the upgrade")
	}
	// V011: the AI-and-Human half of a card is a table of its own, keyed by the card it belongs to
	// and keyed to it — the primary key *is* the foreign key — and every column it took is gone
	// from the card.
	for _, column := range []string{
		"body", "agent", "model", "effort", "permission", "folder", "settings_extra",
		"conversation_id", "on_success_mode", "on_success_compact",
	} {
		err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'flow_node'
			AND column_name = $1`, column).Scan(&held)
		if err == nil {
			t.Errorf("flow_node.%s is still there after the upgrade", column)
		}
		err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'task'
			AND column_name = $1`, column).Scan(&held)
		if err != nil {
			t.Errorf("task.%s is not there after the upgrade: %v", column, err)
		}
	}
	err = pool.QueryRow(ctx, `SELECT conname FROM pg_constraint
		WHERE conrelid = 'task'::regclass AND contype = 'p'
		AND pg_get_constraintdef(oid) = 'PRIMARY KEY (flow_node_id)'`).Scan(&held)
	if err != nil {
		t.Errorf("the task table is not keyed by its flow node: %v", err)
	}
	err = pool.QueryRow(ctx, `SELECT conname FROM pg_constraint
		WHERE conrelid = 'task'::regclass AND contype = 'f'
		AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (flow_node_id) REFERENCES flow_node(id)%'`).Scan(&held)
	if err != nil {
		t.Errorf("the task table does not name its flow node as a foreign key: %v", err)
	}
	// The AI card's own answers are on its task, and the Shutdown has no task to put any on.
	var body, folder, chat, mode string
	err = pool.QueryRow(ctx, `SELECT body, folder, conversation_id, on_success_mode FROM task
		WHERE flow_node_id = '22222222-2222-4222-8222-222222222222'`).Scan(&body, &folder, &chat, &mode)
	if err != nil {
		t.Errorf("the AI card has no task after the upgrade: %v", err)
	} else if body != "Go on." || folder != "/docs" || chat != "conv-1786543210123-ab12" || mode != "continue" {
		t.Errorf("the task holds %q / %q / %q / %q, want what the card said before the upgrade",
			body, folder, chat, mode)
	}
	var tasks int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM task
		WHERE flow_node_id = '33333333-3333-4333-8333-333333333333'`).Scan(&tasks)
	if err != nil {
		t.Error(err)
	} else if tasks != 0 {
		t.Errorf("the Shutdown card has %d tasks after the upgrade, want none", tasks)
	}
	// The trigger no longer reads a column the card has given up, which is what a change to any
	// card would otherwise fail on.
	err = pool.QueryRow(ctx, `SELECT prosrc FROM pg_proc
		WHERE pronamespace = current_schema()::regnamespace AND proname = 'record_flow_node_change'`).Scan(&held)
	if err != nil {
		t.Errorf("the flow node change trigger is not there after the upgrade: %v", err)
	} else if strings.Contains(held, "conversation_id") {
		t.Error("the flow node change trigger still reads the card's conversation after the upgrade")
	}
	// V014: the conversations are gone — the tables, the functions that announced their changes,
	// and the change log's own column and scope words. The card's chat survives them: it names a
	// conversation worker keeps, and that reference is not a row here.
	for _, table := range []string{"conversation", "transcript_record"} {
		err = pool.QueryRow(ctx, `SELECT tablename FROM pg_tables
			WHERE schemaname = current_schema() AND tablename = $1`, table).Scan(&held)
		if err == nil {
			t.Errorf("the %s table is still there after the upgrade", table)
		}
	}
	for _, fn := range []string{"record_conversation_change", "record_transcript_change"} {
		err = pool.QueryRow(ctx, `SELECT proname FROM pg_proc
			WHERE pronamespace = current_schema()::regnamespace AND proname = $1`, fn).Scan(&held)
		if err == nil {
			t.Errorf("the %s function is still there after the upgrade", fn)
		}
	}
	err = pool.QueryRow(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'change_event'
		AND column_name = 'conversation_id'`).Scan(&held)
	if err == nil {
		t.Error("change_event.conversation_id is still there after the upgrade")
	}
	for _, scope := range []string{"conversation", "transcript"} {
		err = pool.QueryRow(ctx, `SELECT conname FROM pg_constraint
			WHERE conrelid = 'change_event'::regclass AND conname = 'change_event_scope_check'
			AND pg_get_constraintdef(oid) LIKE '%`+scope+`%'`).Scan(&held)
		if err == nil {
			t.Errorf("the change log still accepts the %s scope after the upgrade", scope)
		}
	}
}
