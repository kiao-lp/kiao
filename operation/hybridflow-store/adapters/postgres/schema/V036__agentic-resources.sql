-- The cutover preserves the live agent IDs in independent Git/APM projects.
DELETE FROM flow_node WHERE archived AND id IN (SELECT flow_node_id FROM task);
DROP TABLE agent_version;
DROP TABLE agent;
DROP FUNCTION retain_agent_version();
DROP FUNCTION record_agent_change();

CREATE TABLE task_execution (
    id text PRIMARY KEY,
    flow_node_id uuid NOT NULL REFERENCES flow_node(id) ON DELETE CASCADE,
    conversation_id text NOT NULL,
    turn_id text NOT NULL,
    runner_id text NOT NULL DEFAULT '',
    run_id text NOT NULL DEFAULT '',
    harness text NOT NULL CHECK(harness <> ''),
    model text NOT NULL CHECK(model <> ''),
    effort text NOT NULL CHECK(effort <> ''),
    agent_id text NOT NULL CHECK(agent_id <> ''),
    agent_repository text NOT NULL,
    agent_commit text NOT NULL CHECK(agent_commit ~ '^[0-9a-f]{40}$'),
    configuration jsonb NOT NULL,
    at timestamptz NOT NULL
);
CREATE INDEX task_execution_flow_node_idx ON task_execution(flow_node_id,at);
CREATE FUNCTION retain_task_execution() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'task execution provenance is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_execution_immutable BEFORE UPDATE ON task_execution
    FOR EACH ROW EXECUTE FUNCTION retain_task_execution();
