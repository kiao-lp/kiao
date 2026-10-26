---
id: "00059"
title: "a board is one canvas: the columns and the backlog go"
status: accepted
date: 2026-09-17
tags: ["hybridflow", "board", "canvas"]
components: ["dashboard", "hybridflow-store", "worker"]
paths: []
symbols: ["board_column", "flow_node.column_id", "flow_node.rank", "/boards/{handle}/columns", "/boards/{handle}/flow-nodes/move", "V010", "spot"]
triggers: ["column", "backlog", "rank", "move route", "canvas", "fractional rank", "three faces"]
supersedes: ["00019"]
superseded_by: []
---

# 00059 — a board is one canvas: the columns and the backlog go

**Decision:** the hybridflow board has no columns and no backlog any more — not in the editor, not
in the store. `hybridflow-ui` draws the one face that is left, the canvas, with no tabs to switch
between; a flow node carries no `column` and says where it sits with its `spot`. In
`hybridflow-store` the `board_column` table is dropped by schema migration `V010`, with
`flow_node.column_id`, `flow_node.rank`, the change log's `column_id` and the `column` scope, and
the `/boards/{handle}/columns` and `/boards/{handle}/flow-nodes/move` routes go with them.
**Why:** a column was a place to file a card and nothing more — not a queue, not a state, not an
order — and the board was read for what runs after what, which a filing cannot say. Three faces of
one board were two ways of not seeing the chains, and the backlog was what a card said by being in
no column. With the filing goes the ordering inside it: the fractional ranks, the neighbour-based
placement, the merge of column lists.

**The wire broke on purpose, like the rename before it.** `hybridflow-store`, worker and
Dashboard are built and deployed together; worker's runner never filed anything by column —
it finds cards by id and follows chains — so its client drops the `columns` list and nothing else.
The `.workflow.json` documents the document fallback still reads keep their shape: worker
reads them forgivingly, columns included, and the editor reads the wire, which has none.

## Refactor notes

Drops columns from editor, store and wire; the `.workflow.json` fallback reader stays forgiving (columns included).
