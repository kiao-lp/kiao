---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Editing cards

[Board guide](../README.md)

## Editing

A click opens the Node panel. It edits through `FlowNodeEditing-ctx` and writes individual
fields. `FlowNodeControls` provides the controls, arranged vertically in the panel.
Editing requires no Apply step.

The board tracks openings with `openingId`, so reopening the same node still updates the
panel. A click selects the node and reveals the panel.

### Creating and typing

Canvas creation uses the selected kind, opens an unnamed node and requests title focus through
`titleCaret`. The panel honors that request only for its own node; unrelated openings do not
steal focus. An AI task receives the first agent and, where supported, `bypassPermissions`.
Effort and folder remain unset; see [settings](settings.md).

For tasks, the Node panel has **Spec**, **Options** and **Result** tabs to the left of the
status menu, template menu and Archive. The status symbol opens the list of states and stays
available on every tab. Spec shows the title, folder, description, output schema and success criteria
in that order. For AI tasks, Runner sits to the left of Folder in the same row, using 34% of the
available width while Folder uses 66%. Options shows agent settings, the
[conversation link](status-and-chat.md), task chaining, complexity and tags, in that order.
Result shows the stored task result and, for AI tasks, the cost and token totals, with cache
and reasoning details in a tooltip. Opening
another node returns to Spec; switching tabs keeps the description editor mounted.
Task input editing follows the [status rules](status-and-chat.md).

A **Value** node edits JSON in CodeMirror in the panel. It shares incomplete drafts;
only valid JSON reaches the board, and write echoes preserve draft formatting. Its Type select
offers No type, JSON Schema, or schema values on this board. JSON Schema validates against the
meta-schema; choosing a schema value validates against that schema. Saving a schema value adds
it to other values' choices. A **Note** edits Markdown displayed directly on the canvas.

### Files and images

Dropping a store file into the task description inserts a store-root Markdown link at the
drop position. Pasting an image saves it to the chosen store folder (the board's folder by
default) and inserts a store-root image link at the caret. The preview and
[runner](playing-flow-nodes.md) resolve those links to the stored image; the turn receives its
actual path.

The toolbar offers the [template menu](flow-node-templates.md). Instantiation changes
the description through the same write path.

### Panel lifetime

Selecting a node shows it in the Node panel; the panel's draft outlives a hidden toolbar tab.
Covered template forms stay mounted. There is no mask or focus trap; the file tree
and chat panels remain usable.

Leaving the board drops its in-memory content; returning reads it afresh. Dragging uses the
mouse; touch movement scrolls the canvas.

### Removal

Delete is available from the card's context menu. Archive and Delete both confirm the targeted
nodes. Archive hides them while preserving stored records; Delete removes them. Cut first writes
the clipboard, then removes nodes without a
separate removal confirmation. These actions can offer to delete conversations no remaining
live node on the board uses. See [clipboard and archive](clipboard-and-archive.md).

### Several cards at once

Ctrl-click (Cmd-click on macOS) toggles a mark. Escape clears marks; a plain click starts again
with one card. Marking does not open another editor or discard its draft.

**A gesture on a marked node targets the visible marked set; a gesture on an unmarked node
targets that node only.** This applies to drag, Delete, Copy, Cut, Move and Archive. Menus state
the affected count. Clone always targets one node.

Filtered-out nodes never participate, even if marked. Batch insertion and removal use one
board operation; Delete confirms the names once and asks about orphaned chats once.

`boardDom` resolves card positions from the DOM at pointer time. A ref registry would retain
stale geometry because antd Dropdown composes refs only at mount, causing moved cards to
receive chain links at their old positions.

## What a card shows

| Type | Canvas display |
| --- | --- |
| AI | Title, tags, status, agent and Play when eligible; missing required settings show a warning |
| Human | Title, tags and status, with a person marker |
| Shutdown | Thick event circle with power symbol, no outgoing knob |
| Scheduler | Clock event, wait label and direct Play/Stop when eligible; title stays editable in the panel |
| Gateway | Plus diamond and branch count |
| Note | Rendered Markdown |
| Value | Title with database symbol |

Tasks keep descriptions in their editors. Settled AI cards show the agent name (or legacy
model), leaving folder, effort and permission in the settings editor. A warning marks missing
requirements and the corresponding fields are highlighted there.

Status colors appear as a fixed-width left stripe on rectangular task cards or as the symbol's
ring. Error and active execution use a full outline. A played task's speech bubble opens its
conversation. See [status and chat](status-and-chat.md).
