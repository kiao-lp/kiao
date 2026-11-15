---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-15
tags: ["agents", "muse", "quota", "worker", "dashboard"]
triggers: ["Muse quota strip", "unavailable quota", "503 quota", "probe turn", "newest observation", "arrival stamp", "usage/read", "usage/changed", "HarnessUsage", "windows", "503"]
supersedes: []
superseded_by: []
---

# 00041 — Muse quota harvested from turns into shared payload.

## Context and Problem Statement

Muse exposes quota only as a host's last observation; a fresh one-question host returns
none. Unlike Claude's one-token probe or Codex's free app-server read, a Muse probe costs
a real turn and about fifteen seconds every two minutes per open column.

## Considered Options

* Harvest quota observations from real completed or refused turns.
* Run probe turns to obtain fresh quota observations.

## Decision Outcome

Chosen option: "Harvest quota observations from real completed or refused turns", because
a recent real turn supplies available observations without another turn's cost.

Worker asks MSP `usage/read` when a turn ends and records `usage/changed` as emitted.
The quota port returns the newest observation in the shared `{ windows }` payload,
including observations from turns refused for exhaustion. Concurrent hosts are ordered by
the host's arrival stamp rather than response completion order.

Before any observation, the endpoint returns `503` and quota appears unavailable.
Existing per-agent rendering displays the bars without a wire or Dashboard behavior change.
Muse-limited runs now use observed resets rather than a blind twenty-minute wait.

## More Information

This corrects the 2026-09-12 record's claim that MSP exposes no account quota: it has no
stateless read, but hosts do retain observations. `muse login` remains a terminal device
flow, so panel-driven sign-in stays unavailable.
