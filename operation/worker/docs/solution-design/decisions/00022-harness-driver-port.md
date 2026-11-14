---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-03
tags: ["harnesses", "worker", "architecture"]
triggers: ["new harness", "second harness", "turn lifecycle", "spawn", "stream", "stub driver", "no claude on PATH", "HarnessDriver", "driver.go", "driver_claude.go", "HarnessOptions", "HarnessUsage", "HarnessLogin", "HarnessMCP", "driver_stub_test.go", "claude_ws.go"]
supersedes: []
superseded_by: []
---

# 00022 — Turns go through HarnessDriver port; Claude CLI is one implementation.

## Context and Problem Statement

`claude_ws.go` mixed socket fan-out, turn registry and CLI translation in 2450 lines.
Only the third concern belonged to Claude, making lifecycle tests depend on its protocol.

## Considered Options

* Isolate CLI execution behind `HarnessDriver` and optional side ports.
* Keep CLI protocol translation mixed with socket and turn management.

## Decision Outcome

Chosen option: "Isolate CLI execution behind `HarnessDriver` and optional side ports",
because the hub can manage and test complete turns independently of a CLI.

`harnesses/driver.go` defines `Spawn(run)`, `Events()`, `Answer(askId, decision)`,
`Say(text)` for a `between`, and `Stop()`. Claude's implementation,
`harnesses/driver_claude.go`, owns arguments, stream-json parsing, control requests
and briefing composition. The extraction moved 440 lines out of the combined file.

Optional `HarnessOptions`, `HarnessUsage`, `HarnessLogin` and `HarnessMCP` ports expose
prompt choices, quota, sign-in and MCP configuration. Unsupported routes stay unmounted.
The neutral hub retains conversations and transcripts, fan-out, parallelism cap, job TTL,
`sweepInterrupted`, attachments, folder resolution and `WorkflowRunner`: board playback
operates on cards rather than a particular harness.

Wire frames, endpoints, UI and `claudeProtocolVersion` keep their contracts. A `Spawn`
error is relayed verbatim as the user-facing refusal. The driver's `spawned` log records
conversation, turn, PID and working directory; the user remains on `prompt received`.

### Confirmation

`harnesses/driver_stub_test.go` lets most tests spawn, stream, answer and stop real turn
lifecycles without `claude` on PATH, replacing `sleep 60` or missing-binary stand-ins.
Board tests retain an end-to-end protocol path through a shell-script CLI fixture.
