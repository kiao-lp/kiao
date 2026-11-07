-- V001 — the boards, their cards and the conversations they are played in.
--
-- Read this file with docs/architecture/workflows-service.md beside it: the class diagram there is
-- generated from these tables, and the reasoning for the shape is written out once, there.
--
-- Four things in here are deliberate and are the whole reason the schema looks like this rather
-- than like a document with an id:
--
--   1. **The grain of a write is a field of a card.** Nothing stores a board as a blob, so a run
--      filing an answer under one card and a person renaming another are two UPDATEs of two
--      columns and both are kept.
--   2. **Order is a fractional key, not a position.** `rank` is a digit string compared as text,
--      and there is always room for another key between two of them — so moving a card writes one
--      row instead of renumbering a column, and two concurrent moves never touch one row.
--      The columns are `COLLATE "C"` because a locale collation would sort `a` before `B` and
--      quietly scramble every board.
--
--      **A rank is deliberately not unique**, and that is a decision rather than an omission. It
--      was unique per column at first, and two things broke. Deleting a column sends its cards to
--      the backlog (`ON DELETE SET NULL` below), and any one of them landing on a rank a backlog
--      card already held failed the whole delete — so a column with cards in it could not be
--      removed at all, in SQL or anywhere else. And two clients dropping a card into the same gap
--      at the same instant had one of them refused, which is precisely the case this schema exists
--      to serve. A tie costs nothing instead: every read orders by `(rank, id)`, so the order is
--      total and stable, and the two tied cards sit in an arbitrary but unchanging order until one
--      of them is moved again.
--   3. **Every row carries a revision, and a trigger bumps it.** A conditional update can then be
--      `WHERE revision = $n`, and a row changed by hand in psql still tells every client it moved.
--   4. **Every change appends to one log, from a trigger.** A feed with a hole in it leaves a
--      client wrong until it reloads, so the append cannot be something a call site may forget:
--      it happens in the transaction of the write, whatever issued the write.
--
-- Requires PostgreSQL 15 or later, for `UNIQUE NULLS NOT DISTINCT` — which is what makes the
-- backlog (a card in no column, `column_id IS NULL`) share one rank space with the columns.

-- ── who did it ────────────────────────────────────────────────────────────────
--
-- The actor is a transaction-local setting rather than a parameter of every statement, because the
-- thing that writes the change log is a trigger and a trigger has no arguments. The service sets it
-- once per transaction (`SET LOCAL kiao.actor = …`); a person in psql sets it or does not, and the
-- log then says `sql`, which is the truth.
CREATE OR REPLACE FUNCTION kiao_actor() RETURNS text AS $$
  SELECT coalesce(nullif(current_setting('kiao.actor', true), ''), 'sql');
$$ LANGUAGE sql STABLE;

-- ── the change log ────────────────────────────────────────────────────────────

CREATE TABLE change_event (
    seq             bigserial PRIMARY KEY,
    at              timestamptz NOT NULL DEFAULT now(),
    scope           text        NOT NULL CHECK (scope IN ('board', 'column', 'task', 'conversation', 'transcript')),
    kind            text        NOT NULL CHECK (kind IN ('created', 'updated', 'deleted')),
    -- Set for every change to a board and to anything on it, so a client watching one board is
    -- never woken by another board's turns.
    board_id        uuid,
    column_id       uuid,
    task_id         uuid,
    conversation_id text,
    actor           text        NOT NULL DEFAULT '',
    -- What the changed row's revision became, so a client that already holds it does nothing.
    revision        bigint
);

CREATE INDEX change_event_board_idx ON change_event (board_id, seq);
CREATE INDEX change_event_conversation_idx ON change_event (conversation_id, seq);
CREATE INDEX change_event_at_idx ON change_event (at);

COMMENT ON TABLE change_event IS
  'Append-only log of what changed, written by trigger in the transaction of the write. Clients hold a seq and ask for what came after it. Pruned by age, not kept for ever: the record of what a task did is in the task''s own log.';

