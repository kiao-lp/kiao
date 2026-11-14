---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-15
tags: ["hybridflow", "rename", "deploy", "dashboard", "hybridflow-store", "worker"]
triggers: ["tasks-board", "workflows-service", "taskboard skill", "old env var", "old API prefix", "vault secret", "V001-V012 history", "PLUGIN_RENAMES", "/api/hybridflow", "KIAO_HYBRIDFLOW_STORE_*", "KIAO_WORKER_HYBRIDFLOW_*", "KIAO_HYBRIDFLOW_ACTOR", "V006", "kiao_hybridflow", "hybridflow-store-token"]
supersedes: []
superseded_by: []
---

# 00039 — Boards become HybridFlow: hybridflow-ui, hybridflow-store, hybridflow.

## Context and Problem Statement

The boards UI, backend and skill need one product name while domain terms and frozen
migration history retain their meaning.

## Considered Options

* Name the UI, store and skill consistently under hybridflow.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Name the UI, store and skill consistently under hybridflow", because
the three halves and their deployment vocabulary belong to the same product.

| Before | After |
| --- | --- |
| `tasks-board` | `hybridflow-ui` |
| `operation/workflows-service` | `operation/hybridflow-store` |
| Skill `taskboard` | `hybridflow` |
| API `/api/workflows` | `/api/hybridflow` |
| Database and role `workflows` | `hybridflow` |
| `LISTEN` channel `kiao_workflows` | `kiao_hybridflow` |
| `KIAO_WORKFLOWS_SERVICE_*` | `KIAO_HYBRIDFLOW_STORE_*` |
| `KIAO_WORKER_WORKFLOWS_*` | `KIAO_WORKER_HYBRIDFLOW_*` |
| `KIAO_WORKFLOWS_ACTOR` | `KIAO_HYBRIDFLOW_ACTOR` |

`PLUGIN_RENAMES` maps a saved `tasks-board` selection in `dashboard.json` to
`hybridflow-ui`, as for `movie-view`. Old environment names and the old API prefix
have no fallback. The image entrypoint renames its PostgreSQL role and database when
needed; schema V006 changes the notify channel. External assemblies own corresponding
database, configuration and secret changes.

## More Information

Boards, columns, cards, runs, the `workflow` face, `.workflow.json` and `KiaoWorkflow`
keep their domain names. Frozen file migrations V001–V012, schema migrations V001–V005
and earlier log entries retain `workflows-service` where historically applicable.
