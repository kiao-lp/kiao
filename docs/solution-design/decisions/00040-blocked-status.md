---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-15
tags: ["hybridflow", "status", "board", "dashboard", "worker", "hybridflow-store"]
triggers: ["blocked card", "waiting on", "pink card", "not playable", "waiting-refresh mirror", "Blocked column", "taskStatus.ts", "workflowStatusBlocked", "entities.StatusBlocked", "V007", "canPlay", "StartPlay", "ClaimTask", "Held()", "--task-blocked"]
supersedes: []
superseded_by: []
---

# 00040 — Cards add user-only blocked status off-board waiting.

## Context and Problem Statement

A fully described card can await an external answer, deployment or decision. `ready`
would offer Play; `draft` would imply unfinished writing. A column changes the user's
filing, and a tag does not prevent playback.

## Considered Options

* Add a user-controlled, unplayable `blocked` status.
* Leave the card `ready` or return it to `draft`.
* File it in a Blocked column.
* Mark it with a tag.

## Decision Outcome

Chosen option: "Add a user-controlled, unplayable `blocked` status", because it records
waiting without changing filing or allowing the card to play.

At introduction, `blocked` is the eighth status, ordered between `ready` and `running`.
It uses `--task-blocked: #b83280` in both themes and `MinusCircleOutlined`.
`canPlay`, `StartPlay` and `ClaimTask` continue to accept only `ready`.

The user sets and clears `blocked`; runs have no special handling for it and it is not
`Held()`. In contrast, `waiting-refresh` is the run-controlled wait for account quota.
Returning a card to `ready` offers Play again. The reason for blocking belongs in its
description or predecessor chain, without another structured field.

`taskStatus.ts` in `hybridflow-ui`, worker's `workflowStatusBlocked`, and
`entities.StatusBlocked` share the spelling. Worker preserves it in `.workflow.json`
rewrites without setting or clearing it. Schema V007 widens `task_status_check`;
no rows required conversion at introduction. Forgiving readers on older builds fall back
to ready cards rather than refusing the board.
