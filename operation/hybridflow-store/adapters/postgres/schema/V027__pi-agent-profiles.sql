-- Profiles belong to the executing worker. Keep their references readable here even
-- when that worker is offline or no longer has the profile; there is no foreign key.
ALTER TABLE agent ADD COLUMN profile_id text NOT NULL DEFAULT '';
ALTER TABLE agent DROP CONSTRAINT IF EXISTS agent_platform_check;
ALTER TABLE agent ADD CONSTRAINT agent_platform_check
    CHECK (platform IN ('claude', 'codex', 'muse', 'opencode', 'pi'));
