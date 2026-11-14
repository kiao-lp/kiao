---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-18
tags: ["agents", "pi", "profiles", "sessions", "worker", "hybridflow-store", "dashboard", "kiao-worker", "kiao-mcp", "kiao-image", "kiao-executable"]
triggers: ["Pi", "execution profile", "provider connection", "profile fork", "deferred message", "HarnessDriver", "HarnessRun", "profileId", "HarnessDeferred"]
supersedes: []
superseded_by: []
---

# 00055 — Pi resolves worker-owned profiles; sessions stay conversation-owned.

## Context and Problem Statement

Installations, accounts and connections change independently of agent instructions.
Boards should not transport local paths or credentials, and host configuration must not
silently select another profile's account.

## Considered Options

* Resolve worker-owned execution profiles per turn and keep sessions with conversations.
* Move local installation paths or credentials through the boards.

## Decision Outcome

Chosen option: "Resolve worker-owned execution profiles per turn and keep sessions with conversations",
because runner-local composition and native sessions preserve configuration ownership and model context.

One `pi` harness resolves a profile on the executing worker. It selects an exact qualified
installation, API connections, secret references, allowed models and resources. Managed agents
and free conversations may share it; boards store only its stable reference.
Choices and capabilities belong to the profile/model pair, and each turn records its
effective profile revision and execution parameters.

Pi uses the common driver port, one RPC process per turn, the existing supervisor and
private native sessions beside the vendor-neutral transcript. A same-profile fork branches
the native session before changing settings. Changing profile starts a distinct session
with transcript context; successors keep their own conversations. Deferred messages use
an optional common port and durable queue roster. Settlement requires Pi's settled event
and descendant cleanup.

### Consequences

* Bad, because each Pi version needs protocol and distribution qualification, and pinned
  resources need an RPC-compatible browser mapping.
* Bad, because OAuth and terminal-only extensions remain unavailable until their lifecycle
  meets these contracts.

## More Information

The [Pi proposal](/docs/solution-design/partitions/conversations/pi-harness-plan.md) remains
a proposal; the [protocol reference](/operation/worker/PROTOCOL/pi.md) defines delivered behavior.
