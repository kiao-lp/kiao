-- V011 — a **task** is a kind of flow node, and it gets a table of its own.
--
-- Two of the four kinds of card are work somebody does: an **AI** card an agent plays and a
-- **Human** card a person does. The other two are the board acting on its own machine — a Shutdown
-- turning it off, a Scheduler waiting out a datetime — and they describe no work at all. There was
-- no word for the first pair, so everything that spoke about them had to say "an AI or a Human flow
-- node" for something said constantly. That word is **task**, and `V009` is why it was free: it is
-- what the card used to be called *whatever* kind it was, which was wrong for the Shutdown and the
-- Scheduler and is exactly right for these two.
--
-- Conceptually a task is a flow node — a specialisation of it, sharing its identity. Logically that
-- is a table whose primary key is a foreign key: **`task.flow_node_id` is both**, so a flow node has
-- at most one task and a task has exactly one flow node, and no row can say otherwise.
--
-- ── which fields move, and why those ─────────────────────────────────────────
--
-- Everything a Shutdown and a Scheduler have no answer to:
--
--   - `body` — the description, which is what is *asked* of whoever does the work. A Shutdown's
--     play is the whole of what it does and a Scheduler's is a wait; neither is asked anything.
--   - `folder` — where the work happens. Asked of both kinds of task and of neither of the others,
--     which are about the machine rather than about the store.
--   - `agent`, `model`, `effort`, `permission`, `settings_extra` — what the turn is run with. An AI
--     task's alone, and an AI task is a task.
--   - `conversation_id` — the chat the task is played in. Likewise.
--   - `on_success_mode`, `on_success_compact` — what becomes of that chat when the task ends well.
--
-- What stays on `flow_node` is what every card has whatever kind it is: its identity, its board, its
-- title, its type, its tags, its status, its spot, the card played after it, and the run holding it.
-- `on_success_flow_node_id` stays with them on purpose — a Scheduler chains, so the successor is
-- every card's but the Shutdown's, while what happens to the *conversation* is a task's alone.
-- `scheduled_at` stays too: it is the Scheduler's own field, and moving it here would put one kind's
-- answer in the other kind's table.
--
-- ── the revision stays on the flow node ──────────────────────────────────────
--
-- A task carries no `revision`, no `created_at` and no `updated_at`, and that is deliberate: a task
-- and its flow node are one card to everything that reads a board, so `If-Match: <revision>` has to
-- mean the whole card. The adapter stamps `flow_node` in the same transaction as every write to
-- `task` — the way it already does for `flow_node_tag`, which has no revision either — so a change
-- to a body bumps the card's revision and appends to the change log exactly once.
--
-- ── the rows that are not tasks ──────────────────────────────────────────────
--
-- A Shutdown or a Scheduler carrying anything in the moved columns loses it here, and there is no
-- other honest answer: the editor already took its settings away the moment it was typed one of
-- those, nothing has ever sent its `body` anywhere, and a task row for a card that is not a task
-- would be the invariant this migration exists to state, broken on its first day.

-- ── the table ────────────────────────────────────────────────────────────────

