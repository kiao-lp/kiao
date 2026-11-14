-- V007 — a card can say it is waiting on something that is not on the board.
--
-- The seven words a `status` could say were all either the user saying the card was or was not
-- finished being written, or a play saying what it had done with it. Neither covers the ordinary
-- case of work that is fully described and cannot start: an answer somebody owes, a deploy that has
-- to land first, a decision nobody has taken. Left `ready` such a card is the next one somebody
-- plays; set back to `draft` it reads as unfinished writing, and what it is actually waiting for is
-- lost. `blocked` is that eighth word, and it is the user's alone — no run writes it and none clears
-- it.
--
-- Widening a check is all this takes: no row says it yet, so nothing has to be converted and the
-- statement cannot be refused by the data. The column stays text with a check rather than an enum
-- for the reason the initial schema gives — adding a word is then one transactional migration.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_status_check;
ALTER TABLE task ADD CONSTRAINT task_status_check
    CHECK (status IN ('draft', 'ready', 'blocked', 'running', 'waiting-refresh',
                      'interrupted', 'done', 'error'));
