---
id: "00082"
title: "Claude control input ends after a result and session idle"
status: accepted
date: 2026-10-27
tags: ["permissions", "conversations", "sessions", "process-lifecycle"]
components: ["worker"]
paths: ["operation/worker/internal/hybridflow-runner/agents/claude", "operation/worker/internal/hybridflow-runner/http"]
symbols: ["ClaudeDriver.ReadEvent", "ClaudeDriver.systemEvent", "ClaudeDriver.closeInputIfIdle", "ClaudeDriver.closeStdin", "ClaudeAgent.Driver"]
triggers: ["Stream closed", "intermediate result", "first tool fails", "session_state_changed", "result burst", "poisoned conversation"]
supersedes: ["00081"]
superseded_by: []
---

# 00082 — Claude control input ends after a result and session idle

**Decision:** keep the CLI's stdin open through intermediate `result` frames. Successful input
closure requires both a result and the CLI's current `session_state_changed` state being `idle`.
Either may arrive first. Startup `idle` without a result does not finish the run.

Each process receives `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` and
`CLAUDE_CODE_BG_TASKS_REPORT_RUNNING=1`, overriding inherited values. The second switch makes
background work and pending continuations hold the state at `running`, including on CLI releases
where that behaviour is not the default. `requires_action` also keeps input open. A CLI that
reaches its first result without reporting a state fails explicitly with terminal
`session_state_unavailable` and is stopped and reaped; it cannot silently fall back to closing
stdin on that result or wait indefinitely for an unsupported signal.

## Established defect

In the driver before this fix, the `result` branch of `ReadEvent` called `CloseStdin`
unconditionally. A worker turn owns an entire CLI process, but a process can perform several
Claude turns: a background agent finishing can wake its parent for another completion. A result
from an earlier completion therefore does not establish that the process is done using control
requests. Anthropic describes this ordering and uses the CLI's idle signal in its
[SDK fix](https://github.com/anthropics/claude-agent-sdk-python/pull/1279).

The embedded JavaScript inspected in the locally installed CLI 2.1.260 establishes the other
half of the chain: the structured-input reader marks input closed at EOF; `sendRequest` then
rejects a new permission request with `Stream closed` **before** putting a `control_request`
on stdout. The model can continue with tools that do not require that request, while stdout
remains readable. Thus an intermediate result can close the channel before the first
permission-bearing tool, with no `permission requested` log and no socket disconnect.

The subprocess regression exercises exactly this order:

```text
session running → background task completes → result
→ continuation → first tool → permission request → control response
→ second tool and approval → final result → session idle → stdin EOF
```

With the previous driver it instead reaches the first tool with stdin already closed and
records `Tool permission request failed: AbortError: Stream closed`. With this driver both
permissions reach the worker and both files are written.

## Ownership and all closure paths

`Engine.StartTurnFor` calls `ClaudeAgent.Driver()` for each turn. That factory creates a driver
with its own closure latch and state; `Spawn` creates a new `exec.Cmd` and `StdinPipe`.
`writeStdin` is the sole production writer: initial prompt, `Answer`, `Say`, and refusals of
unsupported control requests. Those writes and closure share `stdinMu`.

The conversation retains a session ID passed to `--resume`, not an OS pipe, Go writer or the
CLI's in-memory input-closed flag. `AfterConnectionClosed` removes socket subscriptions and
closes the socket; it never calls the driver. The reservation also prevents the next turn from
starting until the preceding process's stream has ended. A closed writer is therefore not
inherited by a later turn. A fresh process could encounter the same erroneous first-result
closure independently, including after resuming history.

All explicit closures now log `claude stdin closed` with conversation, turn and the first
closure reason:

| Reason | Trigger |
| --- | --- |
| `idle after result` | The successful completion boundary above. |
| `stdout pipe failed`, `spawn failed`, `prompt write failed` | Spawn cleanup. |
| `stdout closed` | Output reader ended; non-EOF read errors are logged separately. |
| `stopped` | Explicit Stop, including service shutdown. |
| `approval channel failed` | The existing fatal tool-result detector. |
| `session state unavailable` | The CLI cannot supply the required completion boundary. |
| `explicit close` | The exported direct-close seam, used by tests. |

Session-state changes are logged too. Each `claude result` now includes the current state,
its `origin` and `queued_turn_count` to distinguish completions within the same process.

## What the external report establishes

The Windows/WSL2 observations are testimony from another machine. The 63 tool blocks and zero
permission requests do not identify the closure trigger by themselves. The two `claude result`
timestamps relative to the first failed tool at 17:46:10 are needed to attribute this defect
specifically to turn `caa9`. If both results followed the first failed request, this branch
cannot have caused that initial failure. Neither the source audit nor the synthetic test
reproduces that machine or proves persistent session corruption.

The CLI also has its own result retention: with input closed and background work pending,
the inspected headless loop holds result frames and flushes them together when the work drains.
This provides a concrete buffering mechanism compatible with the eight results in one
millisecond in `b19d`. The worker's unbuffered event channel and socket fan-out can delay reads
as well. The burst alone does not distinguish those mechanisms or prove a socket blockage.

## Refactor notes

This supersedes the causal inference in [00081](/docs/solution-design/decisions/00081-closed-approval-channel-drops-the-session.md):
the difference between a resumed conversation and a new one did not establish session
poisoning. Its defensive session clearing remains, together with [00080](/docs/solution-design/decisions/00080-unattended-permissions.md)'s
recorded failure, preserved tool error and suppression of later output. They handle an actual
channel failure; the idle boundary prevents the established premature closure.

## Verification

`TestClaudeContinuationKeepsApprovalsBeforeItsFirstTool` drives a real test subprocess over the
worker socket. It covers a fresh conversation and a resumed turn after the preceding observer
disconnected. Both variants failed before the driver change. Both now retain the session,
record two countdown approvals and write two files on a healthy socket. The resumed variant
uses a distinct driver and passes the previous session ID to a new process. Inherited state
switches set to `0` are overridden to `1` in both variants.

An isolated, offline `/help` invocation on the locally installed CLIs 2.1.226 and 2.1.260,
without an SDK initialize handshake, also produced `running → result → idle` with both switches
enabled and exited `0` after input closed. This checks signal availability, not background
continuations on the external host.

Unit tests cover result/idle ordering, startup idle, several results and a permission exchange
after an intermediate result. A subprocess without state events fails explicitly and is
reaped. Existing closed-channel detection tests remain. The affected packages pass with
the race detector:

```bash
cd operation/worker
go test -race ./internal/hybridflow-runner/agents/claude/ ./internal/hybridflow-runner/http/ -timeout 120s
```
