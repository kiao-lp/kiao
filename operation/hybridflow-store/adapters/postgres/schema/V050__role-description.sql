ALTER TABLE flow_node
    ADD COLUMN role_description text NOT NULL DEFAULT '',
    DROP CONSTRAINT flow_node_role_fields,
    ADD CONSTRAINT flow_node_role_fields
        CHECK (type = 'role' OR (role_id = '' AND cardinality(role_people) = 0 AND role_description = ''));
