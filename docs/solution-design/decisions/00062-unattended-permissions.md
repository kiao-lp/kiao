---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-26
tags: ["permissions", "conversations", "unattended", "worker", "dashboard"]
triggers: ["Stream closed", "no subscribers", "closed Dashboard tab", "unattended writes", "Waiting for approval", "ApplyAsk", "autoAllow", "ClaudeDriver.userEvents", "permission_channel_closed", "endReason"]
supersedes: []
superseded_by: []
---

# 00062 — Approvals outlive Dashboard; failed stream ends turn.

## Context and Problem Statement

Disconnecting Dashboard must preserve the selected permission mode during unattended work.
The 2026-10-26 external report also described
`Tool permission request failed: AbortError: Stream closed` without some corresponding
worker permission logs; its closure trigger was not established.

## Considered Options

* Preserve mode-specific handling: pending explicit requests and worker-owned Manual Live deadlines.
* Require a live browser for unattended countdown approval.

## Decision Outcome

Chosen option: "Preserve mode-specific handling: pending explicit requests and worker-owned Manual Live deadlines",
because authorization belongs to the selected mode rather than browser presence.
This confirms [ADR-00013](00013-worker-plays-board.md).

`manualLive` retains its worker countdown with zero subscribers (recorded option 2):
selecting it authorizes a tool unless denied before the deadline, including unattended
writes without a witness. Explicit `manual` requests and user questions remain pending
and replay on reconnect (option 1). Questions are never answered automatically.
Disconnect changes neither permission mode nor path permissions and adds no bypass.

The specific closed-channel tool result ends Claude, preserves the raw result and records
failure as `permission_channel_closed` with `endReason`. Dashboard displays the reason
after reopening and requests a new turn, without blaming missing subscribers. Worker never
replays an operation whose execution state is unknown. Ordinary errors and human denials
retain their behavior.

### Confirmation

Go integration uses a real process, pipes and WebSocket: one approved write completes,
the observer disconnects, then another tool call is released. It checks unattended approval,
manual-request replay and injected stream failure with a persistent reason and no continued
model output.

Browser regressions use compiled Dashboard, worker and a controlled Claude fixture on
throwaway data. After the first write, the tab closes; the second operation waits for the
logged socket disconnect. Tests assert the file and `permission requested ... subscribers=0`,
or inject failure and check the reason after reopening. Worker logs are attached.
These reproduce local disconnect/error handling, not the Windows/WSL2 incident or its trigger.

Recorded results on 2026-10-26: both browser cases passed; request `second` logged
the following in UTC+01:00:

```text
20:40:23.814  permission requested                 tool=Write subscribers=0
20:40:33.816  permission allowed by the countdown  after=10s
20:40:33.831  process finished                    exit_code=0
```

Injected failure ended with `exit_code=-1 terminal=permission_channel_closed` and a visible
reason after reopening. Both Go packages passed `-race`; both Dashboard files passed all
37 tests. Against the previous driver, countdown and manual cases passed but stream failure
incorrectly exited successfully.

```bash
cd operation/worker
go test -race ./internal/hybridflow-runner/harnesses/claude/ ./internal/hybridflow-runner/http/
cd ../../e2e
E2E_SHARDS=1 E2E_CLAUDE_PERMISSIONS=1 bin/run-tests.sh tests/dashboard/chat-permissions-disconnect.spec.ts
```

## More Information

The source audit found `ApplyAsk` retained requests and started `autoAllow` without checking
subscriber presence; the count was only logged. `Disconnect` removed subscriptions without
changing process or requests. Both modes use `--permission-mode manual`, so CLI arguments
alone do not identify worker policy. `Waiting for approval` refers to Muse device sign-in.

Previously the stream error stayed an ordinary tool result, letting the model continue and
describe an authorization refusal.
