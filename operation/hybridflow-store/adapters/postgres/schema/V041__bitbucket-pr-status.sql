ALTER TABLE flow_node DROP CONSTRAINT flow_node_type_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_type_check
    CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler', 'bitbucket-pr-status',
                    'gateway', 'exclusive-gateway', 'note', 'value'));

ALTER TABLE flow_node
    ADD COLUMN pull_request_id text,
    ADD COLUMN pull_request_status text,
    ADD CONSTRAINT flow_node_pull_request_fields
        CHECK (type = 'bitbucket-pr-status' OR (pull_request_id IS NULL AND pull_request_status IS NULL)),
    ADD CONSTRAINT flow_node_pull_request_status
        CHECK (pull_request_status IN ('OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'));
