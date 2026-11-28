---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Copy, cut, paste, clone, move and archive

[Board guide](../README.md)

## Copy and paste a workflow

Right-click a workflow rectangle and choose **Copy workflow as JSON**. On the destination
board, choose **Paste here** at the desired point. Press Ctrl+V (Cmd+V on macOS) to place
the copy below the existing cards, where it also goes if the chosen area is occupied.
Each paste creates a new workflow, including when the click is inside a workflow rectangle.

The JSON uses `kind: "kiao-workflow"` and `version: 1`. It holds the workflow name and optional
`values` under `workflow`, and every member (including archived and filtered flow nodes) in
`flowNodes`. Paste retains the shared `currentWorkflow` values, card sizes and relative
positions. The pasted workflow gets a new ID, and internal successor, route and schema
references use the new flow node IDs. A copied limiter keeps its **No passes left** branch only
when both successors are in the copied workflow.

Paste retains draft, blocked and archived settings. Other flow nodes start ready with fresh
limiter counters, empty execution histories and independent conversations. Agent and runner
selections carry over when the destination store holds the referenced IDs. Authored text
and asset links carry over verbatim.

## Copy, cut, paste and clone

Card menus offer **Copy … as JSON** and **Cut … as JSON**; the canvas menu pastes at its clicked
point. A gesture on a marked card targets the visible marked set. Any other card targets its own flow node.
Use [Move to…](#move-to-another-board) between boards in the same store to retain conversations.

Clipboard text uses the board's node shape in a versioned wrapper. One node uses the singular
form for compatibility; multiple nodes use the plural form:

```json
{ "kind": "kiao-flow-node", "version": 1, "flowNode": { "id": "task-1", "title": "Plan" } }
```

```json
{
  "kind": "kiao-flow-nodes",
  "version": 1,
  "flowNodes": [ { "id": "task-1", "title": "Plan" }, { "id": "task-2", "title": "Review" } ]
}
```

The reader also accepts bare node objects, bare node arrays and the old
`kiao-workflow-flow-node` wrapper. It rejects a bare board object with `flowNodes` rather than
mistaking the board header for one node.

| Data | Paste behavior |
| --- | --- |
| Node IDs | Always mint new IDs, including when pasting onto the source board |
| Successor links | Remap links whose endpoints are both copied; drop links to nodes outside the set |
| Mode and compaction | Retain even if the successor was dropped |
| Chat | Remove the instance-local conversation reference |
| Status | Copied AI and Human tasks start as Draft. Cut flow nodes and copies of other types keep their status. |
| Description, multi-part template switch, tags, criteria and complexity | Retain |
| Agent and runner pin | Retain only if found in the destination store. Legacy harness IDs travel with the node. |
| Workflow membership | Pasted flow nodes join the workflow at the paste point, if any |
| Position | Clear; receiving layout places the nodes |

Agent and runner catalogues are read at paste time rather than using a possibly incomplete
screen cache. Clipboard failures or unreadable content produce a message. Multi-node copies
and pastes report counts; paste opens the first node. The Paste menu cannot promise a count
before the browser permits reading the clipboard.

Use **Instantiate here** to fill [description templates](flow-node-templates.md) before creating the copies.

### Cut

Write the clipboard **before** removing nodes. A denied clipboard write leaves the board intact.
Cut has no separate removal confirmation because the nodes can be pasted back. It can ask about
conversations left unused, since clipboard text does not carry chats.

### Move to another board

Move to… lists other boards in the same store. It creates the destination nodes first and
removes the originals only after success. A failed creation leaves the source intact.

Moves keep chat and agent references, clear position, remap internal successor links and drop
links to nodes left behind. They do not ask about deleting chats that moved with the nodes.
See `flowNodeMove.ts`.

### Clone

Clone creates one node below the targeted node and opens it, independent of marks. Cloned AI
and Human tasks start as Draft. Other flow node types keep their status. The clone retains content
and settings, with a new ID, no chat and no exported output. Outgoing links stay only when
targeting Gateways, which allow another predecessor. It uses no clipboard.
See `boardOps.cloneFlowNode`.

## Archiving

Archive confirms the targeted nodes, then sets `archived: true` in one operation. Records stay
stored; no archive file is created. Archived nodes disappear from canvas, tag chips, successor
choices and node panels and cannot run. Successor links stay in the board data. Playback and
the canvas follow links between live nodes. Multiple marked nodes archive behind one confirmation.

Afterward, the user may choose to delete chats no remaining **live** node on that board uses.
Archived references do not prevent that question. Already deleted chats are tolerated; other
failures are reported. See [useFlowNodeArchive.ts](../useFlowNodeArchive.ts). Delete and Cut
use the shared removal path for their chat question.

Archive hides records; Delete removes them. Neither silently discards a transcript.
