LOCK TABLE board, flow_node, flow_node_class, flow_node_class_version,
    workflow, workflow_class, agent, runner IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE change_event IN ACCESS EXCLUSIVE MODE;

CREATE TABLE board_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    board_id uuid NOT NULL
);

CREATE TABLE flow_node_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    board_id uuid NOT NULL,
    flow_node_id uuid NOT NULL
);

CREATE TABLE flow_node_class_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    -- A version deleted with its class can no longer resolve the class's board.
    board_id uuid,
    flow_node_class_id uuid NOT NULL
);

CREATE TABLE workflow_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    board_id uuid NOT NULL,
    workflow_id uuid NOT NULL
);

CREATE TABLE workflow_class_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    board_id uuid NOT NULL,
    workflow_class_id uuid NOT NULL
);

CREATE TABLE agent_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    agent_id uuid NOT NULL
);

CREATE TABLE runner_change_event (
    seq bigint PRIMARY KEY REFERENCES change_event(seq) ON DELETE CASCADE,
    runner_id uuid NOT NULL
);

-- Subject identifiers outlive their rows so deletions remain replayable.
CREATE INDEX board_change_event_board_idx ON board_change_event(board_id, seq);
CREATE INDEX flow_node_change_event_board_idx ON flow_node_change_event(board_id, seq);
CREATE INDEX flow_node_class_change_event_board_idx ON flow_node_class_change_event(board_id, seq);
CREATE INDEX workflow_change_event_board_idx ON workflow_change_event(board_id, seq);
CREATE INDEX workflow_class_change_event_board_idx ON workflow_class_change_event(board_id, seq);
CREATE INDEX flow_node_change_event_node_idx ON flow_node_change_event(flow_node_id, seq);
CREATE INDEX flow_node_class_change_event_class_idx ON flow_node_class_change_event(flow_node_class_id, seq);
CREATE INDEX workflow_change_event_workflow_idx ON workflow_change_event(workflow_id, seq);
CREATE INDEX workflow_class_change_event_class_idx ON workflow_class_change_event(workflow_class_id, seq);
CREATE INDEX agent_change_event_agent_idx ON agent_change_event(agent_id, seq);
CREATE INDEX runner_change_event_runner_idx ON runner_change_event(runner_id, seq);

CREATE FUNCTION check_change_event_subtype() RETURNS trigger AS $$
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
            UNION ALL SELECT 'flowNodeClass' FROM flow_node_class_change_event WHERE seq = event_seq
            UNION ALL SELECT 'workflow' FROM workflow_change_event WHERE seq = event_seq
            UNION ALL SELECT 'workflowClass' FROM workflow_class_change_event WHERE seq = event_seq
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

CREATE CONSTRAINT TRIGGER change_event_subtype
    AFTER INSERT OR UPDATE ON change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER board_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON board_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER flow_node_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON flow_node_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER flow_node_class_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON flow_node_class_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER workflow_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON workflow_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER workflow_class_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON workflow_class_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER agent_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON agent_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();
CREATE CONSTRAINT TRIGGER runner_change_event_subtype
    AFTER INSERT OR UPDATE OR DELETE ON runner_change_event DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_change_event_subtype();

INSERT INTO board_change_event(seq, board_id)
SELECT seq, board_id FROM change_event WHERE scope = 'board';
INSERT INTO flow_node_change_event(seq, board_id, flow_node_id)
SELECT seq, board_id, flow_node_id FROM change_event WHERE scope = 'flowNode';
INSERT INTO flow_node_class_change_event(seq, board_id, flow_node_class_id)
SELECT seq, board_id, flow_node_class_id FROM change_event WHERE scope = 'flowNodeClass';
INSERT INTO workflow_change_event(seq, board_id, workflow_id)
SELECT seq, board_id, workflow_id FROM change_event WHERE scope = 'workflow';
INSERT INTO workflow_class_change_event(seq, board_id, workflow_class_id)
SELECT seq, board_id, workflow_class_id FROM change_event WHERE scope = 'workflowClass';
INSERT INTO agent_change_event(seq, agent_id)
SELECT seq, agent_id FROM change_event WHERE scope = 'agent';
INSERT INTO runner_change_event(seq, runner_id)
SELECT seq, runner_id FROM change_event WHERE scope = 'runner';

