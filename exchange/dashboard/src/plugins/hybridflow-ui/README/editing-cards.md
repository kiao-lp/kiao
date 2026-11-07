---
status: DRAFT
role: PRIMARY_SOURCE
---

# Editing cards

[Board guide](../README.md)

## Editing

A click opens the Node panel; a double-click opens the expanded editor instead. Both share
one draft through `FlowNodeEditing-ctx` and write individual fields. `FlowNodeControls`
provides the controls, arranged vertically in the panel and in rows in the expanded editor.
Closing the editor requires no Apply step.

The board tracks openings with `openingId`, so reopening the same node still updates the
panel. Selection is immediate; only panel reveal waits for `PANEL_AFTER_CLICK_MS` to distinguish
a double-click. If the panel is already visible, there is no reveal delay.

### Creating and typing

Canvas creation uses the selected kind, opens an unnamed node and requests title focus through
`titleCaret`. The panel honors that request only for its own node; unrelated openings do not
steal focus. An AI task receives the first agent and, where supported, `bypassPermissions`.
Effort and folder remain unset; see [settings](settings.md).

Task editors show title, [status and chat](status-and-chat.md), execution settings, successor,
criteria and description. The expanded editor adds Markdown source/preview, folding, insertion
and exports; AI tasks also show [usage totals](playing-flow-nodes.md#what-an-ai-card-spent).
Task input editing follows the [status rules](status-and-chat.md).

A **Value** node edits JSON in CodeMirror in both surfaces. They share incomplete drafts;
only valid JSON reaches the board, and write echoes preserve draft formatting. Its Type select
offers No type, JSON Schema, or schema values on this board. JSON Schema validates against the
meta-schema; choosing a schema value validates against that schema. Saving a schema value adds
it to other values' choices. A **Note** edits Markdown displayed directly on the canvas.

### Files and images

Dropping a store file into either task description inserts a store-root Markdown link at the
drop position. Pasting an image saves it to the chosen store folder (the board's folder by
default) and inserts a store-root image link at the caret. The preview and
[runner](playing-flow-nodes.md) resolve those links to the stored image; the turn receives its
actual path.

Both task editors share the [template selector](flow-node-templates.md). Instantiation changes
the description through the same write path.

### Editor lifetime

`expanded` belongs to board state. Selecting a node closes any previous expanded editor;
an opening that requests expansion enables it again. `ExpandedFlowNode` mounts beside the
board and pushes onto the Board host's stack, so panel visibility and board rereads do not
close an editor. Covered content stays mounted. There is no mask or focus trap; the file tree
and chat panels remain usable.

Leaving the board drops its in-memory content; returning reads it afresh. Dragging uses the
mouse; touch movement scrolls the canvas.

### Removal

Archive and Delete both confirm the targeted nodes. Archive hides them while preserving stored
records; Delete removes them. Cut first writes the clipboard, then removes nodes without a
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
