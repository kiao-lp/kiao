-- A scheduler either waits for a local datetime or counts a duration from its play.
ALTER TABLE flow_node ADD COLUMN duration text;
ALTER TABLE flow_node_class ADD COLUMN duration text;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_schedule_mode CHECK (scheduled_at IS NULL OR duration IS NULL);
ALTER TABLE flow_node_class ADD CONSTRAINT flow_node_class_schedule_mode CHECK (scheduled_at IS NULL OR duration IS NULL);
