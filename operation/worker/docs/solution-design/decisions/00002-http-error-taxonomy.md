---
id: "00002"
title: "HTTP error taxonomy (`errors.go`)"
status: accepted
date: 2026-07-15
tags: ["worker", "http", "errors"]
components: ["worker"]
paths: ["operation/worker"]
symbols: ["core.WriteError", "core.StatusForError", "core.HTTPError", "errNotDirectory", "errBadPattern", "errOutsideRoot"]
triggers: ["status code", "handler error", "5xx", "error response", "sentinel error"]
supersedes: []
superseded_by: []
---

# 00002 — HTTP error taxonomy (`errors.go`)

**Decision:** handlers never choose HTTP status codes; they return an error and call `core.WriteError`,
which classifies it in one place (`core.StatusForError`). Domain code returns sentinels
(`errNotDirectory`, `errBadPattern`, `errOutsideRoot`, `os.ErrNotExist`) wrapped with `%w`, or an
explicit `*core.HTTPError` for a one-off code. **Why:** it keeps status-code policy in a single
auditable file, keeps the service/storage layers HTTP-agnostic and testable, and guarantees 5xx
causes are logged with the request id while their detail is hidden from the client. The client
(`kiao-worker`) reacts to the HTTP status, not the body text, so wording stays free to change.
