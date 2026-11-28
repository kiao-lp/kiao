---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-28
tags: ["hybridflow", "terminology", "agentic-resources", "agent", "harness"]
triggers: ["agent definition", "agentic resource composition", "execution tooling", "harness terminology"]
---

# 00073 — Agents assemble resources and harnesses execute turns.

## Context and Problem Statement

[ADR 00065](00065-harness-and-workflow-agent.md) distinguished execution tooling from
managed workflow definitions. Agent definitions now live in independent Git/APM projects,
declare dependencies and serve both tasks and free conversations. Some interface text
and protocol documentation still use *agent* or *engine* to refer to a harness.

## Considered Options

* Keep the workflow-specific definition of *agent* from ADR 00065.
* Define *agent* as a composable resource for related tasks and use *harness* for the tooling
  that executes turns.

## Decision Outcome

Define an agent as a composable resource for related tasks and use *harness* for the tooling
that executes turns. This gives an agent the same meaning in authoring, publication and
use, including in free conversations. It associates model and permission options with
the tool that exposes them, even when several agents use that harness or one agent supports
several harnesses.

The [Hybridflow concept catalog](../../architecture/data/hybridflow-concept-catalog.md)
defines current usage. Existing protocol keys, stored data, applied migrations and
third-party names retain their compatibility spellings.
