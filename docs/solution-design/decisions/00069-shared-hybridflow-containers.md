---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-17
tags: ["docker", "hybridflow", "runner"]
triggers: ["shared agent catalogue", "remote Docker boards", "KIAO_WORKER_HYBRIDFLOW_URL"]
supersedes: ["00035"]
---

# 00069 — Containers and installed runners can share an online hybridflow service.

## Context and Problem Statement

Several Windows Docker instances and installed `kiao` commands need the online boards and
agent catalogue while executing on their own files. Browser and runner must use the same
hybridflow service.

## Considered Options

* Proxy browser requests through the worker to the configured hybridflow service.
* Require every image instance to use its embedded hybridflow service.

## Decision Outcome

Chosen option: "Proxy browser requests through the worker to the configured hybridflow service",
because the worker already authenticates and attributes remote hybridflow requests.

`KIAO_WORKER_HYBRIDFLOW_URL` and `KIAO_WORKER_HYBRIDFLOW_TOKEN` select the remote
service. A container then starts its worker and renderers; its Dashboard uses the same
worker proxy. Each runner restores the selected agent commit locally and reports its
executions centrally. A remote service URL and a local database URL are mutually exclusive.

With no remote service configured, the image starts PostgreSQL and hybridflow-store and
uses the same proxy. Each running instance uses its own store and persistent state volume.

## More Information

This decision supersedes [00035](00035-image-serves-own-boards.md).
See [agentic resources](../agentic-resources.md) for package and provenance delivery.
