-- All connections share one ordered relation. Existing graphs are retained,
-- including legacy joins that must be repaired before they can be played.
INSERT INTO flow_node_successor (flow_node_id, successor_id, ordinal)
    SELECT id, on_success_flow_node_id, 0 FROM flow_node
    WHERE on_success_flow_node_id IS NOT NULL
    ON CONFLICT (flow_node_id, successor_id) DO NOTHING;

ALTER TABLE flow_node DROP COLUMN on_success_flow_node_id;
CREATE INDEX flow_node_successor_target_idx ON flow_node_successor (successor_id);
COMMENT ON TABLE flow_node_successor IS
    'Ordered connections between flow nodes. Tasks and schedulers have at most one '
    'successor and predecessor; shutdown has no successor; gateways allow both to be many.';

-- Topology writes on one board serialize before their deferred checks run.
CREATE FUNCTION lock_flow_node_connections() RETURNS trigger AS $$
DECLARE
    board uuid;
BEGIN
    IF TG_TABLE_NAME = 'flow_node' THEN
        board := NEW.board_id;
    ELSE
        SELECT board_id INTO board FROM flow_node WHERE id = NEW.flow_node_id;
        IF board IS NULL THEN
            SELECT board_id INTO board FROM flow_node WHERE id = NEW.successor_id;
        END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(board::text, 31));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flow_node_connection_lock BEFORE INSERT OR UPDATE ON flow_node_successor
    FOR EACH ROW EXECUTE FUNCTION lock_flow_node_connections();
CREATE TRIGGER flow_node_type_connection_lock BEFORE UPDATE OF type ON flow_node
    FOR EACH ROW EXECUTE FUNCTION lock_flow_node_connections();

CREATE FUNCTION check_flow_node_connections(node_id uuid) RETURNS void AS $$
DECLARE
    node flow_node;
    outgoing integer;
    incoming integer;
BEGIN
    SELECT * INTO node FROM flow_node WHERE id = node_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT count(*) INTO outgoing FROM flow_node_successor WHERE flow_node_id = node_id;
    SELECT count(*) INTO incoming FROM flow_node_successor WHERE successor_id = node_id;
    IF (node.type IN ('shutdown', 'note', 'value') AND outgoing > 0)
       OR (node.type <> 'gateway' AND outgoing > 1)
       OR (node.type <> 'gateway' AND incoming > 1)
       OR (node.type IN ('note', 'value') AND incoming > 0) THEN
        RAISE EXCEPTION 'card "%" has connections its type does not allow; use a gateway to join or split branches', node.title
            USING ERRCODE = '23514', CONSTRAINT = 'flow_node_connection_cardinality';
    END IF;
    IF EXISTS (
        SELECT 1 FROM flow_node_successor s
        JOIN flow_node target ON target.id = s.successor_id
        WHERE s.flow_node_id = node_id
          AND (target.board_id <> node.board_id OR target.id = node_id)
    ) THEN
        RAISE EXCEPTION 'card "%" must name a different card of the same board', node.title
            USING ERRCODE = '23514', CONSTRAINT = 'flow_node_connection_target';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION validate_flow_node_connections() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'flow_node' THEN
        PERFORM check_flow_node_connections(NEW.id);
    ELSIF EXISTS (SELECT 1 FROM flow_node_successor
                 WHERE flow_node_id = NEW.flow_node_id AND successor_id = NEW.successor_id) THEN
        PERFORM check_flow_node_connections(NEW.flow_node_id);
        PERFORM check_flow_node_connections(NEW.successor_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER flow_node_connections AFTER INSERT OR UPDATE ON flow_node_successor
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_flow_node_connections();
CREATE CONSTRAINT TRIGGER flow_node_type_connections AFTER UPDATE OF type ON flow_node
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_flow_node_connections();

-- A cascaded target deletion changes each surviving predecessor's visible links.
CREATE FUNCTION record_deleted_successor() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM flow_node WHERE id = OLD.successor_id) THEN
        UPDATE flow_node SET title = title WHERE id = OLD.flow_node_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER flow_node_deleted_successor AFTER DELETE ON flow_node_successor
    FOR EACH ROW EXECUTE FUNCTION record_deleted_successor();
