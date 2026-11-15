---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-07-18
tags: ["worker", "logging", "observability"]
triggers: ["new log line", "request id", "correlate failure", "liveness probe", "component logger", "log/slog", "core.WithRequestID", "X-Request-Id", "/healthz"]
supersedes: []
superseded_by: []
---

# 00003 — Worker logs via slog with per-request id.

## Context and Problem Statement

Ad-hoc log prefixes do not provide consistent fields for correlating errors and request
traces. Logging must fit the existing stdout-to-journald deployment.

## Considered Options

* Use standard-library `slog` with request and component fields.
* Keep ad-hoc bracketed log prefixes.

## Decision Outcome

Chosen option: "Use standard-library `slog` with request and component fields", because it
provides searchable, correlated logs without a dependency or deployment change.

Worker uses `log/slog` text output, one process logger and per-subsystem `component=`
loggers. `core.WithRequestID` puts a short request ID in context and `X-Request-Id`;
the single-line request trace and error logs carry it.

`/healthz` sits outside the middleware chain so liveness checks remain unauthenticated,
untraced and cheap.
