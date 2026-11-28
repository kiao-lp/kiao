---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-28
tags: ["dcms", "terminology", "configuration"]
triggers: ["DCMS root", "KIAO_WORKER_DCMS_ROOT", "KIAO_WORKER_ROOT_PATH", "/storeInfo"]
---

# 00074 — DCMS root names the directory exposed by the worker.

## Context and Problem Statement

Documentation and code use *store root*, *data root* and *root path* for the same directory.
The worker also uses paths for operational state, Git worktrees and harness working
directories. Those paths have their own purposes and may point to different locations.

## Considered Options

* Keep the names already used by each component.
* Use *DCMS root* across components and preserve compatibility at existing boundaries.

## Decision Outcome

Use *DCMS root* across components and preserve compatibility at existing boundaries. A single
term connects the deployment setting, the base for document links, and the host path clients
receive from the worker. Git, worker state and conversation working directories keep their
own names even when they share a directory.

New deployments use `KIAO_WORKER_DCMS_ROOT`. A non-empty value takes precedence over
`KIAO_WORKER_ROOT_PATH`, which existing deployments can continue to use. The `/storeInfo`
response still carries `rootPath`. Persisted keys and migration interfaces keep their
existing spellings so current clients, ledgers and applied scripts continue to work.

[DCMS concept catalog](../../architecture/data/dcms-concept-catalog.md) ·
[Worker configuration](../../../operation/worker/docs/solution-design/configuration.md)
