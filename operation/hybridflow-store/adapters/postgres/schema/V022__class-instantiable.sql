-- V022 — a node class says whether it is offered in the Instantiate menu.
--
-- `flow_node_class.instantiable` is the checkbox the class editor asks: ticked, the class is
-- listed in the canvas menu's "Instantiate class" submenu; unticked, it is not — though it is
-- still instantiated as the successor of a class that is. Off for every row this finds: what
-- was filed before the checkbox keeps out of the menu until somebody ticks it.

ALTER TABLE flow_node_class ADD COLUMN instantiable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN flow_node_class.instantiable IS
  'Whether the class is offered in the Instantiate menu. Off by default; a class nobody ticked '
  'is still instantiated as the successor of one that is.';
