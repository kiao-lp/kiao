---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-27
tags: ["hybridflow", "runs", "worker", "dashboard"]
triggers: ["run ends on tab close", "countdown parked", "stop run", "notice wording", "suspend on interrupt", "agents/workflow_run.go", "POST /agents/workflow/play", "manualLive", "decideAt", "turnFault.ts", "ClaudeShow-ctx"]
supersedes: []
superseded_by: []
---

# 00013 — Worker owns play loop and Manual Live countdown.

## Context and Problem Statement

A chain can run for hours after its author closes the browser or laptop. Playback and
permission deadlines must continue and agree across connected panels.

## Considered Options

* Let worker own playback and Manual Live deadlines.
* Let a browser tab drive the loop and countdown.

## Decision Outcome

Chosen option: "Let worker own playback and Manual Live deadlines", because execution
must outlive the browser that started it.

Worker reads the board, sends task prompts, files outcomes, updates statuses, waits through
recoverable failures and follows successors. Dashboard starts, observes, stops and resumes
the plural, service-scoped [named runs](00025-named-runs.md).

Worker also owns `manualLive` deadlines. Requests carry `decideAt` so panels show the
same countdown and can deny before expiry. Explicit manual requests and questions follow
the [approval policy](00062-unattended-permissions.md).

Each run publishes why it ended, what will retry and when, and folder-match notices.
Interrupting its active conversation suspends the run; the user chooses whether to continue.

### Consequences

* Bad, because runner and UI can write the same board. The
  [board merge contract](../../../exchange/dashboard/docs/solution-design/decisions/00017-board-merge-on-run.md)
  reconciles concurrent changes.

## More Information

Runtime and transport names follow the [chain-run terminology](00050-chain-run-rename.md).
