---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-05
tags: ["dcms", "hybridflow", "concepts", "dashboard", "worker", "hybridflow-store"]
triggers: ["DCMS meaning", "hybridflow meaning", "container vs feature", "commit scope", "runner homeless", "boards UI ownership", "hybridflow-runner", "files", "toolbox"]
supersedes: []
superseded_by: []
---

# 00048 — DCMS and hybridflow are functional sets, not containers.

## Context and Problem Statement

Dashboard and worker each contain document-management and workflow features.
Equating DCMS with both complete containers misassigns the boards UI and leaves the
runner without a feature home.

## Considered Options

* Define DCMS and hybridflow as functional sets spanning containers.
* Define DCMS as the entirety of Dashboard and worker.

## Decision Outcome

Chosen option: "Define DCMS and hybridflow as functional sets spanning containers", because
feature ownership and process boundaries describe different structures.

DCMS is Dashboard's file-oriented views plus worker's `files` service.
Hybridflow is Dashboard's boards and conversations UI, worker's `hybridflow-runner`
and hybridflow-store. Dashboard and worker participate in both sets; worker's `toolbox`
is shared. Only hybridflow-store lies wholly within one set.

The deliverable is `kiao`; process names remain `dashboard`, `worker` and
`hybridflow-store`. Commit scopes follow feature reach: `dcms` spans its halves,
`hybridflow` spans its parts, and `kiao` spans both.

## More Information

The [DCMS concept catalog](/docs/architecture/data/dcms-concept-catalog.md) makes documents
the central managed information artifacts, independently of format or publication.
Operational descriptions use document management; product presentations can name document
collections, source repositories or knowledge bases.
