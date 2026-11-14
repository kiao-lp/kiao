---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-31
tags: ["hybridflow", "board", "sync", "dashboard"]
triggers: ["board overwritten", "concurrent edit", "conflict", "two writers", "stale write", "pre-write check", "mergeBoardContent", "boardMerge.ts", "useBoardSync"]
supersedes: []
superseded_by: []
---

# 00017 — Boards merge service and screen versions field by field.

## Context and Problem Statement

Playback and the user can edit the same board concurrently. Synchronization must preserve
independent execution updates and local edits without locking the editor.

## Considered Options

* Merge the last service state, local edits and incoming service state by stable IDs.
* Lock the entire editor during concurrent execution.

## Decision Outcome

Chosen option: "Merge the last service state, local edits and incoming service state by stable IDs",
because field-level reconciliation lets independent changes survive while editing continues.

`useBoardSync` retains the last service state, local state and incoming service state;
`mergeBoardContent` reconciles them by stable IDs, separately from document disk-sync codecs.

Fields unchanged locally take incoming values. Local changes win, including conflicting
edits. Incoming additions are included; service deletions remove entries unless edited
locally. Rearranged local order is retained, with new service IDs placed relative to their
neighbors.

### Consequences

* Bad, because conflicting prose edits are not spliced: local text wins.

## More Information

The [board UI design](../../../src/plugins/hybridflow-ui/docs/solution-design/board-ui.md)
describes watching, writes and synchronization errors.
