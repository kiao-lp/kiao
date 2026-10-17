---
id: "00070"
title: "Codex turns retain ownership of local descendants until all are reaped"
status: accepted
date: 2026-10-17
tags: ["agents", "processes", "lifecycle"]
components: ["worker"]
paths: ["operation/worker/internal/hybridflow-runner", "operation/worker/main.go"]
symbols: ["supervisedAgentProcess", "RunAgentProcessSupervisor", "processPending", "AgentDriver"]
triggers: ["orphan Codex", "Node launcher", "turn cancellation", "worker death", "setsid", "double fork", "stop and resume"]
supersedes: []
superseded_by: []
---

# 00070 — Codex turns retain ownership of local descendants until all are reaped

**Decision:** each Codex turn runs under a separate Linux subreaper. The worker re-executes
its own binary through a private entry point before server configuration is read; no second
binary or external supervisor needs installing. The supervisor starts outside the worker's
process group and receives a control pipe that only the worker holds open. Cancellation closes
that pipe; worker death closes it in the kernel. Launcher exit triggers the same cleanup.

The supervisor adopts orphaned descendants, including tools that create a session, leave the
initial process group or double-fork. It kills its immediate children and reaps them until
`wait4` reports `ECHILD`, adopting further descendants as their parents die. Only then does
it confirm completion and exit. Cleanup does not depend on draining the agent's output pipes.
The driver waits for cleanup after a failed prompt write too. Its trace retains the CLI
launcher's PID and records the supervisor PID separately.

The agent-neutral hub keeps a conversation's execution reservation and parallelism capacity
until `Spawn` has failed or the driver's event stream has closed. Recording an interruption
does not release that reservation, including during spawn; the janitor cannot evict it.
Shutdown refuses new reservations and stops a driver whose spawn returns after shutdown began.

**Why:** the npm Codex entry point is a Node launcher around a native child. Killing only
Node with `SIGKILL` bypasses its signal handlers and leaves the native agent working.
Waiting for pipe EOF before process exit can stall on that surviving child. A process-group
kill alone also misses tools that start their own session. Separately, a settled transcript
is not proof that a driver has finished cleaning up; releasing it early permits overlapping
executions of one conversation.

**Scope:** ownership follows local descendants. Work handed to an independent manager,
such as a remote OS upgrade started by systemd, belongs to that manager and continues.
There is no process-name search across the machine and no remote cancellation. Other agent
drivers keep their process implementation; the reservation rule applies to all drivers.

**Cost:** one additional Go process per active Codex turn, and Linux `/proc` plus subreaper
support. Startup refuses a turn when those facilities are unavailable. No privilege or systemd
is required. A process still awaiting termination keeps its conversation reserved.

**Verification:** [process regressions](/operation/worker/internal/hybridflow-runner/driver_codex_process_linux_test.go)
exercise a Node launcher, native-agent stand-in and tool: inherited pipes open or closed,
launcher exit or `SIGKILL`, new process group, double fork, worker and worker-group death,
failed prompt write, early cancellation, session resume and independently managed work.
[Hub regressions](/operation/worker/internal/hybridflow-runner/turn_lifecycle_test.go) hold
spawn and stream closure separately to prove that interruption cannot start a second execution.
All 17 scenarios pass 20 repetitions under the race detector. The compiled worker's private
entry point also passes cancellation, launcher death and normal-exit reproductions.
