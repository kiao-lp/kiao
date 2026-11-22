-- V015 — flow node classes: the reusable cards, and their successive versions.
--
-- A **flow node class** (a node class on the UI) is a card that is never played: the reusable
-- shape of work its instances do. It holds what every instance shares — the title, the kind, the
-- chain to the next class, and, for an AI one, how a turn answers its tool calls — and its
-- **versions** hold what changes: the description and what done means.
--
-- Two tables, for the two halves:
--
--   - `flow_node_class` is the card beside the board's flow nodes: its identity, its board, its
--     title, its kind, its tags, its spot, the class after it, and the AI-only answers.
--     A class chains to a **class** (`on_success_flow_node_class_id`): the two kinds chain among
--     themselves and never across, so this column names this table and no other.
--   - `flow_node_class_version` is one version under its class: the successive number, the
--     description, the success criteria, and whether it is still being written. Only the latest
--     version that is not a draft is used when the class is instantiated; the others are past
--     versions kept for statistics.
--
-- And one column on the card itself: `flow_node.class_version_id` names the version a flow node
-- was instantiated from. A reference the board resolves at the read — the class and the version
-- it names — and one the flow node may break, which disconnects it from its class/version and
-- changes nothing else about it. ON DELETE SET NULL both ways: a version that has gone leaves
-- the flow nodes made from it saying what they were asked.
--
-- The change feed learns one scope, `flowNodeClass`, naming the class. A version's change is
-- logged under its class too — the class is the card the board draws — with the board set, so a
-- client watching one board is woken by its classes and by nothing else's.
--
-- ── the classes ────────────────────────────────────────────────────────────────

CREATE TABLE flow_node_class (
    id          uuid        PRIMARY KEY,
    board_id    uuid        NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    title       text        NOT NULL DEFAULT '',
    type        text        NOT NULL DEFAULT 'human'
                            CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler')),
    -- A Scheduler's preset datetime, as the card writes it. The instance starts from it and may
    -- change it.
    scheduled_at text       CHECK (scheduled_at IS NULL OR scheduled_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
    spot_x      integer,
    spot_y      integer,
    -- The class after this one. DEFERRABLE for the reason the flow nodes' own chain is: a batch
    -- creating two classes at once is checked as a whole rather than in the order its rows
    -- happen to arrive in. A class chains to a class and never to a flow node.
    on_success_flow_node_class_id uuid REFERENCES flow_node_class (id)
        ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    -- How an AI instance's tool calls are answered, and where it is pinned. Asked of an AI
    -- class and of no other kind; no foreign key on the runner, for the reason V013 gives.
    permission  text,
    runner      text,
    -- What becomes of an AI instance's chat when it ends well. Asked of an AI class and of no
    -- other kind.
    on_success_mode    text NOT NULL DEFAULT 'end'
                       CHECK (on_success_mode IN ('continue', 'end')),
    on_success_compact boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revision    bigint      NOT NULL DEFAULT 1
);

COMMENT ON TABLE flow_node_class IS
  'A reusable card: the title, the kind, the chain and the AI-only answers every instance '
  'shares. Never played. The words — the description and what done means — are its versions.';

CREATE INDEX flow_node_class_board_idx ON flow_node_class (board_id, id);

CREATE TRIGGER flow_node_class_touch BEFORE UPDATE ON flow_node_class
    FOR EACH ROW EXECUTE FUNCTION touch_row();

-- The words themselves, not ids — the same reason the flow nodes' own tags are.
CREATE TABLE flow_node_class_tag (
    flow_node_class_id uuid    NOT NULL REFERENCES flow_node_class (id) ON DELETE CASCADE,
    tag                  text    NOT NULL CHECK (tag <> ''),
    ordinal              integer NOT NULL,
    PRIMARY KEY (flow_node_class_id, ordinal)
);

CREATE UNIQUE INDEX flow_node_class_tag_word_key ON flow_node_class_tag (flow_node_class_id, lower(tag));
CREATE INDEX flow_node_class_tag_word_idx ON flow_node_class_tag (lower(tag));

-- ── the versions ───────────────────────────────────────────────────────────────

CREATE TABLE flow_node_class_version (
    id              uuid        PRIMARY KEY,
    flow_node_class_id uuid     NOT NULL REFERENCES flow_node_class (id) ON DELETE CASCADE,
    -- The version's place in the succession: 1 for the first, then one more per version.
    version_number  integer     NOT NULL CHECK (version_number >= 1),
    body            text        NOT NULL DEFAULT '',
    -- What done means, as the task row holds it: the pairs the editor added, under the keys
    -- the wire uses.
    criteria        jsonb       NOT NULL DEFAULT '[]',
    status          text        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'published')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    revision        bigint      NOT NULL DEFAULT 1,
    UNIQUE (flow_node_class_id, version_number)
);

COMMENT ON TABLE flow_node_class_version IS
  'One version of a node class: the description and what done means, under a successive number. '
  'Only the latest version that is not a draft is used when the class is instantiated; the '
  'others are past versions kept for statistics.';

CREATE INDEX flow_node_class_version_class_idx ON flow_node_class_version (flow_node_class_id, version_number);

CREATE TRIGGER flow_node_class_version_touch BEFORE UPDATE ON flow_node_class_version
    FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ── the flow node names its version ────────────────────────────────────────────

ALTER TABLE flow_node ADD COLUMN IF NOT EXISTS class_version_id uuid
    REFERENCES flow_node_class_version (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flow_node_class_version_idx ON flow_node (class_version_id)
    WHERE class_version_id IS NOT NULL;

COMMENT ON COLUMN flow_node.class_version_id IS
  'The class version the flow node was instantiated from, or NULL for one made by hand. '
  'Breaking it disconnects the flow node from its class/version and changes nothing else.';

-- ── the change feed learns the scope ───────────────────────────────────────────

ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'flowNodeClass', 'agent', 'runner'));
ALTER TABLE change_event ADD COLUMN IF NOT EXISTS flow_node_class_id uuid;
CREATE INDEX IF NOT EXISTS change_event_flow_node_class_idx ON change_event (flow_node_class_id, seq);

CREATE OR REPLACE FUNCTION record_flow_node_class_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, flow_node_class_id, actor, revision)
    VALUES ('flowNodeClass', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flow_node_class_change AFTER INSERT OR UPDATE OR DELETE ON flow_node_class
    FOR EACH ROW EXECUTE FUNCTION record_flow_node_class_change();

-- A version's change is its class's change: the class is the card the board draws, and the
-- board id is what wakes the clients watching that board. Read off the class row rather than
-- carried, because a version names its class and nothing else.
CREATE OR REPLACE FUNCTION record_flow_node_class_version_change() RETURNS trigger AS $$
DECLARE
    new_seq bigint;
    class_row flow_node_class%ROWTYPE;
BEGIN
    SELECT * INTO class_row FROM flow_node_class
     WHERE id = coalesce(NEW.flow_node_class_id, OLD.flow_node_class_id);
    INSERT INTO change_event (scope, kind, board_id, flow_node_class_id, actor, revision)
    VALUES ('flowNodeClass', change_kind(TG_OP), class_row.board_id,
            coalesce(NEW.flow_node_class_id, OLD.flow_node_class_id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flow_node_class_version_change AFTER INSERT OR UPDATE OR DELETE ON flow_node_class_version
    FOR EACH ROW EXECUTE FUNCTION record_flow_node_class_version_change();
