---
id: "00005"
title: "structured logging with `log/slog`"
status: accepted
date: 2026-07-18
tags: ["worker", "logging", "observability"]
components: ["worker"]
paths: ["operation/worker"]
symbols: ["log/slog", "core.WithRequestID", "X-Request-Id", "/healthz"]
triggers: ["new log line", "request id", "correlate failure", "liveness probe", "component logger"]
supersedes: []
superseded_by: []
---

# 00005 — structured logging with `log/slog`

**Decision:** logging is `log/slog` text output with one process logger and per-subsystem
`component=` loggers, plus a per-request short id (`core.WithRequestID` → context + `X-Request-Id`) that
the single-line request trace and every error log carry. **Why:** it replaces ad-hoc bracketed
prefixes with structured, greppable fields that correlate a failure to its trace via the request
id, at zero new dependencies (standard library) and no change to the deployment (stdout →
journald under systemd). The `/healthz` probe sits outside the middleware chain so liveness checks
stay unauthenticated, untraced and cheap.
