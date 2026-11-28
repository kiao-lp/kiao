ALTER TABLE flow_node ADD COLUMN role_kind text NOT NULL DEFAULT '';

UPDATE flow_node SET role_kind = 'human' WHERE type = 'role';

ALTER TABLE flow_node ADD CONSTRAINT flow_node_role_kind CHECK (
    (type = 'role' AND role_kind IN ('human', 'agent'))
    OR (type <> 'role' AND role_kind = '')
);
