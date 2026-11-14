-- A card's chat is a reference to a conversation files-service owns, not a row of this
-- database.
--
-- V001 declared it a foreign key to conversation(id), which is a table nothing writes: turns run
-- in files-service, whose registry mints the ids, and nothing registers them here — the import
-- writes the link as a lookup yielding NULL when the conversation is absent, and POST
-- /conversations mints an id of its own. So every write of a run's chat onto its card was refused
-- with task_conversation_id_fkey, and every play stopped at its first turn.
--
-- The service layer never asked for the check — it binds the card to whatever chat id the caller
-- names, and the in-memory store sets it with no existence check — so lifting it aligns the
-- schema with the port rather than weakening it. The column and its index stay: the board still
-- says which chat each card was played in, and the run still reads it back to continue it.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_conversation_id_fkey;

COMMENT ON COLUMN task.conversation_id IS
    'The chat the card is played in, by the id files-service''s registry minted for it. '
    'A reference, not a foreign key: that registry is the conversation''s home, and this '
    'service carries the id so the board and the run agree on which chat a card belongs to.';
