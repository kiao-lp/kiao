-- V003 — the managed agents: the named definitions of what plays a task.
--
-- A task used to name the engine and the model itself, as two of its five settings. The engine is
-- an agent's **platform** now and the model the agent's, and the task names the agent by id — so
-- renaming the model a team plays on is one edit here rather than one edit per card, and so two
-- tasks played on the same engine under different standing instructions are two different things
-- to pick from.
--
-- The task's own columns stay as they are. `agent` now holds an id of this table for every card
-- written since, and `model` is what a card written before the move still says beside an engine —
-- read forgivingly, written nowhere. There is deliberately **no foreign key** between the two: a
-- card naming an agent that has gone must still open, say which agent it wanted, and be refused at
-- its next play with that name in the message — where a key would have refused the delete, or
-- nullified the reference nobody could then see.

CREATE TABLE agent (
    id           uuid        PRIMARY KEY,
    -- What the task editor shows and what a panel lists. Unique across the store, read
    -- case-insensitively, because two agents called the same thing would be two rows of a select
    -- nobody can tell apart.
    name         text        NOT NULL CHECK (name <> ''),
    platform     text        NOT NULL CHECK (platform IN ('claude', 'codex', 'muse')),
    -- The model the agent runs on, or '' for the CLI's own default — which is a real answer for an
    -- engine whose catalogue this service does not own, and what the runner falls back through.
    model        text        NOT NULL DEFAULT '',
    -- The standing orders the agent's turns are given, beside the prompt. Empty for most agents.
    instructions text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    revision     bigint      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX agent_name_key ON agent (lower(name));

CREATE TRIGGER agent_touch BEFORE UPDATE ON agent
    FOR EACH ROW EXECUTE FUNCTION touch_row();

-- The change feed learns a scope. The constraint V001 wrote inline is dropped and re-added with
-- the new word; nothing else about the log changes, and an agent belongs to no board, so a client
-- watching one board is never woken by one.
ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'column', 'task', 'conversation', 'transcript', 'agent'));
ALTER TABLE change_event ADD COLUMN IF NOT EXISTS agent_id uuid;
CREATE INDEX IF NOT EXISTS change_event_agent_idx ON change_event (agent_id, seq);

CREATE OR REPLACE FUNCTION record_agent_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event (scope, kind, agent_id, actor, revision)
    VALUES ('agent', change_kind(TG_OP), coalesce(NEW.id, OLD.id), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_change AFTER INSERT OR UPDATE OR DELETE ON agent
    FOR EACH ROW EXECUTE FUNCTION record_agent_change();

COMMENT ON TABLE agent IS
  'The named definitions of what plays a task: which engine, on which model, under which standing '
  'instructions. A task names one by id in its settings; a task written before this table names an '
  'engine and a model instead, which the runner still plays.';
