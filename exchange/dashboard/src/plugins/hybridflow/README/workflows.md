---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Workflows

[Board guide](../README.md)

A workflow names a group of flow nodes; a node belongs to at most one. The board computes a
rectangle around its members. It has no independent position, chain or status. Moving a member
updates its bounds; dragging the rectangle moves its members. Rectangles sit behind arrows
and cards.

Use **Create workflow** in a card's menu to group the targeted flow nodes. The unnamed workflow opens in the
Workflow panel for naming. Flow nodes created, pasted or instantiated inside a workflow rectangle join that workflow.
Deleting the workflow ungroups its flow nodes and keeps their positions. Deleting its last member removes
the empty rectangle.

In **Folder**, enter the destination folder's DCMS link or drop a folder from the **File tree**.
In **Files**, drop the entries the workflow needs. The workflow stores DCMS links to those
entries. Use the cross on a row to remove its link.
Leave both fields empty for a workflow without file preparation. If either field is filled in,
the workflow needs both a folder and at least one file or folder.

Playing a **Start** event in the workflow creates the destination folder if needed. Start
copies the listed entries under their original names, including hidden files and subfolders,
before handing execution to the next node. A replay merges existing directories and replaces
files at the same paths. Give the selected entries distinct names.

Use `{{workflowFolder}}` in a task's working directory or description. For example, the
description link `[Brief](<{{workflowFolder}}/brief.md>)` opens the copy of `brief.md`.

Use **Copy workflow as JSON** on the rectangle to copy its flow nodes, folder and file references.
Use **Instantiate here** on the destination board to fill the copied descriptions before
creating the workflow. See [Clipboard guide](clipboard-and-archive.md).
