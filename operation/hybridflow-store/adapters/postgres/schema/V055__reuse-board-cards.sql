-- Convert reusable definitions in place before retiring their schema. The latest
-- version includes draft edits. Existing instances already hold their own content.
LOCK TABLE flow_node_class, flow_node_class_version, flow_node_class_tag,
    workflow_class, flow_node, workflow, change_event IN ACCESS EXCLUSIVE MODE;

SELECT set_config('kiao.actor', 'migration', true);

-- Each pair of tables previously had independent UUID namespaces.
CREATE TEMP TABLE migrated_workflow ON COMMIT DROP AS
SELECT c.id AS source_id, CASE WHEN w.id IS NULL THEN c.id ELSE gen_random_uuid() END AS id
FROM workflow_class c LEFT JOIN workflow w ON w.id = c.id;

CREATE TEMP TABLE migrated_node ON COMMIT DROP AS
SELECT c.id AS source_id, CASE WHEN n.id IS NULL THEN c.id ELSE gen_random_uuid() END AS id
FROM flow_node_class c LEFT JOIN flow_node n ON n.id = c.id;

INSERT INTO workflow (id, board_id, name, created_at, updated_at)
SELECT m.id, c.board_id, c.name, c.created_at, c.updated_at
FROM workflow_class c JOIN migrated_workflow m ON m.source_id = c.id;

INSERT INTO flow_node (id, board_id, title, type, status, scheduled_at, duration,
                       spot_x, spot_y, size_w, size_h, workflow_id, created_at, updated_at)
SELECT m.id, c.board_id, c.title, c.type, 'draft', c.scheduled_at, c.duration,
       c.spot_x, c.spot_y, c.size_w, c.size_h, w.id, c.created_at, c.updated_at
FROM flow_node_class c
JOIN migrated_node m ON m.source_id = c.id
LEFT JOIN migrated_workflow w ON w.source_id = c.workflow_class_id;

INSERT INTO task (flow_node_id, body, criteria, multi_part_template, agent, harness, profile_id,
                  model, permission, runner, on_success_mode, on_success_compact)
SELECT m.id, coalesce(v.body, ''), coalesce(v.criteria, '[]'), coalesce(v.is_template, false),
       c.agent_selection->>'agent', c.agent_selection->>'harness', c.agent_selection->>'profileId',
       c.agent_selection->>'model', c.permission, c.runner, c.on_success_mode, c.on_success_compact
FROM flow_node_class c
JOIN migrated_node m ON m.source_id = c.id
LEFT JOIN LATERAL (
    SELECT body, criteria, is_template
    FROM flow_node_class_version
    WHERE flow_node_class_id = c.id
    ORDER BY version_number DESC
    LIMIT 1
) v ON true
WHERE c.type IN ('ai', 'human');

INSERT INTO flow_node_tag (flow_node_id, tag, ordinal)
SELECT m.id, t.tag, t.ordinal
FROM flow_node_class_tag t JOIN migrated_node m ON m.source_id = t.flow_node_class_id;

-- Keep guidance on the canvas, outside the task's executable description.
INSERT INTO flow_node (id, board_id, title, type, note, workflow_id)
SELECT gen_random_uuid(), c.board_id, concat_ws(' — ', nullif(c.title, ''), 'Note'), 'note', c.note, w.id
FROM flow_node_class c LEFT JOIN migrated_workflow w ON w.source_id = c.workflow_class_id
WHERE c.note ~ '[^[:space:]]';

CREATE TEMP TABLE migrated_link ON COMMIT DROP AS
SELECT src.id AS source_id, dst.id AS target_id
FROM flow_node_class c
JOIN flow_node_class target ON target.id = c.on_success_flow_node_class_id
JOIN migrated_node src ON src.source_id = c.id
JOIN migrated_node dst ON dst.source_id = target.id
WHERE c.type <> 'shutdown' AND c.board_id = target.board_id AND c.id <> target.id;

-- A common successor now needs a gateway. Any incoming branch can reach it.
CREATE TEMP TABLE migrated_join ON COMMIT DROP AS
SELECT target_id, gen_random_uuid() AS id
FROM migrated_link GROUP BY target_id HAVING count(*) > 1;

