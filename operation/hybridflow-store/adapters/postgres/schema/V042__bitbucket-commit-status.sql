ALTER TABLE flow_node DROP CONSTRAINT flow_node_type_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_type_check
    CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler', 'bitbucket-pr-status',
                    'bitbucket-commit-status', 'gateway', 'exclusive-gateway', 'note', 'value'));

ALTER TABLE flow_node
    ADD COLUMN commit_id text,
    ADD COLUMN commit_status text,
    ADD CONSTRAINT flow_node_commit_fields
        CHECK (type = 'bitbucket-commit-status' OR (commit_id IS NULL AND commit_status IS NULL)),
    ADD CONSTRAINT flow_node_commit_status
        CHECK (commit_status IN ('INPROGRESS', 'SUCCESSFUL', 'FAILED', 'STOPPED'));
