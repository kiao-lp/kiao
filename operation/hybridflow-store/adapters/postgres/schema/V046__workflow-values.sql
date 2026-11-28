ALTER TABLE workflow ADD COLUMN runtime_values jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(runtime_values) = 'object');

COMMENT ON COLUMN workflow.runtime_values IS
    'Shared task values, updated when a member completes a play.';
