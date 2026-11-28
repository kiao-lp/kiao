CREATE FUNCTION flow_node_has_context_reference(field_text text)
    RETURNS boolean LANGUAGE sql IMMUTABLE STRICT
    RETURN field_text ~ '\{\{\s*(input|currentWokflow|currentWorkflow)(\.[^{}\s]+)?\s*\}\}';

ALTER TABLE flow_node
    DROP CONSTRAINT flow_node_scheduled_at_check,
    ADD CONSTRAINT flow_node_scheduled_at_check
        CHECK (scheduled_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' OR flow_node_has_context_reference(scheduled_at)),
    DROP CONSTRAINT flow_node_pull_request_status,
    ADD CONSTRAINT flow_node_pull_request_status
        CHECK (pull_request_status IN ('OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED')
               OR flow_node_has_context_reference(pull_request_status)),
    DROP CONSTRAINT flow_node_commit_status,
    ADD CONSTRAINT flow_node_commit_status
        CHECK (commit_status IN ('INPROGRESS', 'SUCCESSFUL', 'FAILED', 'STOPPED')
               OR flow_node_has_context_reference(commit_status));

ALTER TABLE flow_node_class
    DROP CONSTRAINT flow_node_class_scheduled_at_check,
    ADD CONSTRAINT flow_node_class_scheduled_at_check
        CHECK (scheduled_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' OR flow_node_has_context_reference(scheduled_at));
