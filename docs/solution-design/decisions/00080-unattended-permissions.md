---
id: "00080"
title: "Manual Live approvals outlive Dashboard; a failed Claude approval stream ends the turn explicitly"
status: DRAFT
role: PRIMARY_SOURCE
decision_status: accepted
date: 2026-10-26
tags: ["permissions", "conversations", "unattended"]
components: ["worker", "dashboard"]
paths: ["operation/worker/internal/hybridflow-runner/agents/claude", "operation/worker/internal/hybridflow-runner/turns", "exchange/dashboard/src/plugins/chat"]
symbols: ["ApplyAsk", "autoAllow", "ClaudeDriver.userEvents", "permission_channel_closed", "endReason"]
triggers: ["Stream closed", "no subscribers", "closed Dashboard tab", "unattended writes", "Waiting for approval"]
supersedes: []
superseded_by: []
---

# 00080 — unattended permissions and approval-channel failures

**Decision:** retain the worker-owned countdown in `manualLive`, including with zero subscribers
(option 2). Explicit `manual` requests and user questions remain pending and replay on reconnect
(option 1). A disconnect never changes a turn's permission mode. This confirms
[00023](./00023-worker-plays-board.md).

**Reason and consequence:** selecting `manualLive` authorizes a tool when nobody denies it before
the configured deadline. The worker owns that decision; a connected Dashboard offers an
opportunity to intervene. An unattended turn can therefore write without a human witness.
Requiring a live browser would make unattended board execution depend on the owner's laptop and
change the meaning of the selected mode. A turn in `manual` receives no such authorization.
Questions are never answered automatically. No bypass or additional path permission is introduced.

**What the source actually did before this change:** `ApplyAsk` retained each request and started
`autoAllow` for `manualLive` without testing subscriber presence; the subscriber count was logged
only. `Disconnect` removed subscriptions without touching the process or its pending requests.
Both manual modes invoke Claude with `--permission-mode manual`, so those CLI arguments alone do
not establish which worker policy a turn uses. The literal `Waiting for approval` belongs to
Muse device sign-in, not to an alternative Claude permission queue.

The external report dated 2026-10-26 describes Claude returning
`Tool permission request failed: AbortError: Stream closed`, sometimes without any corresponding
worker permission log. The source does not establish what closed that CLI channel on that host.
It does establish that the error was retained as an ordinary tool result, allowing the model to
continue trying tools and eventually describe the failure as an authorization refusal.

**Failure behavior:** that specific error result now ends the Claude process, preserves the raw
tool result and records a failed turn with `permission_channel_closed` and an explicit `endReason`.
Dashboard shows a failed turn's recorded reason after reopening. The error says the approval
channel closed and asks for a new turn; it does not attribute the closure to a missing subscriber.
The worker does not replay an operation whose execution state it cannot establish. Ordinary tool
errors and human denials retain their normal behavior.

**Verification:** the Go HTTP integration test uses a real process, pipes and WebSocket. It lets
one approved write finish, disconnects the observer and releases a second tool call. It checks
unattended countdown approval, manual approval replay after reconnect, and an injected CLI channel
failure with a persistent reason and no continued model output.

The browser regression launches the real Dashboard and worker on throwaway data, with a controlled
Claude protocol fixture instead of a model service. It starts a turn, waits for its first write,
closes the Dashboard tab, then releases the second operation only after the worker logs the socket
disconnect. It checks the written file and `permission requested ... subscribers=0`, or injects the
reported CLI error and checks the failure reason after reopening Dashboard. Worker log extracts
are attached to the Playwright report. This reproduces the local disconnect scenario and the error
handling, not the external Windows/WSL2 incident or its unknown trigger.

Verified on 2026-10-26 against the compiled Dashboard: both browser tests passed. The worker log
recorded the following after the tab closed (times are UTC+01:00; request `second`):

```text
20:40:23.814  permission requested                 tool=Write subscribers=0
20:40:33.816  permission allowed by the countdown  after=10s
20:40:33.831  process finished                    exit_code=0
```

The injected stream failure ended with `exit_code=-1 terminal=permission_channel_closed`; its
reason was visible after reopening Dashboard. Both affected Go packages passed with `-race`,
and the two affected Dashboard test files passed all 37 tests. Running the new integration test
with the previous Claude driver passed the countdown and manual cases but failed the stream-error
case because that turn still exited successfully.

```bash
cd operation/worker
go test -race ./internal/hybridflow-runner/agents/claude/ ./internal/hybridflow-runner/http/
cd ../../e2e
E2E_SHARDS=1 E2E_CLAUDE_PERMISSIONS=1 bin/run-tests.sh tests/dashboard/chat-permissions-disconnect.spec.ts
```
