---
status: DRAFT
role: PRIMARY_SOURCE
---

# Copy, cut, paste, clone, move and archive

[Board guide](../README.md)

## Copy, cut, paste and clone

Node menus offer **Copy … as JSON** and **Cut … as JSON**; the canvas menu pastes at its clicked
point. A gesture on a marked node targets the visible marked set; otherwise it targets one node.
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
| Status, description, tags, criteria and complexity | Retain |
| Managed agent and runner pin | Retain only if found in the destination store; legacy engine names travel |
| Class-version and workflow links | Remove; join the workflow at the paste point if any |
| Position | Clear; receiving layout places the nodes |

Agent and runner catalogues are read at paste time rather than using a possibly incomplete
screen cache. Clipboard failures or unreadable content produce a message. Multi-node copies
and pastes report counts; paste opens the first node. The Paste menu cannot promise a count
before the browser permits reading the clipboard.

### Cut

Write the clipboard **before** removing nodes. A denied clipboard write leaves the board intact.
Cut has no separate removal confirmation because the nodes can be pasted back. It can ask about
conversations left unused, since clipboard text does not carry chats.

### Move to another board

Move to… lists other boards in the same store. It creates the destination nodes first and
removes the originals only after success. A failed creation leaves the source intact.

Moves keep chat and agent references, clear position, remap internal successor links and drop
links to nodes left behind. They do not ask about deleting chats that moved with the nodes.
Classes move with all their versions. See `flowNodeMove.ts` and `flowNodeClassMove.ts`.

### Clone

Clone creates one node below the targeted node and opens it, independent of marks. It retains
content, settings and status, with a new ID, no chat and no exported output. Outgoing links stay
only when targeting Gateways, which allow another predecessor. It uses no clipboard.
See `boardOps.cloneFlowNode`.

## Archiving

Archive confirms the targeted nodes, then sets `archived: true` in one operation. Records stay
stored; no archive file is created. Archived nodes disappear from canvas, tag chips, successor
choices and node panels and cannot run. Stored links remain but are not drawn or followed into
hidden nodes. Multiple marked nodes archive behind one confirmation.

Afterward, the user may choose to delete chats no remaining **live** node on that board uses.
Archived references do not prevent that question. Already deleted chats are tolerated; other
failures are reported. See [useFlowNodeArchive.ts](../useFlowNodeArchive.ts). Delete and Cut
use the shared removal path for their chat question.

Archive hides records; Delete removes them. Neither silently discards a transcript.
