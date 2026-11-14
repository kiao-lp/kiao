---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-20
tags: ["migrations", "worker", "assembly", "baseline", "kiao-executable", "kiao-image"]
triggers: ["migration stream", "migration source", "history purge", "baseline", "ledger reset", "migration delivery", "KIAO_WORKER_MIGRATIONS_SOURCES", "source.json", "sources.json", "files-migrations.json"]
supersedes: []
superseded_by: []
---

# 00056 — Assemblies configure named migration streams; baselines retire history.

## Context and Problem Statement

One migration counter across concatenated base and extension directories lets extension
versions suppress later base work. Retiring history must not reset a ledger while old
scripts remain discoverable.

## Considered Options

* Use stable source IDs, independent ledgers and checked retirement baselines.
* Concatenate directories under one version counter.
* Reset a ledger while old scripts remain discoverable.

## Decision Outcome

Chosen option: "Use stable source IDs, independent ledgers and checked retirement baselines",
because identity and history must survive assembly-path changes without replaying retired scripts.

`KIAO_WORKER_MIGRATIONS_SOURCES` selects one base and ordered additional directories.
`KIAO_WORKER_MIGRATIONS_PATH` remains the base-only shorthand; setting both is an error.
Each `source.json` declares a stable ID, independent of its resource path.
Worker knows no assembly-specific source; assembly ownership follows ADR-00054 without
sharing its skill catalogue.

The format-2 ledger keeps version/checksum/applied histories per ID. Pending base scripts
always precede additions, even after a higher extension version ran. Removing a source keeps
its ledger; adding one initializes only that baseline. One lock covers discovery, ledger
transition, validation, execution and persistence. Script, runtime or checksum failures stop
later work and follow the serving-fatal policy; invalid configuration, ledger or persistence
always fails startup.

Stream support precedes compaction within the same delivery. The 2026-10-20 base baseline
reserves versions 1–18; next is 19. Compaction requires the exact declared terminal legacy
history and discovery proving all retired scripts absent. Fresh/current stores start at the
baseline; older or unknown histories require the documented pre-cutover upgrade.
Recorded baselines, source IDs and retired numbers cannot be reused or changed.

Ordinary applied scripts remain immutable. Coordinated retirement requires inventory,
retained knowledge, a copied-store rehearsal, complete resource replacement, checked ledger
compaction and restart verification. Git and PostgreSQL migration histories remain intact.

One staging function ships metadata, active scripts and shared/local helpers with relative
assembly paths, omitting examples/tests and removing stale scripts from both server staging
and installed directories. Launcher, executable and server delivery use it. Installation
does not itself opt an executable or image into migrations.

## More Information

The [runner contract](../../../migrations/README.md),
[cutover procedure](../../../migrations/cutover-2026-10-20.md) and
[maintained examples](../../../migrations/history.md) define authoring and supported upgrades.
