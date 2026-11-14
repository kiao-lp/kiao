---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-11
tags: ["hybridflow", "rename", "runs", "board", "worker", "dashboard"]
triggers: ["workflow word", "chain run", "board content", "run logs", "workflow-runs dir", "old path alias", "WorkflowRunner", "workflow vs run", "workflows panel", "protocol 15", "workflow face", "boardSpots", "WorkflowView", "/hybridflow-runner/chain-runs/*", "ChainRunner", "chainRun", "chainRuns", "BoardContent", "BoardDetailDto", "BoardCanvas", "protocol 19", "chain-runs/", "hybridflow-ui-chain-runs"]
supersedes: []
superseded_by: []
---

# 00050 — Boards are boards; executions are chain runs.

## Context and Problem Statement

Workflow named both a board and an execution, while a board can hold several coherent
sets of linked nodes. That ambiguity left no distinct name for the third concept.

## Considered Options

* Name the document a board and its execution a chain run.
* Keep workflow for both board and execution vocabulary.

## Decision Outcome

Chosen option: "Name the document a board and its execution a chain run", because one run
executes one chain and workflow remains available for a linked set of nodes.

`Workflow` becomes `BoardContent`, whole-board `WorkflowDto` becomes `BoardDetailDto`,
and `WorkflowView` becomes `BoardCanvas`. `readWorkflow`, `writeWorkflow` and
`mergeWorkflow` adopt their BoardContent names; runner `workflowBoard` becomes
`boardContent`, retaining flowNode-prefixed settings, success, spot, criterion and statuses.

`WorkflowRunner` / `workflowRun` become `ChainRunner` / `chainRun`.
The six endpoints move from `/hybridflow-runner/workflow-runs/*` to
`/hybridflow-runner/chain-runs/*`; the frame is `chainRun` and `hello` lists
`chainRuns`. Protocol version 19 makes mismatched `hello.protocolVersion` tabs reload.
Old HTTP paths keep the same handlers because scripts receive no reload signal.

At first open, `<state>/workflow-runs/` moves to `<state>/chain-runs/` if the destination
does not exist. The tab ID becomes `hybridflow-ui-chain-runs`; a bar retaining the old
tab falls back to its first registered tab.

## More Information

Workflow remains in product language, workflows drawn on boards, and vendor-owned Muse/Codex
background items, rosters, drains and tests. Schema/file migrations, seed fixtures and past
records retain their spelling. Earlier board/run uses, especially the 2026-09-15 entry,
are read through this terminology.