CREATE OR REPLACE FUNCTION record_board_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('board', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO board_change_event(seq, board_id)
    VALUES (new_seq, coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_flow_node_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('flowNode', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO flow_node_change_event(seq, board_id, flow_node_id)
    VALUES (new_seq, coalesce(NEW.board_id, OLD.board_id), coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_flow_node_class_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('flowNodeClass', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO flow_node_class_change_event(seq, board_id, flow_node_class_id)
    VALUES (new_seq, coalesce(NEW.board_id, OLD.board_id), coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_flow_node_class_version_change() RETURNS trigger AS $$
DECLARE
    new_seq bigint;
    class_row flow_node_class%ROWTYPE;
BEGIN
    SELECT * INTO class_row FROM flow_node_class
    WHERE id = coalesce(NEW.flow_node_class_id, OLD.flow_node_class_id);
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('flowNodeClass', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO flow_node_class_change_event(seq, board_id, flow_node_class_id)
    VALUES (new_seq, class_row.board_id, coalesce(NEW.flow_node_class_id, OLD.flow_node_class_id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_workflow_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('workflow', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO workflow_change_event(seq, board_id, workflow_id)
    VALUES (new_seq, coalesce(NEW.board_id, OLD.board_id), coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_workflow_class_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('workflowClass', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO workflow_class_change_event(seq, board_id, workflow_class_id)
    VALUES (new_seq, coalesce(NEW.board_id, OLD.board_id), coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_agent_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('agent', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO agent_change_event(seq, agent_id)
    VALUES (new_seq, coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_runner_change() RETURNS trigger AS $$
DECLARE new_seq bigint;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
        RETURN NULL;
    END IF;
    INSERT INTO change_event(scope, kind, actor, revision)
    VALUES ('runner', change_kind(TG_OP), kiao_actor(),
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.revision END)
    RETURNING seq INTO new_seq;
    INSERT INTO runner_change_event(seq, runner_id)
    VALUES (new_seq, coalesce(NEW.id, OLD.id));
    PERFORM announce(new_seq);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE change_event
    DROP COLUMN board_id,
    DROP COLUMN flow_node_id,
    DROP COLUMN flow_node_class_id,
    DROP COLUMN workflow_id,
    DROP COLUMN workflow_class_id,
    DROP COLUMN agent_id,
    DROP COLUMN runner_id;

COMMENT ON TABLE change_event IS
    'Shared event identity and metadata. Exactly one scope-specific subtype shares each seq; '
    'subject identifiers are held only by that subtype. Pruned by age with cascading subtype deletion.';

CREATE VIEW change_event_feed AS
SELECT e.seq, e.at, e.scope, e.kind, s.board_id, s.flow_node_id, s.flow_node_class_id,
       s.agent_id, s.runner_id, s.workflow_id, s.workflow_class_id, e.actor, e.revision
FROM change_event e
JOIN (
    SELECT seq, board_id, NULL::uuid AS flow_node_id, NULL::uuid AS flow_node_class_id,
           NULL::uuid AS agent_id, NULL::uuid AS runner_id,
           NULL::uuid AS workflow_id, NULL::uuid AS workflow_class_id
    FROM board_change_event
    UNION ALL
    SELECT seq, board_id, flow_node_id, NULL, NULL, NULL, NULL, NULL FROM flow_node_change_event
    UNION ALL
    SELECT seq, board_id, NULL, flow_node_class_id, NULL, NULL, NULL, NULL FROM flow_node_class_change_event
    UNION ALL
    SELECT seq, board_id, NULL, NULL, NULL, NULL, workflow_id, NULL FROM workflow_change_event
    UNION ALL
    SELECT seq, board_id, NULL, NULL, NULL, NULL, NULL, workflow_class_id FROM workflow_class_change_event
    UNION ALL
    SELECT seq, NULL, NULL, NULL, agent_id, NULL, NULL, NULL FROM agent_change_event
    UNION ALL
    SELECT seq, NULL, NULL, NULL, NULL, runner_id, NULL, NULL FROM runner_change_event
) s USING (seq);

COMMENT ON VIEW change_event_feed IS
    'Flat read projection of the event hierarchy for the existing cursor-based change feed.';
