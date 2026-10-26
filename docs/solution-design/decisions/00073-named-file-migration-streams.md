---
id: "00073"
title: "assemblies configure independent named file migration streams and retire history at a checked baseline"
status: accepted
date: 2026-10-20
tags: ["migrations", "worker", "assembly", "baseline"]
components: ["worker", "migrations", "kiao-executable", "kiao-image"]
paths: ["operation/worker/internal/files/migrations.go", "migrations", "bin/stage-file-migrations.js"]
symbols: ["KIAO_WORKER_MIGRATIONS_SOURCES", "source.json", "sources.json", "files-migrations.json"]
triggers: ["migration stream", "migration source", "history purge", "baseline", "ledger reset", "migration delivery"]
supersedes: []
superseded_by: []
---

# 00073 — independent named file migration streams with a checked baseline

**Decision:** an assembly selects one base directory and an ordered list of additional directories
through `KIAO_WORKER_MIGRATIONS_SOURCES`. `KIAO_WORKER_MIGRATIONS_PATH` remains the base-only
shorthand; configuring both is an error. Every source declares a stable ID in `source.json`.
Paths locate resources; only IDs identify history. The common worker contains no assembly-specific
source name or path. This follows 00071's assembly ownership without sharing its skill catalogue.

The format-2 ledger has independent version/checksum/applied histories keyed by source ID. All
pending base scripts precede additional sources, even after a higher extension version has run.
Removing a source preserves its ledger. Adding a source initializes only that source's baseline.
One lock spans discovery, ledger loading/transition, validation, execution and persistence.
Script/runtime/checksum failures stop all later work; the configured fatal policy controls whether
serving may start. Invalid configuration, ledger state or persistence always fails startup.

**History retirement:** stream support lands first and compaction follows within the same delivery.
The base reserves versions 1–18 at the 2026-10-20 baseline; the next base version is 19. The flat
ledger is compacted only when its complete terminal history matches the declared legacy endpoint,
and only after discovery proves that none of the retired scripts remains. A fresh/current store
starts at the baseline. Older or unknown histories require the documented pre-cutover upgrade.
Baselines cannot change underneath a recorded stream and IDs/retired numbers cannot be reused.

Ordinary applied scripts remain immutable. The explicit exception is a coordinated, documented
retirement: inventory, retained knowledge, copied-store rehearsal, complete delivery replacement,
checked ledger compaction and restart verification. It never means resetting a ledger to replay
discoverable scripts. Git history and PostgreSQL's migrations remain intact.

**Delivery:** one common staging function ships source metadata, active scripts and shared/local
helpers with relative assembly paths. It omits examples/tests and replaces the old set. Assemblies
configure the local launcher, executable installer and server deploy through this mechanism;
installation does not opt an executable or image into migrations. Server staging and installed
directories must both discard stale scripts.

**Why:** directory concatenation under one counter lets an extension suppress later base work.
Stable IDs and independent ledgers preserve history when an assembly or install path changes.
A checked baseline retires obsolete executable history without reintroducing the earlier reset
and stale-script replay failure.

The [runner contract](../../../migrations/README.md), [cutover procedure](../../../migrations/cutover-2026-10-20.md)
and [maintained examples](../../../migrations/history.md) specify authoring and supported upgrades.
