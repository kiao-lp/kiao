-- V005 — shortening a card's chat stops being a transition mode and becomes a box of its own.
--
-- `on_success_mode` had three words, and one of them said two things at once: `compact` meant
-- *shorten this chat and hand it on*. Two answers in one word is one answer that cannot be given
-- on its own — a card that wants its conversation shortened and ended had no way to say so, and a
-- card in the middle of a chain could not be asked the two questions separately.
--
-- So the mode keeps the question it can answer — who gets the conversation next — and the other
-- becomes `on_success_compact`: what this card leaves its own chat as, which a card with nothing
-- after it answers as plainly as one in the middle of a chain.
--
-- Every row that said `compact` said both halves, so it is rewritten as both. The order matters:
-- the column is added and filled before the check is narrowed, or the narrowing refuses the very
-- rows it is there to convert.

ALTER TABLE task ADD COLUMN IF NOT EXISTS on_success_compact boolean NOT NULL DEFAULT false;

UPDATE task
   SET on_success_compact = true,
       on_success_mode = 'continue'
 WHERE on_success_mode = 'compact';

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_on_success_mode_check;
ALTER TABLE task ADD CONSTRAINT task_on_success_mode_check
    CHECK (on_success_mode IN ('continue', 'end'));
