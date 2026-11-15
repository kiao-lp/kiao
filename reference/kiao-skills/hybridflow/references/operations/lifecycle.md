---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Archive and delete

Read when archiving or deleting objects. Apply the shared [editing rules](../operations.md)
and refresh the affected references before removal.

Archiving a board or card is reversible. Board listings omit archived boards by default; card
archives hide cards and their links. Stored links from archived cards still occupy connection
slots. Unlink them explicitly if rewiring requires it.

Deletes are permanent. Delete only within the user's authorized scope; otherwise obtain agreement
on the objects to remove. Inspect references before deleting:

| Object | Effect |
|---|---|
| Board | Removes its cards, classes, versions and workflow groups. |
| Cards | Removes incoming links from surviving cards. Deleting a schema leaves missing schema ids on task outputs, refusing their next play until repaired. |
| Node classes | Removes their versions. Check affected instances and class chains. |
| Workflow or workflow class | Ungroups its members and retains them. |
| Agent | Only an unpublished agent can be deleted. Published agents are archived; cards naming a deleted draft need another agent. |
| Runner | Check and replace any task pins to that runner. |
