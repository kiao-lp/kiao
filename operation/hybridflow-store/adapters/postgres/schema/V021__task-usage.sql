-- V021 — task usage: what each AI card spent, one row per report.
--
-- A runner finishes a turn — or a play — and files what the harness said it spent: the
-- card, the run, the model slug as said, and the tokens. The five token columns are splits,
-- not extras: input plus output is the spend, and cache and reasoning say where part of it
-- went. The mapping from a harness's words to these columns is approximate on purpose, and
-- lives in docs/architecture/containers/hybridflow-store/schema.md beside the table.
--
-- The key names task, so a Shutdown and a Scheduler cannot hold a row. Human tasks never
-- get one either, by the reporter's word rather than the schema's.
--
-- The table is append-only and deliberately quiet: rows are never updated, carry no
-- revision, and write no change event — a token report must not bump the card under an
-- editor's keystrokes, and no client redraws on one. Totals are SUMs at the read.
--
-- The id is minted by the reporter, so a spool replay re-sends the same row and the
-- second insert is a no-op rather than a double count.

CREATE TABLE task_usage (
    id                uuid        PRIMARY KEY,
    flow_node_id      uuid        NOT NULL REFERENCES task (flow_node_id) ON DELETE CASCADE,
    reported_at       timestamptz NOT NULL DEFAULT now(),
    run_id            text        NOT NULL DEFAULT '',
    model             text        NOT NULL DEFAULT '',
    input_tokens      bigint      NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens     bigint      NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cache_read_tokens bigint      NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens bigint     NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    reasoning_tokens  bigint      NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    cost_usd_micros   bigint      CHECK (cost_usd_micros IS NULL OR cost_usd_micros >= 0),
    extra             jsonb
);

COMMENT ON TABLE task_usage IS
  'What an AI card spent: one row per usage report a runner filed. Append-only, no '
  'revision, no change event — totals are SUMs at the read.';
COMMENT ON COLUMN task_usage.flow_node_id IS
  'The card the report is filed on. A task and not a flow node, so a Shutdown and a '
  'Scheduler cannot hold one; deleting the card takes its reports with it.';
COMMENT ON COLUMN task_usage.reported_at IS
  'When the harness said it — the turn''s end on the reporter''s clock, or the arrival '
  'where the reporter said nothing.';
COMMENT ON COLUMN task_usage.run_id IS
  'The run reporting it, in the vocabulary of flow_node.run_id.';
COMMENT ON COLUMN task_usage.model IS
  'The model slug as the harness said it, or empty for unknown.';
COMMENT ON COLUMN task_usage.reasoning_tokens IS
  'The split-out reasoning part, where the harness says it — never added on top of '
  'output_tokens, which keeps it folded where the harness folds it.';
COMMENT ON COLUMN task_usage.cost_usd_micros IS
  'What the reporter says the report cost, in millionths of a dollar, or NULL where the '
  'harness said nothing. The store never prices a report itself.';
COMMENT ON COLUMN task_usage.extra IS
  'What the harness said that these columns have no word for. Carried, never read.';

CREATE INDEX task_usage_flow_node_idx ON task_usage (flow_node_id, reported_at);
