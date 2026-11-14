---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-13
tags: ["security", "authentication", "worker", "hybridflow-store", "applications"]
triggers: ["owner account", "files_user", "files_reader", "listening client", "default roles", "public registration", "KIAO_WORKER_READER_ROOTS", "turn token", "service bearer"]
supersedes: ["00015"]
superseded_by: []
---

# 00068 — Every application uses the owner's full access.

## Context and Problem Statement

One person owns and uses the installation. The client exception in
[00015](00015-one-person-owns-system.md) treated listening applications as a different class
of user, although the owner uses them too. A client-specific role and a list of readable roots
therefore contradict the ownership premise. Removing that exception must preserve server
authentication and reject other human accounts.

## Considered Options

* Give the owner's account the same full access from every application.
* Retain a separate read-only role and root scope for listening applications.

## Decision Outcome

Chosen option: "Give the owner's account the same full access from every application",
because the application used does not change who owns the installation or their rights.

All applications use the owner's Keycloak account with `files_user`, the sole human
authorization role for full API access. Assign it explicitly to that account, never through
default roles or public registration. Public registration is closed. An application's use
of read operations does not narrow the account's rights or create a second user class.

In production, worker and hybridflow-store retain JWT signature, issuer and expiry
validation. Missing or invalid credentials get `401`; a valid human JWT without
`files_user` gets `403`, including one carrying only the retired `files_reader` role.
No former reader account is promoted automatically. The worker no longer uses a reader
role, route allowlist or `KIAO_WORKER_READER_ROOTS`.

Active per-turn callback tokens and configured service credentials retain their technical
authentication. Path bounds, state-directory protection, file-operation checks and agent
permissions remain applicable. The unauthenticated health probe remains available.
The existing `debug` mode still permits requests without validation; this decision keeps
production authentication enabled.

### Consequences

* Good, because every application gives the owner the same account rights.
* Good, because other human accounts remain excluded by the server.
* Bad, because existing deployments must explicitly provision the owner's role and retire
  reader configuration; a versioned realm seed does not update a realm already in service.

### Confirmation

Worker tests cover valid owner tokens, valid tokens without `files_user`, invalid and
expired tokens, active and revoked turn tokens, and direct and symlinked file reads.
Before delivery, check these cases and verify that realm defaults do not grant `files_user`.
After delivery, renew the owner's application sessions and check access and technical calls.

## More Information

This partially supersedes [00015](00015-one-person-owns-system.md): only its read-only
client exception is replaced. Its remaining ownership and outward-credential rules stand.
The [worker protocol](/operation/worker/PROTOCOL.md),
[worker configuration](/operation/worker/docs/solution-design/configuration.md) and
[hybridflow-store configuration](/operation/hybridflow-store/docs/solution-design/deployment.md)
describe the current implementation. [00007](00007-mcp-turn-token.md) still governs
per-turn MCP credentials.
