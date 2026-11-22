---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "superseded by 00070"
date: 2026-11-17
tags: ["apm", "git", "agentic-resources", "hybridflow", "provenance"]
triggers: ["agentic resource", "agent package", "agent.json", "apm.yml", "task_execution", "agentic-resources.json"]
supersedes: ["00057"]
superseded_by: ["00070"]
---

# 00068 — Agentic resources are independent Git projects managed with APM.

## Context and Problem Statement

Agents, skills and MCP tools are agentic resources. They need portable distribution and
immutable execution provenance across online and local runners. The owner requires one
APM project and one GitHub distribution repository per agent, with separate resource
repositories outside the application's version history.

## Considered Options

* Manage agentic resources as independent Git/APM projects, with executions in hybridflow-store.
* Keep the agent catalogue and publication configurations in PostgreSQL.

## Decision Outcome

Chosen option: "Manage agentic resources as independent Git/APM projects, with executions in hybridflow-store",
because Git provides publication identity and APM locks and restores package dependencies.

Each assembly keeps ignored `agentic-resources/` repositories named `agent-*`, `skill-*`
or `mcp-*`. A tracked catalogue records their commits and optional remotes. Each agent
has its own repository and APM manifest. Git tags name publications; commit IDs identify
the configuration retained by a conversation and its task executions.

`hybridflow-store` exposes the catalogue through its existing agent API and an agentic
resource API. Dashboard edits working trees and invokes APM installation and Git publication,
pull and push. Native `.apm/agents/*.agent.md` files contain model, effort, description
and instructions; `agent.json` contains stable identity, display name, harness and profile.
Model and default effort are explicit for
published native agents; Pi resolves its profile on the executing machine.

A publication records local dependency Git commits in `kiao.lock.json` and includes their
committed files under `.apm/resources/`. APM consumes these contained path dependencies.
This makes an agent repository distributable while shared resources still await remotes.
Published snapshots are agent-owned files; edits to a shared resource are adopted by
changing the agent's dependency and publishing again. Remote dependencies use APM's Git
references and lockfile.

Before a managed task starts, its runner restores the package with `apm install --frozen`
and writes a central `task_execution`: agent commit, resolved harness, model, effort,
runner, conversation, turn, time and configuration. Pi's non-secret resolved profile is
included. The task's explicit effort overrides the agent's default. Git retains historical
package configurations independently of the live agent catalogue.

APM's skill projection is embedded or staged with the delivery, with the existing plugin
selection. Runtime repository seeds initialize missing repositories and preserve existing
working trees and publications. Windows containers use Unix named volumes for their state.

The coordinated baseline retains the live VPS agent IDs. It retires SQL agent definitions,
SQL publications and archived tasks. Historical SQL migration fixtures remain test-only.

## More Information

See [resource delivery and execution](../agentic-resources.md) and
[APM's usage skill](https://github.com/microsoft/apm/tree/main/packages/apm-guide/.apm/skills/apm-usage).
This decision supersedes [00057](00057-agent-publications.md).

Superseded by [00070](00070-runtime-agent-resource-manager.md) for runtime ownership and installation.