INSERT INTO flow_node (id, board_id, title, type, workflow_id)
SELECT j.id, n.board_id, concat_ws(' — ', 'Join', nullif(n.title, '')), 'exclusive-gateway', n.workflow_id
FROM migrated_join j JOIN flow_node n ON n.id = j.target_id;

INSERT INTO flow_node_successor (flow_node_id, successor_id, ordinal)
SELECT l.source_id, coalesce(j.id, l.target_id), 0
FROM migrated_link l LEFT JOIN migrated_join j USING (target_id)
UNION ALL
SELECT id, target_id, 0 FROM migrated_join;

INSERT INTO flow_node_route (flow_node_id, ordinal, condition, successor_id)
SELECT id, 0, 'true', target_id FROM migrated_join;

DELETE FROM change_event WHERE scope IN ('flowNodeClass', 'workflowClass');

-- Run the pending checks while all of their referenced tables still exist.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE flow_node DROP COLUMN class_version_id;
DROP TABLE flow_node_class_tag, flow_node_class_version, flow_node_class, workflow_class;
DROP FUNCTION record_flow_node_class_change(), record_flow_node_class_version_change(),
    record_workflow_class_change();

DROP VIEW change_event_feed;
DROP TABLE flow_node_class_change_event, workflow_class_change_event;

ALTER TABLE change_event DROP CONSTRAINT change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'workflow', 'agent', 'runner'));

CREATE OR REPLACE FUNCTION check_change_event_subtype() RETURNS trigger AS $$
DECLARE
    affected_seqs bigint[];
    event_seq bigint;
    event_scope text;
    subtype_count integer;
    subtype_scope text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        affected_seqs := ARRAY[NEW.seq];
    ELSIF TG_OP = 'DELETE' THEN
        affected_seqs := ARRAY[OLD.seq];
    ELSE
        affected_seqs := ARRAY[OLD.seq, NEW.seq];
    END IF;

    FOR event_seq IN SELECT DISTINCT unnest(affected_seqs) LOOP
        -- Serialize validation without conflicting with the subtype's FK key-share lock.
        SELECT scope INTO event_scope FROM change_event WHERE seq = event_seq FOR NO KEY UPDATE;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        SELECT count(*), min(scope) INTO subtype_count, subtype_scope FROM (
            SELECT 'board' AS scope FROM board_change_event WHERE seq = event_seq
            UNION ALL SELECT 'flowNode' FROM flow_node_change_event WHERE seq = event_seq
            UNION ALL SELECT 'workflow' FROM workflow_change_event WHERE seq = event_seq
            UNION ALL SELECT 'agent' FROM agent_change_event WHERE seq = event_seq
            UNION ALL SELECT 'runner' FROM runner_change_event WHERE seq = event_seq
        ) AS subtypes;

        IF subtype_count <> 1 OR subtype_scope IS DISTINCT FROM event_scope THEN
            RAISE EXCEPTION 'change event % must have exactly one subtype matching scope %', event_seq, event_scope
                USING ERRCODE = '23514', CONSTRAINT = 'change_event_one_subtype';
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE VIEW change_event_feed AS
SELECT e.seq, e.at, e.scope, e.kind, s.board_id, s.flow_node_id, s.agent_id,
       s.runner_id, s.workflow_id, e.actor, e.revision
FROM change_event e
JOIN (
    SELECT seq, board_id, NULL::uuid AS flow_node_id, NULL::uuid AS agent_id,
           NULL::uuid AS runner_id, NULL::uuid AS workflow_id
    FROM board_change_event
    UNION ALL
    SELECT seq, board_id, flow_node_id, NULL, NULL, NULL FROM flow_node_change_event
    UNION ALL
    SELECT seq, board_id, NULL, NULL, NULL, workflow_id FROM workflow_change_event
    UNION ALL
    SELECT seq, NULL, NULL, agent_id, NULL, NULL FROM agent_change_event
    UNION ALL
    SELECT seq, NULL, NULL, NULL, runner_id, NULL FROM runner_change_event
) s USING (seq);

COMMENT ON VIEW change_event_feed IS
    'Flat read projection of the event hierarchy for the cursor-based change feed.';
