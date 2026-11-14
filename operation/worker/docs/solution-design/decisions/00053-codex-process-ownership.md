---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-17
tags: ["agents", "processes", "lifecycle", "worker"]
triggers: ["orphan Codex", "Node launcher", "turn cancellation", "worker death", "setsid", "double fork", "stop and resume", "supervisedAgentProcess", "RunHarnessProcessSupervisor", "processPending", "HarnessDriver"]
supersedes: []
superseded_by: []
---

# 00053 — Codex turns own descendants until subreaper confirms cleanup.

## Context and Problem Statement

Codex's npm command is a Node launcher around a native child. Killing Node with
`SIGKILL` leaves that child working and can keep output pipes open; process-group kills
miss tools that create sessions. A settled transcript also does not prove cleanup has ended.

## Considered Options

* Run each Codex turn under a Linux subreaper and reserve execution until cleanup completes.
* Kill only the Node launcher.
* Kill only the initial process group.
* Wait for output-pipe EOF before confirming process exit.

## Decision Outcome

Chosen option: "Run each Codex turn under a Linux subreaper and reserve execution until cleanup completes",
because descendant cleanup must finish before another execution uses the conversation.

Worker re-executes its own binary through a private entry point before reading server
configuration. The supervisor starts outside worker's process group and monitors a control
pipe held only by worker: cancellation closes it explicitly, worker death closes it in
the kernel, and launcher exit triggers the same cleanup.

The subreaper adopts orphans, including session-changing or double-forking tools. It kills
and reaps immediate children, adopting further descendants as parents die, until `wait4`
returns `ECHILD`. Only then does it confirm completion. It does not depend on output-pipe
draining; the driver also waits after a failed prompt write. Traces keep launcher and
supervisor PIDs separately.

Every driver's hub reservation and parallelism capacity remain held until `Spawn` fails
or the event stream closes. Interruption during spawn or execution does not release them,
and the janitor cannot evict them. Shutdown refuses reservations and stops a driver whose
spawn returns after shutdown begins.

Ownership follows local descendants. Work handed to an independent manager, such as a
remote systemd upgrade, continues under that manager. Cleanup neither searches process names
across the machine nor cancels remote work; other drivers retain their process implementations.

### Consequences

* Bad, because each active Codex turn needs another Go process and Linux `/proc` plus
  subreaper support. Missing facilities refuse the turn; no extra binary, supervisor
  installation, privilege or systemd is required.
* Bad, because a process awaiting termination keeps its conversation reserved.

### Confirmation

[Process regressions](/operation/worker/internal/hybridflow-runner/http/driver_codex_process_linux_test.go)
cover Node/native/tool descendants, open or closed inherited pipes, normal launcher exit
or `SIGKILL`, new groups, double forks, worker and worker-group death, failed prompt
writes, early cancellation, resume and independently managed work.
[Hub regressions](/operation/worker/internal/hybridflow-runner/http/turn_lifecycle_test.go)
hold spawn and stream closure separately to prevent overlapping execution.
The recorded 17 scenarios passed 20 race-detector repetitions; compiled-worker reproductions
also passed cancellation, launcher death and normal exit.
