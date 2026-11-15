---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-31
tags: ["toolbox", "worker", "mcp", "installs", "dashboard"]
triggers: ["install JDK", "install node", "install python", "new MCP server", "tool byte cost", "ledger", "handshake probe", "202 install job", "internal/toolbox", "catalog.json", "toolbox.json", "MCPRegistry", "core.MCPServer", "KIAO_WORKER_TOOLBOX_PATH", "KIAO_WORKER_MCP_SERVERS", "POST /toolbox/install"]
supersedes: []
superseded_by: []
---

# 00016 — Machine outfitting is toolbox library with shipped catalogue.

## Context and Problem Statement

Installing JDK, Node LTS, Python and MCP servers is a machine concern shared by document
and harness features. It needs its own ownership, declared recipes and progress reporting;
installation does not belong to a conversation.

## Considered Options

* Provide a toolbox library with an embedded installation catalogue.
* Put installation behavior inside the harness library.
* Accept installation commands from client requests.
* Install distribution packages through elevated permissions.

## Decision Outcome

Chosen option: "Provide a toolbox library with an embedded installation catalogue", because
machine outfitting has its own lifecycle and clients can select deployment-owned recipes.

`internal/toolbox` sits beside document storage and harness execution, depending on shared
core rather than another library. `harnesses` declares `MCPRegistry`; `main.go` supplies
the toolbox, as it supplies `DocumentStore` from the file service. `core.MCPServer`, like
`core.Route`, is shared because neither library owns the contract.

`internal/toolbox/catalog.json` is embedded and declares platform-specific recipes.
Requests carry only a catalogue ID, without commands, package names or versions, following
the `actions.json` model. The Dashboard configuration panel offers runtime and MCP-server
rows, installation controls and a dependency prompt.

For non-root local and server users, installations use checksum-verified Temurin archives,
official Node LTS archives and `uv python install` under `KIAO_WORKER_TOOLBOX_PATH`.
Its empty default keeps the panel read-only. The `kiao` image already runs as root and uses
its own recipe; installations outside `kiao-dev` disappear when the container is replaced.

`<state>/toolbox.json` records what this service installed. Uninstall removes only ledger-owned
software; pre-existing tools such as `uv` appear as installed without a removal control.
Installation and MCP registration are independent. `KIAO_WORKER_MCP_SERVERS` seeds a new
ledger, preserving configured servers on upgrade; afterward the ledger is authoritative,
and registration changes reach the next turn without restart.

A post-install handshake verifies server startup and measures tool count and per-request
bytes: every declared tool is sent on every model request. Generated MCP configuration is
named by its content digest and written on the turn's spawn path, covering installation
paths, ports, binaries and the registered set. An identical configuration costs only a stat.

### Consequences

* Bad, because explicit `--mcp-config` also uses `--strict-mcp-config`: a turn receives
  exactly the panel's registered servers and excludes the CLI's own registrations.
  The panel states this above the list.
* Bad, because Python servers can have large dependency trees, missing musl wheels or no
  available compiler. Each row reports the installer's result and log without promising
  universal availability.

## More Information

Installations are asynchronous, one job at a time: `POST /toolbox/install` returns
`202`, the job appends a log and the panel polls. This follows Git-monitor and sign-in
jobs; the existing Claude socket is a turn channel rather than a package-manager transport.
