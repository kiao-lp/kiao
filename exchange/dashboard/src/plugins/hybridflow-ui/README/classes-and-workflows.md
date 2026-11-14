---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Node classes and workflows

[Board guide](../README.md)

## Node classes

A node class is a reusable card. Instantiation creates flow nodes; the class itself never runs.
Classes can represent AI, Human, Shutdown or Scheduler nodes, chain to other classes, move
between boards with all versions, and belong to workflow classes.

| Owner | Fields and rules |
| --- | --- |
| Class | Title, kind, tags, successor class; AI permission and runner; Scheduler timing |
| Class note | Purpose, guidance and assumptions; never copied to instances |
| Version | Description, success criteria, template mode and AI default agent |
| Instance | Links to the class version it was made from; supplies its own execution state |

Classes have no folder, effort, chat or status. Only draft versions can be edited or deleted;
published versions are read-only. New versions start from the selected version. Instantiation
uses the latest published version and keeps older versions for statistics. Breaking an
instance's version link changes nothing else about the node.

**Instantiable** defaults off and controls whether a class appears in the canvas Instantiate submenu, grouped
by board beside workflow classes. A class card's own menu can instantiate it regardless of that
flag. Successors are followed even when their own flag is off. Menus refresh the class list when
opened.

Instantiation places the class and its successors at the clicked point, using each latest
published version. It stops at an absent, deleted or already visited class. Template-mode
versions open the [template panel](flow-node-templates.md) in chain order; cancelling any panel
creates nothing. A class with no published version is refused by the service. A class card's
own Instantiate action places nodes below it on the same board.

Create a class from the canvas menu, or convert a task through its card menu. Conversion copies
the task's words into the initial version. Class chains never connect directly to flow nodes.

## Workflows

A workflow names a group of flow nodes; a node belongs to at most one. The board computes a
rectangle around its members. It has no independent position, chain or status. Moving a member
updates its bounds; dragging the rectangle moves its members. Rectangles sit behind arrows
and cards.

Use **Create** in a card's menu to group the targeted cards. The unnamed workflow opens in the
Workflow panel for naming. Cards created, pasted or instantiated inside a rectangle join it.
Removing the rectangle ungroups its cards without moving them; deleting its last member removes
the empty rectangle.

A **workflow class** groups node classes in the same way. Instantiation creates a workflow from
its members only, in member order, resolving templates before creating any nodes.
