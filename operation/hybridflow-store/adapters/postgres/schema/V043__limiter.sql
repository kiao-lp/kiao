ALTER TABLE flow_node DROP CONSTRAINT flow_node_type_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_type_check
    CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler', 'bitbucket-pr-status',
                    'bitbucket-commit-status', 'gateway', 'exclusive-gateway', 'limiter', 'note', 'value'));

ALTER TABLE flow_node
    ADD COLUMN limiter_max_passes integer NOT NULL DEFAULT 0,
    ADD COLUMN limiter_remaining_passes integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT flow_node_limiter_passes
        CHECK (limiter_remaining_passes BETWEEN 0 AND limiter_max_passes
               AND (type = 'limiter' OR limiter_max_passes = 0));

CREATE OR REPLACE FUNCTION check_flow_node_connections(node_id uuid) RETURNS void AS $$
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
       OR (node.type NOT IN ('gateway', 'exclusive-gateway', 'limiter') AND outgoing > 1)
       OR (node.type = 'limiter' AND outgoing > 2)
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

COMMENT ON TABLE flow_node_successor IS
    'Ordered connections. The parallel gateway can also join, and a limiter can have two successors.';
