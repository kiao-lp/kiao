---
id: "00007"
title: "the applicability rule is evaluated on both sides, and the protocol is the contract"
status: accepted
date: 2026-08-10
tags: ["file-actions", "contracts"]
components: ["worker", "dashboard", "kiao-worker"]
paths: ["operation/worker"]
symbols: ["actionApplies", "appliesTo", "PROTOCOL.md", "files/actions.go"]
triggers: ["context menu", "right-click", "appliesTo", "extensions", "directory rule", "async menu"]
supersedes: []
superseded_by: []
---

# 00007 — the applicability rule is evaluated on both sides, and the protocol is the contract

**Decision:** an action's `appliesTo` may only say `extensions` and `directory`, and that rule is
implemented twice — `actionApplies` in `files/actions.go` and `appliesTo.ts` in cms-core — with the same
test table on both sides and `PROTOCOL.md` as the normative description. **Why:** the context menu
has to decide what to show at right-click time, and a round trip per right-click would make the menu
async for the first time. Keeping the vocabulary to what a client already knows about an entry
(`{ path, isDirectory }`) buys a synchronous menu; the duplication is the price, bounded by keeping
the vocabulary deliberately poor. Anything an action cannot express within it belongs in the owning
service, not in a richer rule language.
