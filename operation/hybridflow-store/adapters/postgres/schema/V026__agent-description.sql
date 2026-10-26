-- Selection guidance belongs to the agent catalogue, never to the turn's instructions.
ALTER TABLE agent ADD COLUMN description text NOT NULL DEFAULT '';
