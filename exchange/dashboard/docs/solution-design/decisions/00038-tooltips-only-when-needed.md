---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-11
tags: ["ui", "tooltip", "repo", "dashboard"]
triggers: ["tooltip", "hover text", "title attribute", "word count", "dynamic value", "long tooltip", "Tooltip", "title"]
supersedes: []
superseded_by: []
---

# 00038 — Tooltips explain unclear controls in at most 16 words.

## Context and Problem Statement

Repeating a familiar action or visible label adds no information. Unfamiliar controls
and consequences can need a short explanation.

## Considered Options

* Reserve tooltips for unclear controls and limit descriptions to 16 words.
* Repeat conventional actions and visible labels in tooltips.

## Decision Outcome

Chosen option: "Reserve tooltips for unclear controls and limit descriptions to 16 words",
because each tooltip should add information needed to understand the control.

Descriptions must be as short as possible on every user-facing surface, using the app
`Tooltip` or its platform equivalent. Icon controls keep accessible names; longer
explanations belong in the adjacent panel. User-authored content and full values revealed
from truncated labels remain document data, outside this description rule.

## More Information

Dashboard uses the [shared tooltip system](00044-tooltip-system-still-second.md).
