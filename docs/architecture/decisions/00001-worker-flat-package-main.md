---
id: "00001"
title: "worker stays one flat `package main`"
status: accepted
date: 2026-07-15
tags: ["worker", "go", "packaging"]
components: ["worker"]
paths: ["operation/worker"]
symbols: ["package main"]
triggers: ["new package", "internal/", "second binary", "import cycle", "where to put code"]
supersedes: []
superseded_by: []
---

# 00001 — worker stays one flat `package main`

**Decision:** keep the service a single flat `package main` (~24 non-test files) rather than
splitting it into internal packages. **Why:** it is a small personal tool; a flat package keeps
every symbol reachable without export ceremony or import cycles, and the file names already carry
the structure (`handlers_*`, `service`, `storage`, `git`, `claude_*`, `migrations`, `auth`). The
hardening prompts (05, 09) added error handling, shutdown, job lifecycle and slog **inside** this
layout on purpose — the code map in `README.md`, not the package graph, is where a reader orients.
Revisit only if the file count roughly doubles or a genuine second binary appears.

## Refactor notes

TODO: later entries describe `internal/toolbox` (00028), `internal/agents` (00035) and `internal/hybridflow-runner` inside worker, but no entry records revisiting this decision against its own trigger (file count doubling or a second binary). Confirm whether flat-`main` still holds or was superseded without a log entry.
