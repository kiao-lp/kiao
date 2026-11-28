---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Muse driver

The Muse integration implements the shared
[`HarnessDriver`](../../internal/hybridflow-runner/harnesses/driver.go) port inside
[`harnesses/muse`](../../internal/hybridflow-runner/harnesses/muse). One `muse serve`
process runs each worker turn. A recovery may replace the native MSP turn on that same host.
`turns.Engine` consumes common harness events. MSP vocabulary, session storage,
configuration staging and account quota harvesting belong to Muse.

## Responsibilities and dependencies

All parts stay in one integration package. Host snapshots, prepared answers and roster values
provide the internal boundaries; they need no worker-wide service or additional goroutine.

| Source | Responsibility and dependencies |
| --- | --- |
| `harness_muse.go` | Process-wide harness capabilities; options, login and shared quota services. |
| `driver_muse.go` | Driver composition and concurrent `Answer`, `Say`, `Stop` entry points. |
| `muse_session.go` | Run translation, session start/resume/fork, model and permission selection, turn start and compaction. Uses MSP and staging. |
| `muse_staging.go` | Private settings, skill and login links, environment, redacted execution trace and staging removal. |
| `muse_host.go`, `muse_tokens.go` | Shared connection and native turn identity, stop latch and token accounting across retries and child snapshots. |
| `muse_asks.go` | Approval stages, questions, decision preparation and settlements. The request store builds detached MSP commands without I/O. |
| `muse_relay.go` | Sole event producer; dispatch of live and recovered notifications, timers and stream completion. |
| `muse_completion.go`, `muse_subagents.go` | Completed items and terminal outcomes; synchronous child transcript reads retain parent order. |
| `muse_recovery.go`, `muse_activity.go` | Silence detection, notification census, paged catch-up, session and journal liveness, one native retry. |
| `muse_background.go`, `muse_roster.go` | Open work, deferred completion and reconciliation; immutable roster snapshots in first-sight order. |
| `muse_account_usage.go`, `muse_usage.go` | Bounded end-of-turn harvest and live subscription observations; shared account quota cache and refresh. |
| `muse_msp.go` | JSON-RPC transport, ordered stdout reader, serialized writes, request correlation and host shutdown. |

## State and synchronization

`Spawn` fixes the run, stages credentials, opens the host and prepares startup events.
It starts the relay only after preparation; it emits no events because the consumer starts
reading after `Spawn` returns. The relay then owns staging cleanup, the subagent reader,
activity census, recovery cursor and journal baseline, open background work, roster and drain.
These values have no concurrent control-call reader and need no mutex.

Two owners synchronize the state shared with control calls:

| Owner | Protected state | Access rule |
| --- | --- | --- |
| `museHost` | Connection, stop latch, session/current/last turn IDs, compaction flag and token accumulator. | Its methods return value snapshots or perform an identity/accounting transition under `mu`. |
| `museAsks` | Pending requests, current approval requirement and choices, answered flag and deciding command IDs. | Its methods prepare decisions, update stages and recognize settlements under its own `mu`. |

Neither mutex is held during an RPC, process shutdown or event delivery, and neither owner
acquires the other's mutex. An approval response captures its requirement and choice together
and records its command ID before sending. An immediate settlement recognizes that decision;
a subsequent stage update reopens the request. Published `HarnessAsk` values remain immutable:
an update replaces the value before publishing it again.

The MSP connection owns its write and pending-request locks. Its `Close` runs once, releases
a reader blocked on a full notification queue, kills and reaps the host, joins the stdout
reader and flushes stderr. Concurrent stop and completion paths share that shutdown.

## Ordering and lifecycle guarantees

- The relay sends startup events first. Live and paged notifications use the same dispatcher,
  and only completed items produce transcript blocks. Child reads run on the relay, preserving
  parent order. Token usage and background roster updates precede their completed block.
- A native turn end clears the running ID and retains the last ID for late background items.
  Steering requires a running ID. Replaced turns' terminal events do not end the current turn.
- Open background work defers completion while keeping the host alive. The drain retains the
  first outcome and ends on settlement or its bound. Silence during draining polls work;
  it does not start another native turn. See [quiet-turn recovery](muse-quiet-turn.md).
- Account quota harvest is bounded and precedes the final `harnessDone`. A harvest failure
  retains the previous account observation and does not change the turn outcome.
- The stream ends with exactly one final `harnessDone`. Host shutdown and credential staging
  removal finish before channel closure releases the engine's execution reservation.

## Verification

Driver tests and the scripted MSP host live beside the integration. HTTP keeps the harness
registry/capability tests. `muse_concurrency_test.go` checks immediate settlement and stage
updates during an answer, consistent decisions under concurrent updates, immutable published
requests, shutdown with a full notification queue, and concurrent control calls with cleanup.

From `operation/worker`:

```bash
go test ./internal/hybridflow-runner/harnesses/muse
GORACE=atexit_sleep_ms=0 go test -race ./internal/hybridflow-runner/harnesses/muse
go test ./internal/hybridflow-runner/http -run Muse
go test ./internal/app -run Package
```

`GORACE` removes the race runtime's exit delay in each scripted child process. The live
handshake test remains conditional on the installed host and compatible filesystem.
