---
id: "00035"
title: "`internal/agents` is written against an agent, not against the Claude CLI"
status: accepted
date: 2026-09-03
tags: ["agents", "worker", "architecture"]
components: ["worker"]
paths: ["operation/worker/internal/agents"]
symbols: ["AgentDriver", "driver.go", "driver_claude.go", "AgentOptions", "AgentUsage", "AgentLogin", "AgentMCP", "driver_stub_test.go", "claude_ws.go"]
triggers: ["new agent", "second agent", "turn lifecycle", "spawn", "stream", "stub driver", "no claude on PATH"]
supersedes: []
superseded_by: []
---

# 00035 — `internal/agents` is written against an agent, not against the Claude CLI

**Decision:** a turn goes through an `AgentDriver` port (`agents/driver.go`) with five verbs —
`Spawn(run)`, `Events()`, `Answer(askId, decision)`, `Say(text)` (what a `between` is), `Stop()` —
and the `claude` CLI is one implementation of it (`agents/driver_claude.go`): its argument list, its
stream-json reader, its control requests and the briefing it is spawned with. Four **optional** side
ports — `AgentOptions`, `AgentUsage`, `AgentLogin`, `AgentMCP` — carry the quota, the prompt's
choices, the sign-in flow and the MCP configuration; an agent answering none of them leaves those
routes unmounted rather than serving an endpoint that cannot work. Everything else stays in the hub
and is agent-neutral: the conversation store and its transcript, the fan-out, the turn lifecycle
(parallelism cap, job TTL, `sweepInterrupted`), the attachments, the folder resolution, and the
whole `WorkflowRunner` — playing a board is an algorithm over cards, not something an agent does.

**Why:** `claude_ws.go` was 2450 lines mixing three concerns — the socket and its fan-out, the turn
registry, and the translation of one CLI's protocol — and only the third was Claude's. Nothing could
say where the agent stopped and the service began, so every question about the turn lifecycle had to
be answered through a CLI's stream-json. The port is where that line is now drawn, and the file lost
440 lines to the other side of it.

**What it buys immediately, before any second agent:** a stub driver
(`agents/driver_stub_test.go`) means most of the package's tests spawn, stream, answer and stop a
whole turn with **no `claude` on PATH** — where before they either drove `sleep 60` and called it an
agent or pointed the hub at a binary that cannot exist, which only ever reaches the failure branch.
One path stays end-to-end over the real protocol on purpose: the board tests still drive a shell
script standing in for the CLI.

**What did not change:** the wire, the endpoints and the UI. `claudeProtocolVersion` is untouched,
every frame has the shape it had, and the two sentences a failed spawn is refused with are relayed
from the driver verbatim rather than reworded — the port says a `Spawn` error *is* the message the
user is shown. The one visible difference is in the log: the `spawned` line is the driver's now, so
it carries the conversation, turn, pid and working directory but no longer the user, who is on the
`prompt received` line of the same turn.
