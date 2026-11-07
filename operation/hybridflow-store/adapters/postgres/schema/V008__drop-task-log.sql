-- V008 — the record of a card's plays goes, and the description stays where it is.
--
-- A card kept a `log`: the description quoted as it went out, and under it what came back, run
-- after run. That copy is gone: what the turn said is in the conversation the card names, and that
-- is the one record of it. A play sends the description and marks the card where it stands, and
-- writes nothing about either onto the card — which is also the end of the box that emptied when
-- the turn ended. Dropping the column is all this takes: nothing else names it, and the rows keep
-- everything they held but the copy.
ALTER TABLE task DROP COLUMN IF EXISTS log;
