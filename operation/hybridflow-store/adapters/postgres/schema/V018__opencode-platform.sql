-- V018 — an agent may run on OpenCode.
--
-- The three words a `platform` could say were the three engines this build drove. OpenCode is the
-- fourth: the open-source agent behind `opencode run`, which a turn drives the way it drives
-- `codex exec` — one process per turn, JSON events on stdout, resumed by session id.
--
-- Widening a check is all this takes: no row says it yet, so nothing has to be converted and the
-- statement cannot be refused by the data.
ALTER TABLE agent DROP CONSTRAINT IF EXISTS agent_platform_check;
ALTER TABLE agent ADD CONSTRAINT agent_platform_check
    CHECK (platform IN ('claude', 'codex', 'muse', 'opencode'));
