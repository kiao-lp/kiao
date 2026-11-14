---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-11
tags: ["harness", "agent", "terminology", "migration", "worker", "hybridflow-store", "dashboard", "kiao-worker", "kiao-mcp"]
triggers: ["agent ambiguity", "platform", "execution harness", "workflow agent", "Harness", "HarnessRegistry", "Agent", "AgentVersion", "HARNESS_PROTOCOL_VERSION"]
supersedes: ["00023"]
superseded_by: []
---

# 00066 — Harness names execution tooling; agent names a managed workflow definition.

## Context and Problem Statement

Agent names both execution tooling and managed workflow definitions, although their
configuration, lifecycle and publication responsibilities differ.

## Considered Options

* Use harness for execution tooling and agent for a managed workflow definition.
* Use agent for both meanings, as in ADR-00023.

## Decision Outcome

Chosen option: "Use harness for execution tooling and agent for a managed workflow definition",
because distinct vocabulary separates the two concepts across code, wire and interfaces.

A harness—Claude, Codex, Muse, OpenCode or Pi—owns its driver, options, capabilities,
profiles, installation, quota and sign-in. Use `Harness…`, `harness`, `harnesses`
and `defaultHarness`.

An agent is hybridflow-store's named definition selecting a harness, model and profile
with description and instructions. Its ID, `AgentVersion`, `settings.agent`,
`agentRef`, `agentVersion`, `/agents` catalogue and `agent_*` MCP tools keep their names.

V035 renames the agent's `platform` column/constraint and published configuration field,
preserving version numbers, instructions, revisions and publication immutability.
Before opening the runner, worker adopts owned conversation metadata, traces, chain logs,
profile document and secret directory. It changes named fields and paths while preserving
transcript text and native sessions. Repetition is idempotent; conflicting profile or
credential destinations stop startup for reconciliation.

Socket protocol 21 and worker aliases use `/harnesses`, `/ws/harness` and
`KIAO_WORKER_HARNESS_*`. Vendor names and native fields `agent_settled`,
`agentMessage` and `agentId`, plus `AGENTS.md` and `.agents/`, retain external spelling.
Operating-system platform keeps its existing meaning.

## More Information

This decision supersedes [ADR-00023](00023-wire-says-agent.md).
