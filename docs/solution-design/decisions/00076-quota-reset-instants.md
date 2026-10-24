---
id: "00076"
title: "quota resets are absolute instants displayed in the reader's local datetime"
status: accepted
date: 2026-10-23
tags: ["agents", "quota", "time"]
components: ["worker", "dashboard"]
paths: ["operation/worker/internal/hybridflow-runner/limit_reset.go", "exchange/dashboard/src/kit/date-time"]
symbols: ["limitResetAt", "quotaResetAt", "formatLocalDateTime"]
triggers: ["quota reset", "refresh datetime", "ISO reset", "monthly window", "Retry-After"]
supersedes: ["00034"]
superseded_by: []
---

# 00076 — quota resets are absolute instants displayed in the reader's local datetime

**Decision:** worker reads provider timestamps before wall clocks, preserves offsets and resolves
relative delays once when received. Quota notices carry absolute timestamps; Dashboard uses one
formatter for cards, usage gauges, conversation errors and run notices, always including weekday,
date and local time. Missing reset times remain unknown.

The provider's reset takes precedence. Without one, account quota determines the wait: all windows
reporting exhaustion must reopen. Near-full windows are only a fallback, and expired cached resets
are ignored. The sanity bound is 32 days to cover monthly plans. The existing one-minute leeway and
twenty-minute fallback remain; an elapsed explicit reset still gets the leeway from now.

**Why:** reading Muse's `2026-10-23T09:59:32Z` as `20:00` postponed the turn by hours. Formatting on
the server also uses a different locale and timezone from the reader. Waiting for the earliest of
two exhausted windows spends retries while the other window is still closed.

**Cost:** notices store canonical timestamps rather than provider wall clocks. OpenCode must retain
the provider's HTTP status and retry headers. Model prose and user prompts keep their timestamps.

## Refactor notes

Replaces 00034's eight-day bound and clock-only display. The wait, resume prompt, statuses and retry
limit still follow that decision.
