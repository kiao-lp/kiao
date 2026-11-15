ALTER TABLE agent RENAME COLUMN platform TO harness;
ALTER TABLE agent RENAME CONSTRAINT agent_platform_check TO agent_harness_check;

ALTER TABLE agent_version DISABLE TRIGGER agent_version_immutable;
UPDATE agent_version
SET configuration = (configuration - 'platform') || jsonb_build_object('harness', configuration->'platform')
WHERE configuration ? 'platform' AND NOT configuration ? 'harness';
ALTER TABLE agent_version ENABLE TRIGGER agent_version_immutable;

COMMENT ON COLUMN agent.harness IS 'The execution harness selected by this workflow agent.';
