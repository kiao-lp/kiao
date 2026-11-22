ALTER TABLE flow_node DROP CONSTRAINT IF EXISTS flow_node_status_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_status_check
    CHECK (status IN ('draft', 'ready', 'todo', 'blocked', 'running', 'waiting-refresh',
                      'interrupted', 'done', 'error'));
