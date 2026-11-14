---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-04
tags: ["hybridflow", "runs", "worker", "dashboard"]
triggers: ["second run", "named run", "restart", "forget", "resume", "workflows panel", "card played twice", "agents/workflow_run.go", "play", "stop"]
supersedes: []
superseded_by: []
---

# 00025 — Worker plays several boards; runs named and persistent.

## Context and Problem Statement

One service-owned run still forces a person to wait before starting independent work on
another board, although the hub already supports four concurrent turns. Multiple runs need
distinct identities, safe writes and retained endings for restart.

## Considered Options

* Maintain named concurrent runs and retain ended runs for restart or removal.
* Allow only one run at a time.
* Remove a run as soon as it ends.

## Decision Outcome

Chosen option: "Maintain named concurrent runs and retain ended runs for restart or removal",
because independent work can proceed together and a finished run remains available to restart.

`WorkflowRunner` in `agents/workflow_run.go` holds a list. Play asks for a name, prefilled
with a timestamp such as `Started 4 Sep 13:22`. Each run retains its starting card and
walked chain: played, current and upcoming `onSuccess` cards with titles and statuses.
Notices and Stop controls name the relevant run; a shared board path or card ID cannot
distinguish all runs.

A card is held by one run. A second direct play is refused; a chain reaching a held card
ends with a notice naming the owner. All board read-change-write operations are serialized
across runs, including the read, so concurrent outcomes cannot overwrite one another.

Ended runs retain their reason until restarted or forgotten. Restart uses the original
starting card, name and list position; it is refused if that card no longer has a description.
The list keeps twenty ended runs in memory, while historical answers remain on the board.

The recorded protocol is version 13: `play`, `stop`, `resume`, `restart`, `forget`
and read endpoints; all mutations name a run ID. `workflow` and `hello` carry the list.
A document-independent workflows panel in `tasks-board` displays it. Worker computes
the chain from its normal board read at each step, with no extra read, even for an unopened
`.workflow.json`; upcoming cards are a refreshed forecast rather than a fixed plan.

## More Information

[ADR-00050](00050-chain-run-rename.md) later renamed runs, endpoints and frames to chain runs.
