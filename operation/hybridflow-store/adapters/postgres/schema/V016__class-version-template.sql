-- V016 — a class version may be a template: a body the instantiation fills in rather
-- than copies.
--
-- `is_template` is the checkbox the class editor asks with. A version whose body holds
-- template-lang variables (`${project:text}`) says so, and instantiating the chain walks those
-- versions' templates one by one — in the editor, before any flow node is made — handing the
-- instantiated texts to the instantiate call, which asks each flow node the text handed for its
-- class instead of its version's body.
--
-- False for every version this finds: what was written as a description stays one.

ALTER TABLE flow_node_class_version ADD COLUMN is_template boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN flow_node_class_version.is_template IS
  'Whether the body is a template: one the instantiation fills in rather than copies. '
  'The editor asks it with a checkbox, and instantiating walks the chain''s templates '
  'one by one before any flow node is made.';
