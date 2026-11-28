---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Dashboard — board UI solution design

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md). Cross-container boundaries are in the
[hybridflow interaction design](/docs/solution-design/partitions/hybridflow/interactions.md);
card behavior and code locations are in the [board guide](../../README.md).

## Routes and panel lifetime

`/boards/<handle>` opens a board in the movable **Board** panel; `/boards` opens its list.
The **Boards** tab lists boards beside the document. Board routes keep Document mounted,
and document navigation retains the board, selection and controls in app-lifetime providers.
The handle stays stable when the board title changes, preserving bookmarks and links.

Both lists show expandable folders with indented board rows. Right-click a board to download,
rename, move or delete it. Right-click a folder to create a board in it, rename it or delete it.
Shift+F10 opens the menu on a focused row, and a long press opens it on touch screens. Folder
expansion is saved in Dashboard's server-side view state by screen size, as in File tree.
[Folder storage](/operation/hybridflow-store/docs/solution-design/schema.md)

A click to edit an AI or Human task sets `/tasks/<task-id>?board=<board-id>` in the address bar.
Opening that URL selects the board and reveals the **Flow node** editor. The `board` parameter accepts
the ID or stable handle. Without it, Dashboard resolves the board from the task ID. Task navigation
on the open board reuses its canvas and change subscription. Browser Back and Forward restore the
task selection. If the Board and Flow node tabs share an area, Dashboard moves Flow node to a side area so
both are visible.

`DashboardPlugin.appRoutes` declares prefixes before file-path resolution. An optional `panel`
identifies the tab to reveal; its route renderer selects panel content beside the document.
Routes without a panel replace the document view. core knows the prefix, renderer and
panel ID without knowing board semantics.

Board template forms use the **Board host's stack**. Search and
Git diffs use the Document host. Moving the tab or changing document types preserves board
state; see [central stacks](../../../../core/dashboard-ui/docs/solution-design/central-area.md).

The **Work on this task** panel publishes its own zoom control in the Board strip. Zoom
applies to the instructions, criteria and output editor. Submit stays at the panel's normal
size. Closing a panel restores the controls belonging to the panel below it.

## Writes and synchronization

A gesture pairs a pure local operation (`boardOps.ts`) with its specific service call
(`boardWrites.ts`). Do not infer requests by diffing snapshots or replace the entire board:
concurrent edits could become unintended delete/create operations.

Human submission awaits the queued write of output and `done` before advancing. A human
successor becomes `todo`; a ready, runnable successor starts a named chain through Hybridflow’s runner.
An unsuccessful save keeps the form and output available for retry. The runner reads saved
predecessor output when rendering the successor's `{{input}}` placeholders.

`useBoardSync` holds a watch request until the service reports changes, then three-way merges
incoming state via `mergeBoardContent`. Stable IDs keep execution updates and local edits
independent. The browser mints IDs when creating or pasting individual flow nodes.

## Connection limits and interchange

| Node kind | Predecessors | Successors |
| --- | --- | --- |
| Task or Scheduler | At most one | At most one |
| Shutdown | At most one | None |
| Parallel gateway | Several | Several |
| Exclusive gateway | Several | Several |
| Limiter | At most one | At most two, in branch order |
| Note or Value | None | None |

Dragging, selectors and cloning can add an incoming link to either gateway type.
Before Play, UI and runner
validate the live connected component and name an invalid node; independent chains remain
playable. The runner also validates restarts and resumes. Archived links reserve predecessor
slots while remaining excluded from execution.

Downloads use version 1 with scalar successor IDs for tasks and Schedulers, branch lists for
gateways and ordered `routes` for exclusive gateways. Limiter archives retain both counts and
branch order. AI chat actions carry explicit continuation
modes. Imports validate connection limits before creating a board.

## Store files and geometry

Boards are database records. Pasted images are ordinary store files under the board's handle
folder, such as `/boards/major/`, so renaming a board does not orphan them. Archiving updates
a node's boolean flag; it creates no Markdown archive file.

Workflow rectangles derive bounds from member positions (`workflowBounds.ts`), with padding
and label space. Dragging a rectangle moves its members through the same spot operation as
node dragging. Clicking its background opens the Workflow panel. Empty or entirely hidden
membership draws nothing; removing the final member removes the empty workflow.

Dashboard serializes the loaded workflow and its members when copying to the clipboard.
Agents get the same format from hybridflow-store. Both paste through the store, which
remaps references and commits the new group and members together. Dashboard refreshes the
board after that write.

A selected card draws four edge handles. Dragging one resizes the card through the same
field-level write as any other edit: the width from a side, the height from the top or bottom.
A left or top edge moves the spot so the opposite edge stays where it was; the card is not
translated as a whole. `cardSizeOf` clamps a stored size to the kind's minimum, and Gateway
and event minima keep their shapes and side controls inside the card. A stored height fixes
the box; without one the card keeps its natural height, which is what lets narrowed text wrap
and grow it. The measured height still wins for arrow endpoints, so arrows follow the drawn box.
