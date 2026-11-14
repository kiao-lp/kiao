---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-26
tags: ["agents", "auth", "claude", "worker", "dashboard"]
triggers: ["login banner", "/login", "session expired", "auth status poll", "blanked tokens", "GET /agents/auth/status", "loggedIn", "useClaudeAuth", "refreshTokenExpiresAt", "kiao-claude-keepalive.timer"]
supersedes: []
superseded_by: []
---

# 00012 — `loggedIn` means a turn could run.

## Context and Problem Statement

`claude auth status` reports `loggedIn: true` from credential presence even after the refresh
token expires. Turns then return `Please run /login` while the panel's `loggedIn` field hides
the sign-in banner; reloading repeats the same incorrect answer.

## Considered Options

* Cross-check CLI status against refresh-token expiry and cleared tokens.
* Trust credential presence reported by the CLI alone.
* Treat access-token expiry as a sign-out.

## Decision Outcome

Chosen option: "Cross-check CLI status against refresh-token expiry and cleared tokens",
because an expired access token can renew while an expired refresh token ends the session.

`GET /agents/auth/status` compares `claude auth status --json` with its stored OAuth
session. It reports `loggedIn: false` for expired `refreshTokenExpiresAt` or tokens the
CLI has blanked. Access tokens expire every few hours and renew on a real call; a
deployment keepalive can maintain that chain. Their expiry alone does not mean sign-out.

The check can only remove `loggedIn`: a CLI sign-out is authoritative, and unreadable
credentials leave its answer standing because relocation or permissions do not establish
expiry. The panel relies on that field alone.

`useClaudeAuth` polls every five minutes and re-reads when the tab returns to the front.
A failed read preserves the last known state rather than erasing a valid sign-in banner.
