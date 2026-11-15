ALTER TABLE flow_node DROP CONSTRAINT flow_node_type_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_type_check
    CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler', 'gateway', 'note', 'value'));

ALTER TABLE flow_node ADD COLUMN note text NOT NULL DEFAULT '';
ALTER TABLE flow_node ADD COLUMN value jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN flow_node.note IS 'Markdown on note cards; empty on every other kind.';
COMMENT ON COLUMN flow_node.value IS 'JSON payload on value cards; {} on every other kind.';
