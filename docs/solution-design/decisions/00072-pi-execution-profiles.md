---
id: "00072"
title: "Pi runs through worker-owned execution profiles shared by agents and conversations"
status: accepted
date: 2026-10-18
tags: ["agents", "pi", "profiles", "sessions"]
components: ["worker", "hybridflow-store", "dashboard", "kiao-worker", "kiao-mcp", "kiao-image", "kiao-executable"]
paths: ["operation/worker/internal/hybridflow-runner", "operation/worker/internal/toolbox"]
symbols: ["AgentDriver", "AgentRun", "profileId", "AgentDeferred"]
triggers: ["Pi", "execution profile", "provider connection", "profile fork", "deferred message"]
supersedes: []
superseded_by: []
---

# 00072 — Pi execution profiles

**Decision:** keep one `pi` platform and resolve its execution profile on the worker that runs the
turn. A profile selects an exact qualified installation, API connections, secret references,
allowed models and resources. Several managed agents and free conversations can share it.
The boards store keeps only its stable reference. Model choices and capabilities belong to the
profile/model pair. Each turn keeps its effective profile revision and execution parameters.

Pi uses the common driver port, one RPC process per turn, the existing process supervisor and
private native sessions beside the common transcript. A same-profile fork branches the native
session before changing its settings. A profile change creates a distinct session with transcript
context; successor nodes keep their own conversations. Deferred messages use an optional common
port and a durable queue roster. Settlement follows Pi's settled event and descendant cleanup.

**Why:** installations, accounts and connection settings change independently of an agent's purpose
or instructions. Resolving them on the executing runner avoids moving local paths or credentials
through the boards. Native sessions preserve model context without making the common transcript
vendor-specific. Per-turn composition prevents host configuration or another profile selecting
a different account.

**Cost:** each supported Pi version needs protocol and distribution qualification, and pinned
resources need an RPC-compatible browser mapping. OAuth and terminal-only extensions remain
unavailable until their lifecycle can meet the same contracts. The target
[Pi proposal](/docs/solution-design/pi-agent-plan.md) remains a proposal; the
[protocol reference](/operation/worker/PROTOCOL/pi.md) describes the delivered surface.
