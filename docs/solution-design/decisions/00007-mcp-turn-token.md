---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-23
tags: ["agents", "mcp", "auth", "worker", "kiao-mcp"]
triggers: ["turn MCP", "tool auth", "401 from a turn", "strict config", "bundle size", "./utils subpath", "KIAO_MCP_TURN_TOKEN", "--mcp-config", "--strict-mcp-config", "KIAO_WORKER_MCP_PATH", "StaticTokenProvider", "finishTurn"]
supersedes: []
superseded_by: []
---

# 00007 — Each turn gets per-turn MCP token, revoked after.

## Context and Problem Statement

An unattended turn can outlast the caller's access token, which the CLI cannot refresh.
A long-lived service credential would remain usable after the work and lose its attribution.

## Considered Options

* Issue a worker token for each turn and revoke it when the turn ends.
* Pass the caller's short-lived access token.
* Use a long-lived service credential.

## Decision Outcome

Chosen option: "Issue a worker token for each turn and revoke it when the turn ends", because
its lifetime matches the authorized operation and it preserves the requesting identity.

Worker mints a random token for each spawned turn. Authentication accepts it before JWT
validation and revokes it at turn completion. `KIAO_MCP_TURN_TOKEN` carries it to the turn;
generated MCP configuration uses environment expansion where supported, with driver-specific
transport otherwise.

The toolbox ledger owns the registered MCP set. Deployment settings seed a new ledger;
later registration changes affect the next turn. Claude receives an explicitly supplied
set through `--mcp-config` and `--strict-mcp-config`, excluding servers from its own
configuration; the panel explains this. With no configured set, ordinary driver
configuration remains available.

## More Information

`kiao-mcp` imports non-React helpers through `kiao-worker/utils` so server bundles do not
pull React through the barrel. Staging starts every entry point before succeeding, exposing
accidental runtime dependencies. Deployment controls bundle availability; registration and
installation follow the [toolbox](00016-toolbox-library.md).
