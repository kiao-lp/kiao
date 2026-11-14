---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "superseded by ADR-00066"
date: 2026-09-03
tags: ["agents", "wire", "rename", "worker", "dashboard", "kiao-worker"]
triggers: ["claude path", "agent name", "capability registry", "workflowSettings.agent", "old env var", "alias drift", "agent-types.ts", "AGENT_PROTOCOL_VERSION", "/agents/*", "/ws/agent", "KIAO_WORKER_AGENT_*", "useAgentOptions", "V006__workflow-task-agent.js", "playable()"]
supersedes: []
superseded_by: ["00066"]
---

# 00023 — Wire, routes, UI say agent; old paths aliased.

## Context and Problem Statement

A deployment can offer several execution platforms. Claude-specific names cannot define
their common conversation contract, and HTTP clients lack a protocol-version reload signal.

## Considered Options

* Use agent-neutral names with aliases for legacy Claude endpoints and configuration.
* Keep Claude-specific names for the shared contract.

## Decision Outcome

Chosen option: "Use agent-neutral names with aliases for legacy Claude endpoints and configuration",
because the shared contract needed to cover several platforms while preserving existing clients.

The earlier vocabulary used `agent-types.ts`, `Agent…`, `AGENT_PROTOCOL_VERSION`,
`/agents/*` and `/ws/agent`; `chat` hosted conversations. Deployments supplied common
`KIAO_WORKER_AGENT_*` and platform-specific `KIAO_WORKER_AGENT_<NAME>_*` settings.
Legacy Claude names shared handlers and readers, with one route list preventing alias drift.
Socket shape changes used the announced protocol version.

The capability registry retains publishers in assembly order. Each capability specifies
whether consumers take the first provider for a singular operation or collect all providers
for a list, such as agent options. Options stay scoped to their defining platform.

## More Information

Superseded by [ADR-00066](00066-harness-and-workflow-agent.md), which distinguishes execution
harnesses from workflow agents. Managed task-agent selection follows
[publications](00058-agent-publications.md).
