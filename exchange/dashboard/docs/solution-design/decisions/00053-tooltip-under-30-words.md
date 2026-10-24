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

**Decision:** every tooltip on every user-facing surface of this tree — an
`antd` `Tooltip` title, a native `title` attribute, or the platform's equivalent —
is clear, concise and **under 30 words**. Dynamic values a tooltip carries (a file
name, a path, a count) are not counted; the authored words around them are.
Dashboard is fixed as of this decision; a new tooltip is written to it from the
start.

**Why:** a tooltip is read with the pointer held still over its control — a
paragraph there is a paragraph nobody finishes. The long ones were cut to what
the control needs: what it does, and the one consequence of pressing it.
Anything longer belongs in the panel beside the control, not in a hover.

## Refactor notes

Implemented in Dashboard by 00060 (app Tooltip, still second). Both hold: the word-count rule and the single system.
