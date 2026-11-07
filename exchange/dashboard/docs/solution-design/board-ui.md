---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dashboard — board UI solution design

Part of the [Dashboard solution design](README.md). Cross-container boundaries are in the
[hybridflow interaction design](/docs/solution-design/partitions/hybridflow/interactions.md);
card behavior and code locations are in the [board guide](../../src/plugins/hybridflow-ui/README.md).

## Routes and panel lifetime

`/boards/<handle>` opens a board in the movable **Board** panel; `/boards` opens its list.
The **Boards** tab lists boards beside the document. Board routes keep Document mounted,
and document navigation retains the board, selection and controls in app-lifetime providers.
The handle stays stable when the board title changes, preserving bookmarks and links.

`CmsPlugin.appRoutes` declares prefixes before file-path resolution. An optional `panel`
identifies the tab to reveal; its route renderer selects panel content beside the document.
Routes without a panel replace the document view. cms-core knows the prefix, renderer and
panel ID without knowing board semantics.

Expanded node editors and board template forms use the **Board host's stack**. Search and
Git diffs use the Document host. Moving the tab or changing document types preserves board
state; see [central stacks](central-area.md).

## Writes and synchronization

A gesture pairs a pure local operation (`boardOps.ts`) with its specific service call
(`boardWrites.ts`). Do not infer requests by diffing snapshots or replace the entire board:
concurrent edits could become unintended delete/create operations.

`useBoardSync` holds a watch request until the service reports changes, then three-way merges incoming state via `mergeBoardContent`. Stable IDs keep execution updates and local edits independent. The browser mints IDs for rendering and clipboard remapping. The service accepts well-formed IDs and rejects malformed ones; it never replaces them silently.

## Connection limits and interchange

| Node kind | Predecessors | Successors |
| --- | --- | --- |
| Task or Scheduler | At most one | At most one |
| Shutdown | At most one | None |
| Gateway | Several | Several |
| Note or Value | None | None |

Dragging and selectors reject an occupied target unless it is a Gateway. Clones retain
outgoing links only where targets allow another predecessor. Before Play, UI and runner
validate the live connected component and name an invalid node; independent chains remain
playable. The runner also validates restarts and resumes. Archived links reserve predecessor
slots while remaining excluded from execution.

Downloads use version 1: scalar successor IDs for tasks and Schedulers, lists for Gateways, no duplicated predecessor list. AI chat actions carry explicit continuation modes. Imports validate connection limits before creating a board.

## Store files and geometry

Boards are database records. Pasted images are ordinary store files under the board's handle
folder, such as `/boards/major/`, so renaming a board does not orphan them. Archiving updates
a node's boolean flag; it creates no Markdown archive file.

Workflow rectangles derive bounds from member positions (`workflowBounds.ts`), with padding
and label space. Dragging a rectangle moves its members through the same spot operation as
node dragging. Clicking its background opens the Workflow panel. Empty or entirely hidden
membership draws nothing; removing the final member removes the empty workflow.
