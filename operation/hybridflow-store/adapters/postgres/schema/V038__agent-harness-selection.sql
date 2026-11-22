ALTER TABLE task ADD COLUMN harness text;
ALTER TABLE task ADD COLUMN profile_id text;

ALTER TABLE flow_node_class ADD COLUMN agent_selection jsonb NOT NULL DEFAULT '{}';
