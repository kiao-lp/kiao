ALTER TABLE flow_node ADD COLUMN value_type text NOT NULL DEFAULT '';

COMMENT ON COLUMN flow_node.value_type IS 'Value type: empty, json-schema, or the id of a value card typed as JSON Schema.';
