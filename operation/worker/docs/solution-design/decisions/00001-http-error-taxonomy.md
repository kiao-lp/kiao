---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-07-15
tags: ["worker", "http", "errors"]
triggers: ["status code", "handler error", "5xx", "error response", "sentinel error", "core.WriteError", "core.StatusForError", "core.HTTPError", "errNotDirectory", "errBadPattern", "errOutsideRoot"]
supersedes: []
superseded_by: []
---

# 00001 — Handlers return errors; one classifier maps HTTP statuses.

## Context and Problem Statement

HTTP status policy needs one auditable home. Domain and storage code must stay
HTTP-agnostic, and server failures must be traceable without exposing details to clients.

## Considered Options

* Return errors and classify HTTP statuses centrally.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Return errors and classify HTTP statuses centrally", because it separates
response policy from domain behavior and keeps classification consistent.

Handlers return errors through `core.WriteError`; `core.StatusForError` selects the HTTP
status. Domain code returns sentinels (`errNotDirectory`, `errBadPattern`, `errOutsideRoot`,
`os.ErrNotExist`) wrapped with `%w`, or an explicit `*core.HTTPError` for a one-off code.
5xx causes are logged with the request ID and their details hidden from clients.
`kiao-worker` reacts to the HTTP status rather than body wording.