-- ── the two triggers every versioned table gets ───────────────────────────────

-- The word a change is logged under, from the operation that caused it.
CREATE OR REPLACE FUNCTION change_kind(op text) RETURNS text AS $$
  SELECT CASE op WHEN 'INSERT' THEN 'created' WHEN 'DELETE' THEN 'deleted' ELSE 'updated' END;
$$ LANGUAGE sql IMMUTABLE;

-- Stamps a row as changed. Mechanical, and therefore a trigger: a hand-written UPDATE that forgot
-- to bump the revision would be a row that moved without telling anybody.
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    NEW.revision := OLD.revision + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Appends the change, and wakes whoever is listening. The payload is the sequence number alone —
-- NOTIFY is bounded at 8000 bytes and a listener reads the row anyway.
--
-- One function per table rather than one taking the scope as an argument: the tables do not have
-- the same columns, and a single function reading `NEW.board_id` would be asking PostgreSQL to
-- resolve a column that does not exist on three of them. Five short functions that each say plainly
-- what they log beat one that has to be read twice.
CREATE OR REPLACE FUNCTION announce(new_seq bigint) RETURNS void AS $$
BEGIN
    PERFORM pg_notify('kiao_workflows', new_seq::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_board_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, actor, revision)
    VALUES ('board', change_kind(TG_OP), coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_column_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, column_id, actor, revision)
    VALUES ('column', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_task_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, board_id, column_id, task_id, conversation_id, actor, revision)
    VALUES ('task', change_kind(TG_OP), coalesce(NEW.board_id, OLD.board_id),
            coalesce(NEW.column_id, OLD.column_id), coalesce(NEW.id, OLD.id),
            coalesce(NEW.conversation_id, OLD.conversation_id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_conversation_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, conversation_id, actor, revision)
    VALUES ('conversation', change_kind(TG_OP), coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_transcript_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, conversation_id, actor, revision)
    VALUES ('transcript', change_kind(TG_OP),
            coalesce(NEW.conversation_id, OLD.conversation_id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.seq END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── boards ────────────────────────────────────────────────────────────────────

CREATE TABLE board (
    id          uuid        PRIMARY KEY,
    name        text        NOT NULL CHECK (name <> ''),
    -- The handle a URL carries. Derived from the name, and **not** moved by a rename: a bookmark
    -- and a pasted link name a board, and a board renamed is the same board.
    slug        text        NOT NULL UNIQUE CHECK (slug <> ''),
    -- The `.workflow.json` this board was imported from, and the document id it carried. Kept so
    -- an import is traceable and reversible; nothing resolves through either.
    origin_path text,
    doc_id      uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revision    bigint      NOT NULL DEFAULT 1,
    -- Put away, rather than deleted: a board holds the record of what was asked and what came back.
    archived_at timestamptz
);

-- Two boards called the same thing would be two rows of the boards page nobody can tell apart.
-- Case-insensitively, because that is how a person reads a list.
CREATE UNIQUE INDEX board_name_key ON board (lower(name));
CREATE INDEX board_archived_idx ON board (archived_at) WHERE archived_at IS NOT NULL;

CREATE TRIGGER board_touch BEFORE UPDATE ON board
    FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER board_change AFTER INSERT OR UPDATE OR DELETE ON board
    FOR EACH ROW EXECUTE FUNCTION record_board_change();

-- ── columns ───────────────────────────────────────────────────────────────────

CREATE TABLE board_column (
    id         uuid        PRIMARY KEY,
    board_id   uuid        NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    title      text        NOT NULL DEFAULT '',
    -- A line under the column's title. Empty for most columns; carried from a migrated preamble.
    notes      text        NOT NULL DEFAULT '',
    rank       text        COLLATE "C" NOT NULL CHECK (rank ~ '^[0-9a-z]+$' AND rank !~ '0$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision   bigint      NOT NULL DEFAULT 1
);

CREATE INDEX board_column_board_idx ON board_column (board_id, rank, id);

CREATE TRIGGER board_column_touch BEFORE UPDATE ON board_column
    FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER board_column_change AFTER INSERT OR UPDATE OR DELETE ON board_column
    FOR EACH ROW EXECUTE FUNCTION record_column_change();

-- ── conversations ─────────────────────────────────────────────────────────────
--
-- Before the cards, because a card names one.

CREATE TABLE conversation (
    -- `conv-<creation millis>-<four hex>`, the shape the file-backed registry minted. Kept rather
    -- than replaced by a uuid: every card on every board names its chat by that string, and so does
    -- the folder slug that owns the agent CLI's own transcript on disk.
    id                text        PRIMARY KEY CHECK (id ~ '^conv-[0-9]{13,}-[0-9a-f]{4}$'),
    title             text        NOT NULL DEFAULT 'New conversation',
    title_set_by_user boolean     NOT NULL DEFAULT false,
    -- The working directory, relative to the store root ('' is the root). Fixed at creation: it is
    -- the CLI's cwd and the folder whose slug owns the CLI's own transcript.
    folder            text        NOT NULL DEFAULT '',
    -- Which agent runs the turns. Fixed at creation: a session id belongs to one engine, so a
    -- conversation that changed agent would hold a session that no longer means anything.
    agent             text        NOT NULL DEFAULT '',
    owner             text        NOT NULL DEFAULT '',
    model             text        NOT NULL DEFAULT '',
    effort            text        NOT NULL DEFAULT '',
    permission_mode   text        NOT NULL DEFAULT '',
    thinking          boolean     NOT NULL DEFAULT false,
    -- The CLI session this conversation resumes with, and whether it is gone. **The model's memory
    -- is that session file on the machine that spawned it, not this transcript** — which is why
    -- trimming the transcript below costs display history and nothing else.
    session_id        text        NOT NULL DEFAULT '',
    session_lost      boolean     NOT NULL DEFAULT false,
    fork_pending      boolean     NOT NULL DEFAULT false,
    fork_anchor       text        NOT NULL DEFAULT '',
    archived          boolean     NOT NULL DEFAULT false,
    pinned            boolean     NOT NULL DEFAULT false,
    -- Kept on the row because every conversation in the switcher shows it: counting a table per row
    -- in a list of five hundred is the one query that would make the list slow.
    message_count     integer     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    -- When the turn now under way started. **Not the truth about a live turn** — that is only ever
    -- known in the memory of the process that spawned the CLI — but what a restart reads to settle
    -- a conversation whose turn died with its process.
    running_at        timestamptz,
    last_exit_code    integer,
    revision          bigint      NOT NULL DEFAULT 1,
    -- The sequence number the next appended record takes. It is here, and not a max() over the
    -- transcript, so that an append is one `UPDATE … RETURNING next_seq`: a row lock that orders
    -- the appends **of this conversation** and of no other. Two models writing into two
    -- conversations never wait for each other.
    next_seq          bigint      NOT NULL DEFAULT 1 CHECK (next_seq >= 1)
);

-- The switcher's order: most recently touched first, the pinned ones above them.
CREATE INDEX conversation_recent_idx ON conversation (pinned DESC, updated_at DESC);
CREATE INDEX conversation_folder_idx ON conversation (folder);
CREATE INDEX conversation_agent_idx ON conversation (agent);
-- The restart sweep, which asks one question: which conversations still claim a turn?
CREATE INDEX conversation_running_idx ON conversation (running_at) WHERE running_at IS NOT NULL;

CREATE TRIGGER conversation_touch BEFORE UPDATE ON conversation
    FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER conversation_change AFTER INSERT OR UPDATE OR DELETE ON conversation
    FOR EACH ROW EXECUTE FUNCTION record_conversation_change();

-- ── cards ─────────────────────────────────────────────────────────────────────

CREATE TABLE task (
    id              uuid        PRIMARY KEY,
    board_id        uuid        NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    -- Where the card is filed, or NULL for the **backlog**. ON DELETE SET NULL is the rule "a card
    -- whose column has gone is in the backlog, still on the board" written where it holds even for
    -- a column removed by hand.
    column_id       uuid        REFERENCES board_column (id) ON DELETE SET NULL,
    title           text        NOT NULL DEFAULT '',
    -- What kind of card it is, which is what every other field is read against. Text with a check
    -- rather than an enum type on purpose: adding a kind is then one transactional migration
    -- instead of an ALTER TYPE that cannot share a transaction with the rows that use it.
    type            text        NOT NULL DEFAULT 'human'
                                CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler')),
    -- The description: what is sent when the card is played. A play files it in the log as it goes
    -- out and **empties it**, the text having moved into the conversation.
    body            text        NOT NULL DEFAULT '',
    -- The record of the plays, run after run, each behind a thematic break. Written for a person;
    -- nothing reads it.
    log             text        NOT NULL DEFAULT '',
    status          text        NOT NULL DEFAULT 'ready'
                                CHECK (status IN ('draft', 'ready', 'running', 'waiting-refresh',
                                                  'interrupted', 'done', 'error')),
    -- What a turn is run with. Five columns rather than one document because they are a closed
    -- vocabulary the UI offers and a query filters on, and because "all five are named" is what
    -- decides whether an AI card can be played at all.
    agent           text,
    model           text,
    effort          text,
    permission      text,
    -- Where the turn runs, as a store link — from the root, with the leading slash.
    folder          text,
    -- Settings a newer instance wrote and this build has no meaning for. Carried, not read: a board
    -- imported from an instance ahead of this one is not quietly stripped of what it said.
    settings_extra  jsonb       NOT NULL DEFAULT '{}',
    -- A Scheduler's datetime, as the card writes it: 'YYYY-MM-DDTHH:mm', local wall clock.
    -- Deliberately **not** a timestamp — it is a moment in the operator's own zone, and storing an
    -- instant would make a board written before a daylight-saving change wait an hour off.
    scheduled_at    text        CHECK (scheduled_at IS NULL OR scheduled_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
    -- Where the card sits on the workflow face of the board, or NULL for one nobody has placed.
    spot_x          integer,
    spot_y          integer,
    -- The conversation it is played in. A chat outlives the play that made it and is only ever
    -- taken off by hand, so a deleted conversation leaves the card rather than the reverse.
    conversation_id text        REFERENCES conversation (id) ON DELETE SET NULL,
    -- The card played after this one, and what becomes of the chat between the two. Naming a card
    -- is the only thing that chains two of them: nothing about the column they sit in does.
    -- DEFERRABLE because a **pasted chain** arrives as one batch: card A naming card B is inserted
    -- before B exists, and an immediate check would refuse the paste for the order the rows happen
    -- to be in. Deferred to the end of the transaction, the batch is checked as a whole — and
    -- INITIALLY IMMEDIATE, so every *other* write still fails at the statement that was wrong
    -- rather than at a commit that cannot say which one it was.
    on_success_task_id uuid     REFERENCES task (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    on_success_mode text        NOT NULL DEFAULT 'end'
                                CHECK (on_success_mode IN ('continue', 'compact', 'end')),
    rank            text        COLLATE "C" NOT NULL CHECK (rank ~ '^[0-9a-z]+$' AND rank !~ '0$'),
    -- The run holding the card, or NULL when it is free. **A task is played by one run**, and this
    -- is what makes that true rather than hoped for: a claim is `UPDATE … WHERE run_id IS NULL`,
    -- so two runs reaching for one card end with one winner and one refusal.
    run_id          text,
    claimed_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    revision        bigint      NOT NULL DEFAULT 1,
    -- A claimed card names the moment it was claimed, and a free one names neither run nor moment.
    CONSTRAINT task_claim_is_whole CHECK ((run_id IS NULL) = (claimed_at IS NULL))
);

-- Drawing a board: every card of one board, in the order each column shows them. The id is in the
-- index because every read orders by `(rank, id)` — see the note on ties at the top of this file —
-- so the index answers the sort whole.
CREATE INDEX task_board_idx ON task (board_id, column_id, rank, id);
-- What a run holds, for the restart sweep.
CREATE INDEX task_run_idx ON task (run_id) WHERE run_id IS NOT NULL;
-- The cards a conversation was played in, for the chat panel's "which card is this?".
CREATE INDEX task_conversation_idx ON task (conversation_id) WHERE conversation_id IS NOT NULL;
-- A Scheduler waiting for its moment, which is the one query a poll over every board makes.
CREATE INDEX task_scheduled_idx ON task (scheduled_at)
    WHERE type = 'scheduler' AND status = 'ready' AND scheduled_at IS NOT NULL;

CREATE TRIGGER task_touch BEFORE UPDATE ON task
    FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER task_change AFTER INSERT OR UPDATE OR DELETE ON task
    FOR EACH ROW EXECUTE FUNCTION record_task_change();

-- ── tags ──────────────────────────────────────────────────────────────────────
--
-- The **words themselves**, not ids pointing at a list. That is what lets a card be tagged by hand,
-- by a turn holding the `taskboard` skill, and by another instance a column was pasted from: `bug`
-- means bug wherever the board is read, while an id minted here would name nothing there.

CREATE TABLE task_tag (
    task_id  uuid    NOT NULL REFERENCES task (id) ON DELETE CASCADE,
    tag      text    NOT NULL CHECK (tag <> ''),
    -- The order the card wears them in. A plain integer and not a rank: a tag list is rewritten
    -- whole by the one editor that touches it, so there is no concurrent insertion to make room for.
    ordinal  integer NOT NULL,
    PRIMARY KEY (task_id, ordinal)
);

-- Each word once per card, however it is cased: a card carrying `bug` and `Bug` carries the first.
CREATE UNIQUE INDEX task_tag_word_key ON task_tag (task_id, lower(tag));
-- Filtering a board by tag, which is what the board filter does.
CREATE INDEX task_tag_word_idx ON task_tag (lower(tag));

-- ── transcripts ───────────────────────────────────────────────────────────────

CREATE TABLE transcript_record (
    conversation_id text        NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
    -- The record's place in the transcript, from the conversation's own counter, and the cursor a
    -- client reads from: `?since=<seq>` is how a tab that was away catches up.
    seq             bigint      NOT NULL,
    -- The record's own identity as the client knows it. Beside seq because a fork names the record
    -- it branches from, and an id is stable under a trim that renumbers nothing.
    id              text        NOT NULL,
    role            text        NOT NULL CHECK (role IN ('user', 'assistant', 'notice')),
    -- `body` rather than `text`, and `said_at` rather than `at`: both of the obvious names are
    -- keywords PostgreSQL would want quoted at every mention.
    body            text        NOT NULL DEFAULT '',
    said_at         timestamptz NOT NULL DEFAULT now(),
    -- A line that happened between two turns rather than in one — a notice, a permission decision.
    between_turns   boolean     NOT NULL DEFAULT false,
    -- Display payloads: read whole with the record and drawn. Nothing queries inside them, which is
    -- exactly when a document column is the right answer and not a shortcut.
    blocks          jsonb,
    tools           jsonb,
    attachments     jsonb,
    model           text,
    effort          text,
    permission_mode text,
    exit_code       integer,
    interrupted     boolean     NOT NULL DEFAULT false,
    -- The reply was cut at the service's ceiling, so the gap is visible instead of reading as an
    -- answer that simply stopped.
    truncated       boolean     NOT NULL DEFAULT false,
    session_anchor  text,
    PRIMARY KEY (conversation_id, seq)
);

CREATE INDEX transcript_record_id_idx ON transcript_record (conversation_id, id);

-- A transcript is not versioned and has no touch trigger: a record is appended and never edited.
-- It does announce itself, because a tab watching a conversation is watching for exactly this.
CREATE TRIGGER transcript_record_change AFTER INSERT OR DELETE ON transcript_record
    FOR EACH ROW EXECUTE FUNCTION record_transcript_change();
