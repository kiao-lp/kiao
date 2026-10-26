-- V013 — the runners: the machines that play cards.
--
-- A runner is one files-service, serving one store root: the VPS is one and the home desktop is
-- another. A task names one by id in its settings — `task.runner` below — or names none and is
-- played wherever a Play is pressed. Naming one is played there and refused everywhere else, which
-- the runner saying so decides at the click: the work happens where that machine's folders are,
-- and a card about the home NAS is no card for the VPS to take.
--
-- There is deliberately **no foreign key** between the two, for the reason V003 gives for the
-- agent's absence: a card naming a runner that has gone must still open, say which runner it
-- wanted, and be refused at its next play with that name in the message.
--
-- `last_seen` is when the runner last said it was alive. Written by the heartbeat and by nothing
-- else — NULL for a runner that never has.

CREATE TABLE runner (
    id           uuid        PRIMARY KEY,
    -- What the task editor shows and what the panel lists. Unique across the store, read
    -- case-insensitively, because two runners called the same thing would be two rows of a select
    -- nobody can tell apart.
    name         text        NOT NULL CHECK (name <> ''),
    -- When the runner last called the heartbeat in, or NULL for one that never has.
    last_seen    timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    revision     bigint      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX runner_name_key ON runner (lower(name));

-- The stamps move on a rename and on nothing else: the heartbeat lands every few seconds, and a
-- revision that moved under every read would turn renaming a runner into a conflict, while an
-- `updated_at` it moved would say "changed just now" about a row nobody changed.
CREATE TRIGGER runner_touch BEFORE UPDATE ON runner
    FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
    EXECUTE FUNCTION touch_row();

-- The change feed learns a scope. The constraint V010 left is dropped and re-added with the new
-- word; nothing else about the log changes, and a runner belongs to no board, so a client
-- watching one board is never woken by one.
ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'conversation', 'transcript', 'agent', 'runner'));
ALTER TABLE change_event ADD COLUMN IF NOT EXISTS runner_id uuid;
CREATE INDEX IF NOT EXISTS change_event_runner_idx ON change_event (runner_id, seq);

CREATE OR REPLACE FUNCTION record_runner_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    -- An UPDATE that renamed nothing is a heartbeat, and the feed hears nothing of it: a
    -- heartbeat every few seconds per runner is not a change any client redraws on, and logging
    -- it would be thousands of rows a day waking every listener. The check is in the body rather
    -- than in a WHEN, because an INSERT trigger may not name OLD.
    IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
        RETURN NULL;
    END IF;
    INSERT INTO change_event (scope, kind, runner_id, actor, revision)
    VALUES ('runner', change_kind(TG_OP), coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER runner_change AFTER INSERT OR UPDATE OR DELETE ON runner
    FOR EACH ROW EXECUTE FUNCTION record_runner_change();

COMMENT ON TABLE runner IS
    'The machines that play cards: one files-service each, serving one store root. A task names '
    'one by id in its settings, or names none and is played wherever a Play is pressed.';

-- Which runner plays the task: a runner's id, or NULL for wherever a Play is pressed. No part of
-- whether the task can be played — a task missing a runner is simply not pinned — and no foreign
-- key, for the reason above.
ALTER TABLE task ADD COLUMN runner text;

COMMENT ON COLUMN task.runner IS
    'Which runner plays the task: a runner''s id, or NULL for wherever a Play is pressed.';

-- The two runners the store opens with. Their ids are fixed, so that a deployment names its own
-- in its env file: KIAO_FILES_SERVICE_RUNNER_ID on the VPS is the first of these.
INSERT INTO runner (id, name) VALUES
    ('c9f5e2a1-7b3d-4e6a-9e1c-2d4b6a8c0e12', 'VPS'),
    ('d3a7f1b9-4c2e-4a8d-b5e6-1f3a5c7d9e02', 'Home Desktop');
