---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-17
tags: ["hybridflow", "board", "canvas", "format", "dashboard", "hybridflow-store", "worker"]
triggers: ["column", "backlog", "rank", "move route", "canvas", "fractional rank", "three faces", "board format", "column order", "task identity", "paste board", "clipboard", "nextColumnTitle", "board_column", "flow_node.column_id", "flow_node.rank", "/boards/{handle}/columns", "/boards/{handle}/flow-nodes/move", "V010", "spot"]
supersedes: []
superseded_by: []
---

# 00043 — Boards are one canvas; columns and backlog removed.

## Context and Problem Statement

Execution follows successor links, while columns provide filing rather than queue state
or order. Three board faces obscure chains; a backlog merely represents an unfiled card.

## Considered Options

* Present one canvas and remove column and backlog state.
* Keep column filing, fractional ranks and the board's multiple faces.

## Decision Outcome

Chosen option: "Present one canvas and remove column and backlog state", because the canvas
shows chains and the runner already finds nodes by ID and follows their links.

`hybridflow-ui` keeps the canvas without face-switching tabs. Nodes use `spot` for
position. Schema V010 drops `board_column`, `flow_node.column_id`, `flow_node.rank`,
change-log `column_id` and `column` scope; `/boards/{handle}/columns` and
`/boards/{handle}/flow-nodes/move` disappear with them. Fractional ranking,
neighbor-based filing and column-list merging are removed.

The coordinated wire change drops `columns`. Worker still reads legacy
`.workflow.json` forgivingly, including columns; the editor uses the column-free wire.
The fallback is one JSON board, not execution ordered by filenames in a folder.

Board and node UUIDs remain stable across edits and moves. Bodies are strings that can
contain Markdown headings; settings are structured. Clipboard paste copies data with new
IDs, and cut writes the clipboard before removing nodes, leaving the board intact if refused.
Concurrent edits follow the
[three-way merge](../../../exchange/dashboard/docs/solution-design/decisions/00017-board-merge-on-run.md).
