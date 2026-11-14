-- V023 — the Parallel Gateway: a card that waits for every branch feeding into it, then
-- starts every branch leaving it.
--
-- It is the fifth kind of card, and the third the board plays to its own machine: no description,
-- no agent, no chat — firing it *is* what it does. What it waits for is written on the board
-- rather than on the card: every card naming this one as its successor. What it starts is written
-- on the card and is the reason for the new table: one successor is a column, and several are rows
-- of their own.
--
-- `flow_node_successor` holds those rows — a Gateway's branches, in the order the card lists them.
-- Two foreign keys, both `ON DELETE CASCADE`: deleting the Gateway takes its branches with it, and
-- deleting a branch takes it out of every list naming it, the way `ON DELETE SET NULL` takes a
-- deleted card out of the single chain. Both `DEFERRABLE` for the reason the single chain is: a
-- pasted Gateway arrives in one batch with the branches it names, and the batch is checked as a
-- whole.
--
-- The class table keeps its four kinds: a Gateway holds no words, so there is nothing reusable in
-- it to file as a class, and the service refuses one.

ALTER TABLE flow_node DROP CONSTRAINT flow_node_type_check;
ALTER TABLE flow_node ADD CONSTRAINT flow_node_type_check
    CHECK (type IN ('ai', 'human', 'shutdown', 'scheduler', 'gateway'));

CREATE TABLE flow_node_successor (
    flow_node_id uuid    NOT NULL REFERENCES flow_node (id) ON DELETE CASCADE
                        DEFERRABLE INITIALLY IMMEDIATE,
    successor_id uuid    NOT NULL REFERENCES flow_node (id) ON DELETE CASCADE
                        DEFERRABLE INITIALLY IMMEDIATE,
    -- The order the card lists them in. A plain integer and not a rank: the list is rewritten
    -- whole by the one editor that touches it, so there is no concurrent insertion to make room
    -- for.
    ordinal      integer NOT NULL,
    PRIMARY KEY (flow_node_id, successor_id)
);

COMMENT ON TABLE flow_node_successor IS
  'The branches a Gateway starts in parallel when it fires, in the order the card lists them. '
  'One row per branch; a Gateway alone holds any. Deleting either end removes the row: the '
  'Gateway''s branches go with it, and a deleted branch leaves every list that named it.';

-- The branches of one card, in the order the card lists them: what drawing a Gateway reads.
CREATE INDEX flow_node_successor_order_idx ON flow_node_successor (flow_node_id, ordinal);
