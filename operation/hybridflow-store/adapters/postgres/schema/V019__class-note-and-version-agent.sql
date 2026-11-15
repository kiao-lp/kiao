-- V019 — a class carries a note, and an AI version a default agent.
--
-- `flow_node_class.note` is the note the class editor keeps beside the reusable card: what the
-- class is for, when to instantiate it, what its instances assume. A class's own words rather
-- than any version's — the succession beneath it is what changes, and the note says what stays
-- true about all of them — asked of every kind of class and copied to no instance.
--
-- `flow_node_class_version.agent` is the default agent of an AI version: the managed agent an
-- instance made from this version is played by at first. It sits with the version rather than
-- the class because successive versions may default to different agents, the way they say
-- different words; instantiating assigns it to the instance's task, which stays editable there.
-- Asked of an AI class's versions and of no other kind. There is deliberately **no foreign key**
-- between it and `agent`, for the reason V003 gives: a version naming an agent that has gone
-- must still open, say which agent it wanted, and be refused at its next write with that name
-- in the message — where a key would have refused the delete, or nullified the reference
-- nobody could then see.
--
-- Empty for every row this finds: what was filed with no note keeps none, and what was
-- instantiated with no agent keeps arriving naming none.

ALTER TABLE flow_node_class ADD COLUMN note text NOT NULL DEFAULT '';

COMMENT ON COLUMN flow_node_class.note IS
  'The note the class editor keeps beside the reusable card: what the class is for, when to '
  'instantiate it, what its instances assume. A class''s own words, asked of every kind and '
  'copied to no instance.';

ALTER TABLE flow_node_class_version ADD COLUMN agent text;

COMMENT ON COLUMN flow_node_class_version.agent IS
  'The default agent of an AI version: the managed agent an instance made from this version '
  'is played by at first. NULL for none — and for every version of a class that is no AI one.';
