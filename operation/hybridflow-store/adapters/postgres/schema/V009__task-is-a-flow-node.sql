-- V009 — a card is a **flow node**, and the schema says so.
--
-- It was called a task, and that was the wrong word for what the thing is. A board is a graph: a
-- card names the card played after it, a chain runs across columns without noticing them, and three
-- of the four kinds — Shutdown, Scheduler, and a Human card waiting on somebody — are not work to be
-- done at all. "Task" said *a unit of work in a queue*, which is neither what the row holds nor how
-- anything reads it. `flow_node` says what it is: a node of the flow the board draws.
--
-- This migration is the whole of the rename in the database. Nothing here changes what a row means:
-- every table, column, constraint, index, trigger and function keeps exactly what it held, under the
-- name it should have had. **It is the last place the old word is written**, and it is written here
-- because a rename that cannot be read back against the schema it moved is a rename nobody can
-- check.
--
-- The change log is renamed with them. Its `scope` said `'task'`; it says `'flowNode'` now — the
-- camelCase the wire uses for the same word — and the rows already in the log are converted, because
-- a client reading the feed after a restart must not have to know both words.

-- ── the change log ────────────────────────────────────────────────────────────

ALTER TABLE change_event RENAME COLUMN task_id TO flow_node_id;

ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
UPDATE change_event SET scope = 'flowNode' WHERE scope = 'task';
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'column', 'flowNode', 'conversation', 'transcript', 'agent'));

COMMENT ON TABLE change_event IS
  'Append-only log of what changed, written by trigger in the transaction of the write. Clients hold a seq and ask for what came after it. Pruned by age, not kept for ever: what a play did is in the conversation the flow node names.';

-- ── the tables ────────────────────────────────────────────────────────────────

ALTER TABLE task RENAME TO flow_node;
ALTER TABLE flow_node RENAME COLUMN on_success_task_id TO on_success_flow_node_id;

ALTER TABLE task_tag RENAME TO flow_node_tag;
ALTER TABLE flow_node_tag RENAME COLUMN task_id TO flow_node_id;

-- ── the constraints ───────────────────────────────────────────────────────────
--
-- Renamed one by one and only where they are found. PostgreSQL does not move a constraint's name
-- with its table, and `RENAME CONSTRAINT` has no `IF EXISTS`, so the loop is what keeps this
-- migration from failing on a database where one of them was dropped by hand — and what makes
-- running it against a restored dump the same statement as running it here.
DO $$
DECLARE
    renames text[][] := ARRAY[
        ['flow_node',     'task_pkey',                      'flow_node_pkey'],
        ['flow_node',     'task_board_id_fkey',             'flow_node_board_id_fkey'],
        ['flow_node',     'task_column_id_fkey',            'flow_node_column_id_fkey'],
        ['flow_node',     'task_on_success_task_id_fkey',   'flow_node_on_success_flow_node_id_fkey'],
        ['flow_node',     'task_type_check',                'flow_node_type_check'],
        ['flow_node',     'task_status_check',              'flow_node_status_check'],
        ['flow_node',     'task_rank_check',                'flow_node_rank_check'],
        ['flow_node',     'task_scheduled_at_check',        'flow_node_scheduled_at_check'],
        ['flow_node',     'task_on_success_mode_check',     'flow_node_on_success_mode_check'],
        ['flow_node',     'task_claim_is_whole',            'flow_node_claim_is_whole'],
        ['flow_node_tag', 'task_tag_pkey',                  'flow_node_tag_pkey'],
        ['flow_node_tag', 'task_tag_task_id_fkey',          'flow_node_tag_flow_node_id_fkey'],
        ['flow_node_tag', 'task_tag_tag_check',             'flow_node_tag_tag_check']
    ];
    entry text[];
BEGIN
    FOREACH entry SLICE 1 IN ARRAY renames LOOP
        IF EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = entry[2] AND conrelid = entry[1]::regclass) THEN
            EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
                           entry[1], entry[2], entry[3]);
        END IF;
    END LOOP;
END $$;

-- ── the indexes ───────────────────────────────────────────────────────────────

ALTER INDEX IF EXISTS task_board_idx RENAME TO flow_node_board_idx;
ALTER INDEX IF EXISTS task_run_idx RENAME TO flow_node_run_idx;
ALTER INDEX IF EXISTS task_conversation_idx RENAME TO flow_node_conversation_idx;
ALTER INDEX IF EXISTS task_scheduled_idx RENAME TO flow_node_scheduled_idx;
ALTER INDEX IF EXISTS task_tag_word_key RENAME TO flow_node_tag_word_key;
ALTER INDEX IF EXISTS task_tag_word_idx RENAME TO flow_node_tag_word_idx;

-- ── the triggers, and the function one of them calls ──────────────────────────
--
-- The trigger points at the function by identity rather than by name, so renaming the function
-- keeps it wired; replacing the body afterwards is what makes it log the new scope into the
-- renamed column.

ALTER TRIGGER task_touch ON flow_node RENAME TO flow_node_touch;
ALTER TRIGGER task_change ON flow_node RENAME TO flow_node_change;

ALTER FUNCTION record_task_change() RENAME TO record_flow_node_change;

CREATE OR REPLACE FUNCTION record_flow_node_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, column_id, flow_node_id, conversation_id, actor, revision)
    VALUES ('flowNode', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.column_id, OLD.column_id), coalesce(NEW.id, OLD.id),
            coalesce(NEW.conversation_id, OLD.conversation_id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── what the rest of the schema says about them ───────────────────────────────

COMMENT ON COLUMN flow_node.conversation_id IS
    'The chat the card is played in, by the id files-service''s registry minted for it. '
    'A reference, not a foreign key: that registry is the conversation''s home, and this '
    'service carries the id so the board and the run agree on which chat a card belongs to.';

COMMENT ON TABLE agent IS
  'The named definitions of what plays a flow node: which engine, on which model, under which '
  'standing instructions. A flow node names one by id in its settings; one written before this '
  'table names an engine and a model instead, which the runner still plays.';
