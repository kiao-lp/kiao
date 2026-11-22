ALTER TABLE flow_node ADD COLUMN output_type text NOT NULL DEFAULT '';
ALTER TABLE flow_node ADD COLUMN output jsonb;

CREATE INDEX flow_node_output_type ON flow_node (output_type) WHERE output_type <> '';

COMMENT ON COLUMN flow_node.output_type IS 'AI output schema value id, from any board. Missing references remain visible.';
COMMENT ON COLUMN flow_node.output IS 'Structured export from the last successful play; cleared on a new claim.';
