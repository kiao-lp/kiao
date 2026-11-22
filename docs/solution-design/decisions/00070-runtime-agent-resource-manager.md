---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-20
tags: ["apm", "git", "agents", "agentic-resource-manager", "kiao-executable"]
triggers: ["agent installation", "agent deletion", "Node agents", "agentic-resource-manager", "KIAO_AGENTIC_RESOURCE_MANAGER_URL", "KIAO_AGENTIC_DEPENDENCIES_PATH", "prepared agent packages", "executable agent storage"]
supersedes: ["00068"]
---

# 00070 — A dedicated service manages agents as runtime Git/APM repositories.

## Context and Problem Statement

Agent development and distribution need a coherent service that can be reused independently
of boards. The owner chooses which repositories to install on the shared service.
Tasks must retain agent references through server-side clone deletion and reinstallation.

## Considered Options

* Manage runtime Git/APM repositories through agentic-resource-manager.
* Retain agent source management and installation seeds in hybridflow-store and the assembly.

## Decision Outcome

Chosen option: "Manage runtime Git/APM repositories through agentic-resource-manager",
because agent source development, Git lifecycle and package delivery form one domain.

The service lives beside hybridflow-store and stores agents in local Git clones. It discovers
manual clones, resolves dependencies with APM and caches publication packages. Git commands,
APM commands, file storage, HTTP serving and cache storage have separate adapters.

The installed executable uses that shared service. Dashboard's agent management changes the
working trees and Git repositories on the server. The command configures the manager URL and
service token beside its boards endpoint and proxies Dashboard's resource API to it.

Dashboard has a resource module with its own HTTP client, state and management components.
Creating an agent accepts a Git URL or initializes a local repository. Editing changes its
working tree. Publishing creates the commit and version tag and pushes both when a remote
exists. Clone deletion requires confirmation with warnings for absent remotes and unpublished
local work. Task references survive deletion, and reinstalling the repository restores the same
agent identity. Agent selection happens in the task editor.

The manager restores the published commit with APM's frozen install into an isolated deployment
and caches its prepared skills, MCP configuration and dependencies. Workers fetch that deployment,
verify its commit and APM lock digest, and cache the files locally for execution. The task machine
supplies its harness CLI and MCP runtimes. hybridflow-store owns boards, tasks and immutable
execution provenance and resolves agent identities through HTTP.

Independent Git repositories, native agent definitions, APM dependency locks and execution
provenance from [00068](00068-apm-agentic-resources.md) remain applicable. Source catalogues are
assembly inputs. The build combines their selected skill and MCP repositories into one seed with a
unique name per repository. The manager uses one dependency directory for the delivered assembly.
Source agent clones are retained for development. Runtime agents are installed explicitly.

## More Information

This decision supersedes [00068](00068-apm-agentic-resources.md).
[00069](00069-shared-hybridflow-containers.md) governs shared boards; resource-manager access is
configured separately. See [agentic resources](../agentic-resources.md) and the
[service contract](../../../operation/agentic-resource-manager/README.md).