CREATE TABLE task (
    -- The primary key **and** the foreign key: a task *is* its flow node, so it is identified by it
    -- rather than by an id of its own that nothing would ever name. ON DELETE CASCADE because a
    -- task cannot outlive the card it is.
    flow_node_id       uuid        PRIMARY KEY REFERENCES flow_node (id) ON DELETE CASCADE,
    -- The description: what is sent when the task is played. A play files nothing over it — what
    -- the turn said is in the conversation the task names, and the task still asks what it asked.
    body               text        NOT NULL DEFAULT '',
    -- What a turn is run with. Five columns rather than one document because they are a closed
    -- vocabulary the UI offers and a query filters on, and because "all four are named" is what
    -- decides whether an AI task can be played at all. `model` is the legacy half of a task written
    -- before managed agents — the model beside an engine in `agent` — read and written nowhere.
    agent              text,
    model              text,
    effort             text,
    permission         text,
    -- Where the work happens, as a store link — from the root, with the leading slash. The one
    -- setting a Human task is asked for too.
    folder             text,
    -- Settings a newer instance wrote and this build has no meaning for. Carried, not read.
    settings_extra     jsonb       NOT NULL DEFAULT '{}',
    -- The conversation it is played in. A chat outlives the play that made it and is only ever
    -- taken off by hand, so a deleted conversation leaves the task rather than the reverse. A
    -- reference and not a foreign key, for the reason V002 gives.
    conversation_id    text,
    -- What becomes of the chat when the task ends well: who gets it next, and whether it is
    -- shortened first. Two answers, because a task with nothing after it still answers the second.
    on_success_mode    text        NOT NULL DEFAULT 'end'
                                   CHECK (on_success_mode IN ('continue', 'end')),
    on_success_compact boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE task IS
  'A flow node that is work somebody does — an AI card an agent plays, or a Human card a person '
  'does. One row per such flow node and none for a Shutdown or a Scheduler, which describe no work. '
  'The card''s identity, status, spot, chain and revision stay on flow_node: this is the half of a '
  'card the other two kinds have no answer to.';

COMMENT ON COLUMN task.conversation_id IS
    'The chat the task is played in, by the id files-service''s registry minted for it. '
    'A reference, not a foreign key: that registry is the conversation''s home, and this '
    'service carries the id so the board and the run agree on which chat a task belongs to.';

-- ── the rows ─────────────────────────────────────────────────────────────────
--
-- One task per flow node that is one, carrying what that card already said.

INSERT INTO task (flow_node_id, body, agent, model, effort, permission, folder, settings_extra,
                  conversation_id, on_success_mode, on_success_compact)
SELECT id, body, agent, model, effort, permission, folder, settings_extra,
       conversation_id, on_success_mode, on_success_compact
  FROM flow_node
 WHERE type IN ('ai', 'human');

-- The chat panel's "which card is this?", which now asks the task table.
CREATE INDEX task_conversation_idx ON task (conversation_id) WHERE conversation_id IS NOT NULL;

-- ── the trigger stops reading a column it is about to lose ───────────────────
--
-- `record_flow_node_change` named the card's conversation on every change to it, and that column is
-- moving out from under it. The change is **not** made to look it up on the task row instead: what
-- narrows a flow node's change is its board, every client reads it that way, and the in-memory
-- store has never set it — so a field one of the two adapters filled and nobody read is dropped
-- rather than carried. `change_event.conversation_id` stays exactly as it is for the conversation
-- and transcript scopes, which are what it exists for.

CREATE OR REPLACE FUNCTION record_flow_node_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, flow_node_id, actor, revision)
    VALUES ('flowNode', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── the flow node gives the columns up ───────────────────────────────────────

DROP INDEX IF EXISTS flow_node_conversation_idx;

ALTER TABLE flow_node DROP COLUMN IF EXISTS body;
ALTER TABLE flow_node DROP COLUMN IF EXISTS agent;
ALTER TABLE flow_node DROP COLUMN IF EXISTS model;
ALTER TABLE flow_node DROP COLUMN IF EXISTS effort;
ALTER TABLE flow_node DROP COLUMN IF EXISTS permission;
ALTER TABLE flow_node DROP COLUMN IF EXISTS folder;
ALTER TABLE flow_node DROP COLUMN IF EXISTS settings_extra;
ALTER TABLE flow_node DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE flow_node DROP COLUMN IF EXISTS on_success_mode;
ALTER TABLE flow_node DROP COLUMN IF EXISTS on_success_compact;

COMMENT ON TABLE flow_node IS
  'A card on a board: its identity, its kind, its tags, where it stands, where it sits and the card '
  'played after it. A flow node that is work somebody does — an AI card or a Human card — also has '
  'a row in task, which holds everything a Shutdown and a Scheduler have no answer to.';
