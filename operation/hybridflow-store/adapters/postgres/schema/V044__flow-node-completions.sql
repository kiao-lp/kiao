CREATE SEQUENCE flow_node_completion;

ALTER TABLE flow_node ADD COLUMN completion bigint NOT NULL DEFAULT 0;

-- A replayed parallel gateway waits for input completions since it last fired.
-- Existing rows start at zero. Only a new completion advances their position.
CREATE FUNCTION record_flow_node_completion() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'done' THEN
        NEW.completion := nextval('flow_node_completion');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flow_node_completion BEFORE UPDATE OF status ON flow_node
    FOR EACH ROW EXECUTE FUNCTION record_flow_node_completion();
