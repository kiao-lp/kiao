---
id: "00054"
title: "the boards become HybridFlow: `hybridflow-ui`, `hybridflow-store`, `hybridflow`"
status: accepted
date: 2026-09-15
tags: ["hybridflow", "rename", "deploy"]
components: ["dashboard", "hybridflow-store", "worker"]
paths: ["operation/hybridflow-store"]
symbols: ["PLUGIN_RENAMES", "/api/hybridflow", "KIAO_HYBRIDFLOW_STORE_*", "KIAO_WORKER_HYBRIDFLOW_*", "KIAO_HYBRIDFLOW_ACTOR", "V006", "kiao_hybridflow", "hybridflow-store-token"]
triggers: ["tasks-board", "workflows-service", "taskboard skill", "old env var", "old API prefix", "vault secret", "V001-V012 history"]
supersedes: []
superseded_by: []
---

# 00054 — the boards become HybridFlow: `hybridflow-ui`, `hybridflow-store`, `hybridflow`

**Decision:** rename the three halves of the boards to one product name. The Dashboard plugin
`tasks-board` becomes `hybridflow-ui`, the Go service `operation/workflows-service` becomes
`operation/hybridflow-store`, and the agent skill `taskboard` becomes `hybridflow`. The short name
`hybridflow` replaces `workflows` everywhere the short service name was used: the API prefix
(`/api/workflows` → `/api/hybridflow`), the database role and database (`workflows` →
`hybridflow`), the `LISTEN` channel (`kiao_workflows` → `kiao_hybridflow`), and the environment
(`KIAO_WORKFLOWS_SERVICE_*` → `KIAO_HYBRIDFLOW_STORE_*`,
`KIAO_WORKER_WORKFLOWS_*` → `KIAO_WORKER_HYBRIDFLOW_*`,
`KIAO_WORKFLOWS_ACTOR` → `KIAO_HYBRIDFLOW_ACTOR`).

**What keeps its name:** the domain vocabulary — boards, columns, cards, runs, the `workflow` face
of a board, the `.workflow.json` format and its `KiaoWorkflow` doc type — and the frozen history:
the file-store migrations `V001`–`V012`, the schema migrations `V001`–`V005`, and the earlier
entries of this log still say `workflows-service` where that was the name at the time.

**Compatibility is one entry, not a layer.** A store whose `dashboard.json` names `tasks-board`
gets `hybridflow-ui` through `PLUGIN_RENAMES`, like `movie-view` before it. Nothing else falls
back: the old environment variables are not read, and the old API prefix is not served. The live
state moves instead — `install.sh` renames the VPS role and database when they still carry the
old names, the kiao image's entrypoint does the same for its embedded PostgreSQL, and schema
`V006` moves the notify channel — so the first deploy after the rename carries the boards with
it. The vault secret was copied to `hybridflow-store-token` (same value); `workflows-service-token`
is dead after that deploy and can be deleted.
