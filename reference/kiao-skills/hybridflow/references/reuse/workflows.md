---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Workflows and workflow classes

Read to group cards, group reusable definitions or instantiate a workflow class. Node classes
and their published versions are described in [classes](../classes.md).

A **workflow** names a group of cards; Dashboard draws a rectangle around its members. A
**workflow class** names a group of node classes. Both carry an id, name and revision, with no
body or position. Neither grouping determines execution order: links remain the order.

| Operation | Cards | Node classes |
|---|---|---|
| Create and assign members | `workflow_create`, `flowNodes` ids | `workflow_class_create`, `classes` ids |
| Read or rename | `workflow_get`, `workflow_patch` | `workflow_class_get`, `workflow_class_patch` |
| Change a member's group | Patch the card's `workflow` | Patch the class's `workflowClass` |
| Remove a group | `workflow_delete` | `workflow_class_delete` |

Membership is stored on each member, at most one group per card or class. Creating a group with
already-grouped members moves them. An empty membership id ungroups a member. Deleting the group
ungroups and retains its members. Members and their group must belong to the same board; a
workflow holds cards only, and a workflow class holds classes only.

`workflow_class_list` discovers reusable groups across boards. `workflow_class_instantiate`
creates a workflow on the destination board with one card per member class, each from its latest
published version. It accepts the same `spot` and template `bodies` options as class instantiation.
Complete instance settings and schemas before offering the resulting tasks for Play.
