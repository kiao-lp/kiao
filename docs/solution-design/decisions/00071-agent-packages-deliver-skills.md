---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-20
tags: ["skills", "apm", "agents", "worker"]
triggers: ["skill delivery", "agent skill dependencies", "skill versions", "plugin skill mapping", "legacy skills in the store or home"]
supersedes: ["00037", "00053"]
---

# 00071 — Agent publications supply skills to their turns.

## Context and Problem Statement

A skill supplied by the worker can overlap with a skill selected in an agent's published APM
package. A plugin toggle can also change which instructions a turn sees while its agent publication
stays the same.

## Considered Options

* Deliver skills through the agent's published APM package.
* Keep an assembly skill catalogue alongside published agent packages.

## Decision Outcome

Chosen option: "Deliver skills through the agent's published APM package",
because the agent publication defines the instructions and dependencies of each turn.

Each skill has an independent Git/APM repository. Agent authors select their dependencies in the
agent repository. The resource manager prepares the deployment from the published commit and
lockfile. The worker gives the harness the catalogue and paths to the skill files in that deployment.
Dashboard plugins control the views and editors available in the store.

At startup the worker retires legacy copies from the store and shared harness configuration.
It identifies them by the installer ownership marker or an exact match with a former
Git-tracked skill. Skills owned by the store operator retain their own lifecycle.

## More Information

See [agent resource delivery](../agentic-resources.md) and
[runtime agent management](00070-runtime-agent-resource-manager.md).
