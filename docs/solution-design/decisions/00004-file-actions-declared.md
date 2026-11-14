---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-10
tags: ["worker", "file-actions", "dcms", "dashboard"]
triggers: ["new action", "operation on a file", "provider URL", "manifest entry", "KIAO_WORKER_ACTIONS_PATH", "GET /actions", "POST /actions/run", "files/actions.go"]
supersedes: []
superseded_by: []
---

# 00004 — File actions are manifest entries naming provider URL.

## Context and Problem Statement

File operations belong to their provider services. Registering them inside worker would
move provider business logic there and require a worker deployment for each new operation.

## Considered Options

* Declare file actions in a manifest naming provider endpoints.
* Register provider operations inside worker.

## Decision Outcome

Chosen option: "Declare file actions in a manifest naming provider endpoints", because an
operation can be added through configuration and an endpoint in its owning service.

`KIAO_WORKER_ACTIONS_PATH` names a manifest whose entries specify an ID, label,
applicability rule and provider URL. Worker serves descriptors through `GET /actions`
and proxies `POST /actions/run`, forwarding the caller's bearer token.
`files/actions.go` contains no provider business logic.

Clients name actions by ID; provider URLs remain deployment configuration and are never
disclosed to clients. Adding an action needs no worker or Dashboard code change.
