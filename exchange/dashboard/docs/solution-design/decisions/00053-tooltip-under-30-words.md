---
id: "00053"
title: "a tooltip is clear, concise and under 30 words"
status: accepted
date: 2026-09-15
tags: ["ui", "tooltip", "repo"]
components: ["dashboard"]
paths: []
symbols: ["Tooltip", "title"]
triggers: ["tooltip", "hover text", "title attribute", "word count", "dynamic value", "long tooltip"]
supersedes: []
superseded_by: []
---

# 00053 — a tooltip is clear, concise and under 30 words

**Decision:** every tooltip on a user-facing surface — app `Tooltip` title or platform equivalent — is clear, concise and **under 30 words**. Dynamic values (file name, path, count) do not count; authored words do. A tooltip states what the control does and its main consequence. Longer help belongs in the adjacent panel.

## Refactor notes

Implemented in Dashboard by 00060. The word-count rule and the single-system rule both hold.
