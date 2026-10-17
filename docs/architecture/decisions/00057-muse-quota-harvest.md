---
id: "00057"
title: "the Muse quota is harvested off the turns, and the strip is lit for all three"
status: accepted
date: 2026-09-15
tags: ["agents", "muse", "quota"]
components: ["worker", "dashboard"]
paths: []
symbols: ["usage/read", "usage/changed", "AgentUsage", "windows", "503"]
triggers: ["Muse quota strip", "unavailable quota", "503 quota", "probe turn", "newest observation", "arrival stamp"]
supersedes: []
superseded_by: []
---

# 00057 — the Muse quota is harvested off the turns, and the strip is lit for all three

**Decision:** the Muse agent answers the quota port. Each turn's host is asked MSP `usage/read` as
its turn ends, and whatever `usage/changed` a turn emits is recorded as it lands; the endpoint
answers the newest observation any turn has brought back, in the same `{ windows }` payload the
other two agents already share. The 2026-09-12 entry that brought the third agent said MSP reported
no account quota — it does, but only as a host's last observation, so a one-question host comes back
empty and there is no stateless read to make. Before any turn has run there is nothing to answer,
which is a `503` and reads as an unavailable quota.

**Why harvest rather than probe.** Claude spends a one-token probe per read and Codex asks its
app server for free; Muse has neither. The only other way to fresh figures would be a probe turn,
which spends a real turn's tokens and fifteen seconds every two minutes per open column. A turn that
has just run is the freshest observation there is, and a turn refused for having no quota left —
the moment the strip matters most — is harvested like any other. Two turns may run at once on two
hosts, so "newest" is the host's arrival stamp rather than the order the answers landed in.

**One panel stays dark.** The sign-in is still undrivable from here — `muse login` is a device flow
in a terminal — so of the two dark panels the 2026-09-12 entry named, only that one remains. The
wire changed nowhere, and Dashboard changed in two comments: the strip was already read per agent,
so a Muse column went from "Usage indisponible" to bars with no code touched on that side. A
workflow run holding for a Muse usage limit now waits on the observed resets like the other two
instead of its blind twenty minutes.
