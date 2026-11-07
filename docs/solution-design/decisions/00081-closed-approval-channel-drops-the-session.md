---
id: "00081"
title: "A turn that dies on its approval channel drops the conversation's session"
status: DRAFT
role: PRIMARY_SOURCE
decision_status: accepted
date: 2026-10-26
tags: ["permissions", "conversations", "sessions"]
components: ["worker"]
paths: ["operation/worker/internal/hybridflow-runner/agents/claude", "operation/worker/internal/hybridflow-runner/turns"]
symbols: ["ClaudeDriver.CloseStdin", "ClaudeDriver.Driver", "FinishTurn", "TerminalPermissionChannelClosed", "permission_channel_closed"]
triggers: ["Stream closed", "dead approval channel", "poisoned conversation", "session resume"]
supersedes: []
superseded_by: ["00082"]
---

# 00081 — a closed approval channel poisons the session, not the worker

**Decision:** a turn that settles with `permission_channel_closed` drops the conversation's
session, by the same path as a refused resume: `SessionID` is cleared, `SessionLost` is set, the
lost-session notice is appended, and the next turn starts a fresh CLI session instead of
resuming. This completes [00080](./00080-unattended-permissions.md), which made the failure
visible without removing its cause.

**What the source establishes about the channel.** The only writer on a Claude process's stdin
is its `ClaudeDriver`: the spawn prompt, `Answer`, `Say`, and the refusal of unsupported control
subtypes all go through `writeStdin`. That writer is per turn, not per conversation.
`ClaudeAgent.Driver()` returns a new driver for every turn; `Spawn` creates a new process and a
new stdin pipe; `stdinClosed` is a latch on that driver instance and dies with it. No worker
state carries a closed writer from one turn to the next. The hypothesis that the worker retains
a closed writer per conversation is therefore false.

**What a turn does inherit.** The one conversation-scoped value handed to the next process is
the stored `SessionID`, passed as `--resume` (the folder is the other, but it is content, not
channel state). In the external report dated 2026-10-26, the poisoned conversation kept failing
on a healthy socket while a conversation created afterwards, on the same socket, asked and was
allowed normally. A fresh session is the difference between the two. The inheritance therefore
travels through the resumed session, and dropping it is what breaks the inheritance.

**What closes the channel inside a turn.** The worker closes stdin in exactly four places:
on a `result` frame, on stdout EOF, on `Stop` (kill), and on spawn failure. An end of stdin
while a `can_use_tool` request is outstanding is what makes the CLI answer
`Tool permission request failed: AbortError: Stream closed` and later exit `0`. Which of the
four fired first on the reporting host is not observable from this source; the list is the
bound the code gives. The eight `claude result` lines logged in one millisecond need no
retention mechanism: `claude result` is logged when the reader consumes a frame, the driver's
event channel is unbuffered, and a consumer stalled on socket fan-out (bounded at 10 s per
write) logs buffered frames in a burst when it resumes.

**Consequence.** The turn still fails as [00080](./00080-unattended-permissions.md) specifies.
It now also ends the poisoning: the next message in that conversation starts a new session, the
history above stays readable, and the notice says Claude will not remember it — which is true,
and is the recovery the incident left open. Ordinary failures and stopped turns keep their
session: neither says anything about whether it can be resumed.

**Verification:** `TestAClosedApprovalChannelDropsTheSession` settles a turn carrying
`TerminalPermissionChannelClosed` and checks that the stored session is cleared, flagged lost,
and followed by the notice. It failed before this change (session retained, no notice) and
passes after. That the marker reaches settlement from a real process is pinned by
`TestClaudePermissionsAfterObserverDisconnects`; that a blank session id spawns without
`--resume` is pinned by `TestClaudeArgs`.

```bash
cd operation/worker
go test ./internal/hybridflow-runner/agents/... ./internal/hybridflow-runner/turns/... ./internal/hybridflow-runner/http/ ./internal/hybridflow-runner/conversations/...
```

## Refactor notes

[00082](/operation/worker/docs/solution-design/decisions/00082-claude-input-ends-at-idle.md)
supersedes the causal inference about persistent session poisoning. It establishes premature
stdin closure at an intermediate result and records the incident evidence still needed to
attribute that mechanism to the reporting host. This record's defensive session clearing
remains in force.
