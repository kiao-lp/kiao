-- V025 — archiving a card is a boolean flip, not a file and not a delete.
--
-- The old gesture wrote the card out as markdown beside the board and took it off. The card now
-- stays where it is with `archived` set: hidden everywhere, links to and from it hidden too, and
-- never playable while hidden. No backfill beyond the default: every existing card stands unarchived.
ALTER TABLE flow_node ADD COLUMN archived boolean NOT NULL DEFAULT false;
CREATE INDEX flow_node_archived_idx ON flow_node (board_id) WHERE archived;
