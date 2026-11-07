-- V010 — the columns go: a board is its cards, and a card sits where it was put.
--
-- A board used to file its cards in columns, and a card said which one it was filed in — or said
-- none, which put it in the backlog. That filing is gone: the editor shows one face, the workflow,
-- where every card sits at the point somebody put it, and nothing files a card anywhere. A column
-- is not a queue, not a state and not an order — a chain names the card played after it, and that
-- is the whole of the order a board has — so what is left is a name on a header nobody reads the
-- board by.
--
-- With the columns goes everything that existed to order cards inside them. A `rank` said where a
-- card sat among the cards of its column; with no columns there is nothing to sit among, and a
-- spot says where the card is. The backlog goes with them too: it was what a card in no column
-- was, and every card is in no column now.
--
-- What this drops, and what it keeps:
--
--   - `board_column` goes whole — the table, its triggers, and the function that announced its
--     changes. The cards named it through `flow_node.column_id`, which goes first: nothing is
--     moved anywhere on the way out, because there is nowhere to move it to.
--   - `flow_node.rank` goes with it. The order a board is read in is the document's no longer;
--     what the service answers is a set of cards, and the editor lays them out by their spots.
--   - The change log's `column` scope goes, and the rows already in the log under it with them: a
--     scope outside the check would refuse every future write, and a row naming a column that no
--     longer exists is history nobody can read back.
--
-- Nothing about a card but where it was filed is touched: the cards keep their ids, their chains,
-- their spots, their chats and their tags.

-- ── the cards stop naming a column ───────────────────────────────────────────

ALTER TABLE flow_node DROP COLUMN IF EXISTS column_id;
ALTER TABLE flow_node DROP COLUMN IF EXISTS rank;

-- The board's cards were read column by column, each in its rank order; both are gone, so the
-- index that answered that sort goes with them. What is left is the lookup by board.
DROP INDEX IF EXISTS flow_node_board_idx;
CREATE INDEX IF NOT EXISTS flow_node_board_idx ON flow_node (board_id);

-- ── the columns go ───────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS board_column_change ON board_column;
DROP TRIGGER IF EXISTS board_column_touch ON board_column;
DROP TABLE IF EXISTS board_column;
DROP FUNCTION IF EXISTS record_column_change();

-- ── the change log stops knowing the word ────────────────────────────────────

DELETE FROM change_event WHERE scope = 'column';

ALTER TABLE change_event DROP COLUMN IF EXISTS column_id;

ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'conversation', 'transcript', 'agent'));

CREATE OR REPLACE FUNCTION record_flow_node_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, flow_node_id, conversation_id, actor, revision)
    VALUES ('flowNode', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id),
            coalesce(NEW.conversation_id, OLD.conversation_id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
