---
id: "00020"
title: "`loggedIn` means a turn could run, not that a credentials file exists"
status: accepted
date: 2026-08-26
tags: ["agents", "auth", "claude"]
components: ["worker", "dashboard"]
paths: []
symbols: ["GET /agents/auth/status", "loggedIn", "useClaudeAuth", "refreshTokenExpiresAt", "kiao-claude-keepalive.timer"]
triggers: ["login banner", "/login", "session expired", "auth status poll", "blanked tokens"]
supersedes: []
superseded_by: []
---

# 00020 — `loggedIn` means a turn could run, not that a credentials file exists

**Decision:** `GET /agents/auth/status` cross-checks `claude auth status --json` against the OAuth
session the CLI stores, and reports `loggedIn: false` for a session nothing unattended can renew —
a refresh token past its expiry, or tokens the CLI has blanked in place. The panel reads that one
field and nothing else, so it is the field that has to carry the meaning.

**Why.** `claude auth status` answers from the *presence* of the credentials blob. A session whose
refresh token lapsed overnight — with nothing running to notice — is still reported `loggedIn: true`
while every turn started under it comes back `Please run /login`. The sign-in banner is rendered
from `loggedIn`, so it never appeared, and reloading the page did not bring it: the reload asked the
same question and was told the same thing. That is the shape this bug kept coming back in, and
patching it downstream of the field could only ever hide it again.

**The two expiries are not the same event.** The access token lapses every few hours and the CLI
renews it as a side effect of the next real call — routine, and a deployment keepalive
timer can keep that chain from
breaking on its own. Only `refreshTokenExpiresAt` ends the session. Reading the access token's
expiry as a sign-out would put the banner up several times a day over a session that works, which
is the same failure wearing the other face.

**The check only ever takes `loggedIn` away.** A CLI that reports a sign-out is the authority on it,
and credentials that cannot be read leave its answer standing — a relocated file or a permission the
service lacks says nothing about the session, and a banner nobody can dismiss would be this bug
pointing the other way.

**On the client, the status is re-read rather than read once.** A session ends at an hour nobody
chose, and a status read when the panel mounted is a fact about the morning. `useClaudeAuth` polls
every five minutes and re-reads whenever the tab comes back to the front — which is the moment a
user who has been away is about to type. A failed read changes nothing it knows: it is the service
that could not be reached, and erasing a banner that had correctly appeared is how the same silence
returns from the other end.
