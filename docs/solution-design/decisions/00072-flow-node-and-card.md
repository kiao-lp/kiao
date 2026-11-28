---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-28
tags: ["hybridflow", "terminology", "dashboard", "worker", "hybridflow-store"]
triggers: ["flow node vs card", "board model", "canvas terminology", "FlowNodeCard"]
---

# 00072 — Flow nodes and cards name distinct concepts.

## Context and Problem Statement

[ADR 00042](00042-flow-nodes-not-tasks.md) gave all board elements a shared name and
identified the types that carry tasks. Documentation and implementation still use *card*
for both stored elements and their canvas representation. An archived element still has
an identity and data while its card is absent from the canvas.

## Considered Options

* Use *flow node* for the board element and reserve *card* for its graphical representation.
* Continue using *card* for both the element and its representation.

## Decision Outcome

Use *flow node* for the board element and reserve *card* for its graphical representation.
This gives lifecycle and execution operations vocabulary that applies even when no board is
open, and gives rendering and pointer interactions a term for the object on screen.
The [Hybridflow concept catalog](../../architecture/data/hybridflow-concept-catalog.md)
defines current usage, including *task*.

## More Information

The persisted chain-run log value `"prompt": "card"` identifies prompts sourced from AI
tasks. Other compatibility-sensitive names include identifiers in applied migrations and
published package interfaces.
