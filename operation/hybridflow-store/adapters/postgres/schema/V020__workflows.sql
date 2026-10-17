-- V020 — workflows: the rectangles round the cards, and round the classes.
--
-- A **workflow** groups flow nodes, and a **workflow class** groups node classes. Either is a
-- name and nothing else — no spot of its own, no chain, no status — because its bounds are
-- computed from the cards it holds, the way a container in archdia is. Membership is the card's:
-- a flow node names its workflow and a class its workflow class, each at most one, so the two
-- halves are two columns beside the two the classes added in V015.
--
-- Deleting a workflow ungroups its cards rather than taking them: the foreign keys are
-- ON DELETE SET NULL both ways, so the cards stay where they are and say what they said.
--
-- The change feed learns two scopes, `workflow` and `workflowClass`, each naming its row. A
-- card grouped or ungrouped is its own change too — the card's row moved, and the trigger on
-- it says so — so a client watching the board is woken twice and re-reads once.
--
-- ── the workflows ──────────────────────────────────────────────────────────────

CREATE TABLE workflow (
    id          uuid        PRIMARY KEY,
    board_id    uuid        NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    name        text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revision    bigint      NOT NULL DEFAULT 1
);

COMMENT ON TABLE workflow IS
  'A group of flow nodes: a name round a set of cards. The bounds are computed from the cards '
  'it holds, so the row keeps no spot.';

CREATE INDEX workflow_board_idx ON workflow (board_id, id);

CREATE TRIGGER workflow_touch BEFORE UPDATE ON workflow
    FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ── the workflow classes ───────────────────────────────────────────────────────

CREATE TABLE workflow_class (
    id          uuid        PRIMARY KEY,
    board_id    uuid        NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    name        text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revision    bigint      NOT NULL DEFAULT 1
);

COMMENT ON TABLE workflow_class IS
  'A group of node classes: a name round a set of reusable cards. The bounds are computed '
  'from the classes it holds, so the row keeps no spot.';

CREATE INDEX workflow_class_board_idx ON workflow_class (board_id, id);

CREATE TRIGGER workflow_class_touch BEFORE UPDATE ON workflow_class
    FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ── the cards name their group ─────────────────────────────────────────────────

ALTER TABLE flow_node ADD COLUMN IF NOT EXISTS workflow_id uuid
    REFERENCES workflow (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flow_node_workflow_idx ON flow_node (workflow_id)
    WHERE workflow_id IS NOT NULL;

COMMENT ON COLUMN flow_node.workflow_id IS
  'The workflow the flow node is grouped in, or NULL for none. At most one per card.';

ALTER TABLE flow_node_class ADD COLUMN IF NOT EXISTS workflow_class_id uuid
    REFERENCES workflow_class (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flow_node_class_workflow_idx ON flow_node_class (workflow_class_id)
    WHERE workflow_class_id IS NOT NULL;

COMMENT ON COLUMN flow_node_class.workflow_class_id IS
  'The workflow class the class is grouped in, or NULL for none. At most one per card.';

-- ── the change feed learns the scopes ──────────────────────────────────────────

ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'flowNodeClass', 'workflow', 'workflowClass', 'agent', 'runner'));
ALTER TABLE change_event ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE change_event ADD COLUMN IF NOT EXISTS workflow_class_id uuid;
CREATE INDEX IF NOT EXISTS change_event_workflow_idx ON change_event (workflow_id, seq);
CREATE INDEX IF NOT EXISTS change_event_workflow_class_idx ON change_event (workflow_class_id, seq);

CREATE OR REPLACE FUNCTION record_workflow_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, workflow_id, actor, revision)
    VALUES ('workflow', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_change AFTER INSERT OR UPDATE OR DELETE ON workflow
    FOR EACH ROW EXECUTE FUNCTION record_workflow_change();

CREATE OR REPLACE FUNCTION record_workflow_class_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, workflow_class_id, actor, revision)
    VALUES ('workflowClass', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_class_change AFTER INSERT OR UPDATE OR DELETE ON workflow_class
    FOR EACH ROW EXECUTE FUNCTION record_workflow_class_change();
