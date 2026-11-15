---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-10
tags: ["file-actions", "contracts", "worker", "dashboard", "kiao-worker"]
triggers: ["context menu", "right-click", "appliesTo", "extensions", "directory rule", "async menu", "actionApplies", "PROTOCOL.md", "files/actions.go"]
supersedes: []
superseded_by: []
---

# 00005 — appliesTo uses extensions and directory only, both sides.

## Context and Problem Statement

The context menu must decide applicability synchronously from a file entry. Worker must
enforce the same rule when the action runs.

## Considered Options

* Evaluate extensions and directory rules in both client and worker.
* Ask the server for applicability when opening the context menu.
* Expand applicability into a richer rule language.

## Decision Outcome

Chosen option: "Evaluate extensions and directory rules in both client and worker", because
`{ path, isDirectory }` already supplies the data needed without a right-click round trip.

An action's `appliesTo` vocabulary contains only `extensions` and `directory`.
`actionApplies` in `files/actions.go` and `appliesTo.ts` in core implement the same
test table; `PROTOCOL.md` is normative. Requirements outside this vocabulary belong in
the owning service.

### Consequences

* Bad, because applicability logic is duplicated. Keeping the vocabulary limited bounds that cost.
