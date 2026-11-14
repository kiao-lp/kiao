---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-23
tags: ["agents", "quota", "time", "hybridflow", "runs", "errors", "limits", "worker", "dashboard"]
triggers: ["quota reset", "refresh datetime", "ISO reset", "monthly window", "Retry-After", "limit notice", "session limit", "resets", "API Error", "done vs error", "last block", "529", "usage limit", "429", "waiting refresh", "resume line", "weekly window", "eight-day bound", "limitResetAt", "quotaResetAt", "formatLocalDateTime"]
supersedes: []
superseded_by: []
---

# 00059 — Quota resets are absolute instants, shown local time.

## Context and Problem Statement

Reading Muse's `2026-10-23T09:59:32Z` as `20:00` postponed a turn by hours.
Server formatting can also use the wrong locale or timezone. Retrying at the first reset
wastes attempts if another quota window remains exhausted.

## Considered Options

* Preserve absolute reset instants and format them locally in Dashboard.
* Parse provider timestamps as wall-clock times and format on the server.
* Retry at the earliest reset among exhausted windows.
* Use only a fixed short retry delay for subscription limits.

## Decision Outcome

Chosen option: "Preserve absolute reset instants and format them locally in Dashboard",
because absolute instants retain offsets and let retries wait for every exhausted window.

Worker prefers provider timestamps to wall clocks and resolves relative delays once on
receipt. Notices store canonical timestamps; Dashboard shares a formatter across cards,
usage gauges, errors and run notices, always showing weekday, date and local time.
Unknown resets stay unknown; model prose and user-prompt timestamps remain untouched.
OpenCode preserves HTTP status and retry headers.

Provider resets take precedence. Otherwise all exhausted account windows must reopen;
near-full windows are only a fallback, and expired cached resets are ignored.
A 32-day sanity bound covers monthly plans. The one-minute leeway and twenty-minute
fallback remain; an already elapsed explicit reset still adds a minute from now.

A subscription limit records task `waiting-refresh`, run `refreshing` and `retryAt`,
remaining visible without a browser. Stop interrupts waiting and retry limits still apply.
Recovery sends `You have been interrupted, please resume cleanly` in the existing
conversation, without resending description or attachments. One task log spans attempts.

CLI errors are whole blocks at reply head or foot, not matching phrases anywhere in prose.
Limits and failures never complete a task or advance its chain. Partial output remains
in the conversation; the description stays available and is not filed as a successful answer.
