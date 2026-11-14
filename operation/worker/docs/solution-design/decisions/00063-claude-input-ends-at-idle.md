---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-27
tags: ["permissions", "conversations", "sessions", "process-lifecycle", "worker"]
triggers: ["Stream closed", "intermediate result", "first tool fails", "session_state_changed", "result burst", "poisoned conversation", "dead approval channel", "session resume", "ClaudeDriver.ReadEvent", "ClaudeDriver.systemEvent", "ClaudeDriver.closeInputIfIdle", "ClaudeDriver.closeStdin", "ClaudeHarness.Driver"]
supersedes: []
superseded_by: []
---

# 00063 — Claude input stays open until result plus idle.

## Context and Problem Statement

One CLI process can perform several Claude turns: a background agent completion can wake
its parent after an intermediate result. Closing stdin on that result makes subsequent
permission requests fail before reaching worker.

## Considered Options

* Close successful input only after a result and the current session state being idle.
* Close input unconditionally on the first result.
* Fall back to first-result closure or wait indefinitely when session-state events are unavailable.

## Decision Outcome

Chosen option: "Close successful input only after a result and the current session state being idle",
because a result alone does not establish that control requests are finished.

Keep stdin open through intermediate `result` frames. Closure requires both a result
and current `session_state_changed` state `idle`, in either arrival order. Startup
idle alone does not finish a run; `running` and `requires_action` keep input open.

Each process overrides inherited `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` and
`CLAUDE_CODE_BG_TASKS_REPORT_RUNNING=1`. The second switch holds background work and
pending continuations at running, including releases without that default.
A first result without any state report fails as `session_state_unavailable`, stops and
reaps the process instead of guessing completion or waiting indefinitely.

## More Information

### Established defect

The previous `ReadEvent` result branch called `CloseStdin` unconditionally.
Anthropic's [SDK fix](https://github.com/anthropics/claude-agent-sdk-python/pull/1279)
documents the continuation ordering and idle signal.

Inspected CLI 2.1.260 JavaScript marks structured input closed at EOF. `sendRequest` then
rejects a permission request with `Stream closed` before emitting `control_request`.
Stdout and tools needing no permission exchange can continue, explaining failure before
the first permission-bearing tool without a socket disconnect or `permission requested` log.

The subprocess regression follows:

```text
session running → background task completes → result
→ continuation → first tool → permission request → control response
→ second tool and approval → final result → session idle → stdin EOF
```

The previous driver produces `Tool permission request failed: AbortError: Stream closed`
at the first tool; the corrected driver routes both approvals and writes both files.

### Ownership and all closure paths

`Engine.StartTurnFor` calls `ClaudeHarness.Driver()` per turn, creating separate state and
closure latch. `Spawn` creates a fresh `exec.Cmd` and `StdinPipe`.
`writeStdin` alone writes prompts, `Answer`, `Say` and unsupported-request refusals;
writes and closure share `stdinMu`.

Conversations retain a `--resume` session ID, not a pipe, writer or CLI input-closed flag.
`AfterConnectionClosed` removes subscriptions and closes the socket without calling the
driver. Reservation prevents another turn until the preceding stream ends.
A later process cannot inherit the closed writer, though it could independently hit the
same first-result bug after resume.

`claude stdin closed` records conversation, turn and first closure reason:

| Reason | Trigger |
| --- | --- |
| `idle after result` | Successful completion boundary. |
| `stdout pipe failed`, `spawn failed`, `prompt write failed` | Spawn cleanup. |
| `stdout closed` | Output reader ended; non-EOF errors log separately. |
| `stopped` | Stop, including service shutdown. |
| `approval channel failed` | Fatal tool-result detector. |
| `session state unavailable` | Required completion signal unavailable. |
| `explicit close` | Exported direct-close seam used by tests. |

State changes are logged; `claude result` includes current state, `origin` and
`queued_turn_count` to distinguish completions in one process.

### What the external report establishes

The external Windows/WSL2 report's 63 tool blocks and zero permission requests do not
identify the trigger. Attributing turn `caa9` requires ordering its two `claude result`
timestamps against the first failed tool at 17:46:10; if both results followed it, this
branch cannot explain that first failure. The audit and synthetic regression neither
reproduce the host nor establish persistent session corruption.

The inspected CLI can retain results after input closes until background work drains,
then flush them together. That is compatible with eight results in one millisecond in
`b19d`; worker's unbuffered channel and socket fan-out can also delay reads. The burst
alone proves neither mechanism nor socket blockage.

### Verification evidence

`TestClaudeContinuationKeepsApprovalsBeforeItsFirstTool` uses a real subprocess and worker
socket for fresh and resumed conversations after observer disconnect. Both failed before
the change; both now retain the session, record two countdown approvals and write two files
on a healthy socket. Resume uses a new driver/process with the old session ID.
Inherited switch values `0` become `1`.

Offline `/help` on installed CLIs 2.1.226 and 2.1.260, without an SDK initialize handshake,
produced `running → result → idle` with both switches and exited `0` after closure.
This establishes signal availability, not external-host background continuations.

Unit tests cover ordering, startup idle, repeated results and post-result permission exchange.
A subprocess without state events fails and is reaped; closed-channel tests remain.
Recorded affected-package checks passed with the race detector:

```bash
cd operation/worker
go test -race ./internal/hybridflow-runner/harnesses/claude/ ./internal/hybridflow-runner/http/ -timeout 120s
```

### Recovery after an approval-channel failure

As in [ADR-00062](/docs/solution-design/decisions/00062-unattended-permissions.md),
`permission_channel_closed` remains a failed turn with raw tool result and reason.
Settlement clears `SessionID`, marks `SessionLost` and adds a lost-session notice.
The next message starts a fresh CLI session while the common transcript stays readable.
Ordinary failures and stops retain their session. Unknown-state operations are never replayed.
