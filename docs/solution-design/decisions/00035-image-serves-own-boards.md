---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-13
tags: ["image", "hybridflow-store", "deploy", "worker"]
triggers: ["image boards", "remote override", "named volume", "trust auth", "service token", "bind mount modes", "KIAO_WORKER_HYBRIDFLOW_URL", "KIAO_HYBRIDFLOW_STORE_DATABASE_URL", "anonymous"]
supersedes: []
superseded_by: []
---

# 00035 — Kiao image embeds PostgreSQL and store; override refused.

## Context and Problem Statement

The image needs working boards without an external service. Honoring a worker-only remote
override would send run writes to one service while nginx sends the browser to another.

## Considered Options

* Embed PostgreSQL and hybridflow-store and reject a remote worker-backend override.
* Honor `KIAO_WORKER_HYBRIDFLOW_URL` while the browser uses the embedded service.

## Decision Outcome

Chosen option: "Embed PostgreSQL and hybridflow-store and reject a remote worker-backend override",
because the image stays self-contained and browser and runner share one boards service.

`kiao` starts PostgreSQL and hybridflow-store and refuses
`KIAO_WORKER_HYBRIDFLOW_URL` at startup. `KIAO_HYBRIDFLOW_STORE_DATABASE_URL` may point
that same service at another PostgreSQL instance, keeping both clients on one database.
Other launch modes explicitly configure their backend; the base has no personal-server default.

PostgreSQL listens only on 127.0.0.1 with trust authentication. The two Go services share
a token minted each start and never written to disk, as with the launcher.
Unauthenticated browser writes are attributed to `anonymous`.

### Consequences

* Bad, because data disappears with the container unless kept in a named volume.
  Bind-mount modes can prevent PostgreSQL from running, as with the development volume.
