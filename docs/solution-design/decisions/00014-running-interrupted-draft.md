---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-28
tags: ["hybridflow", "status", "board", "worker", "dashboard"]
triggers: ["card status", "running card", "stopped turn", "draft", "Play missing", "stale running", "running", "interrupted"]
supersedes: []
superseded_by: []
---

# 00014 — Tasks add running, interrupted, draft; only ready plays.

## Context and Problem Statement

A socket-driven spinner exposes running work only in the initiating tab. Marking a stopped
turn `done` implies completion, while `error` implies failure; neither describes a user stop.

## Considered Options

* Persist `running`, `interrupted` and explicit `draft` statuses.
* Show running state only through the initiating tab's socket state.
* Mark stopped turns as `done` or `error`.
* Interpret a missing status as `draft`.

## Decision Outcome

Chosen option: "Persist `running`, `interrupted` and explicit `draft` statuses", because
the board must record work in progress and distinct endings for every reader.

A run writes `running` before sending the prompt and keeps it while holding the task.
`interrupted` records a user-stopped turn or a task held when its run is stopped,
replaced or killed, including during a retry wait. `draft` marks work still being written.

Alongside `ready`, `done` and `error`, these make six statuses at this change.
Missing status continues to mean `ready`, preserving existing playable boards.
Only `ready` offers Play; the panel's select restores a task to that state.

### Consequences

* Bad, because every play adds a board write before the prompt.
* Bad, because killing the whole service can leave `running` persisted: the loop cannot
  execute its exit handling. That task must be reset by hand.
