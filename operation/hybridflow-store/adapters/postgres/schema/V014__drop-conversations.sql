-- V014 — the conversations go: this service keeps the boards, and files-service keeps the chats.
--
-- V001 filed conversations and their transcripts here — `conversation` + `transcript_record` — and
-- V002 is where that stopped being true in anything but the schema: turns run in files-service,
-- whose registry mints the ids and keeps the transcripts, and nothing ever registered them here.
-- The tables stood empty beside the boards, announced on a feed nobody read, through an API
-- nothing called.
--
-- What this drops, and what it keeps:
--
--   - `conversation` and `transcript_record` go whole — the tables, their triggers, and the two
--     functions that announced their changes. Nothing is migrated out of them: the chats a card
--     names live in files-service, and always did.
--   - The change log's `conversation` and `transcript` scopes go with them, and the rows already
--     in the log under them: a scope outside the check would refuse every future write. The
--     `conversation_id` column goes with the scopes it existed for.
--   - `task.conversation_id` stays. It names a chat of files-service's registry by its id — a
--     reference, not a key, since V002 — and the board still says which chat each card was played
--     in.
--
-- ── the tables go ──────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS conversation_change ON conversation;
DROP TRIGGER IF EXISTS conversation_touch ON conversation;
DROP TRIGGER IF EXISTS transcript_record_change ON transcript_record;
DROP TABLE IF EXISTS transcript_record;
DROP TABLE IF EXISTS conversation;
DROP FUNCTION IF EXISTS record_conversation_change();
DROP FUNCTION IF EXISTS record_transcript_change();

-- ── the change log stops knowing the words ──────────────────────────────────

DELETE FROM change_event WHERE scope IN ('conversation', 'transcript');

DROP INDEX IF EXISTS change_event_conversation_idx;
ALTER TABLE change_event DROP COLUMN IF EXISTS conversation_id;

ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_scope_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_scope_check
    CHECK (scope IN ('board', 'flowNode', 'agent', 'runner'));

COMMENT ON TABLE change_event IS
  'Append-only log of what changed, written by trigger in the transaction of the write. Clients hold a seq and ask for what came after it. Pruned by age, not kept for ever.';
