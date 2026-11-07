---
id: "00060"
title: "one tooltip system in Dashboard: the app Tooltip, on a still second"
status: accepted
date: 2026-09-19
tags: ["dashboard", "tooltip", "ui"]
components: ["dashboard"]
paths: ["exchange/dashboard/src/cms-core/ui"]
symbols: ["TOOLTIP_STILL_SECONDS", "mouseEnterDelay", "markdown", "Tooltip"]
triggers: ["antd Tooltip", "title attribute", "CSS tooltip", "flash tooltip", "disabled element tooltip", "truncated label", "archdia popup"]
supersedes: []
superseded_by: []
---

# 00060 — one tooltip system in Dashboard: the app Tooltip, on a still second

**Decision:** every control tooltip in `exchange/dashboard` uses the app `Tooltip` (`cms-core/ui-foundation/feedback/Tooltip`, re-exported from `@cms-core`). No direct `antd` tooltip, native `title` or custom CSS tooltip on controls.

The popup opens after one still second (`TOOLTIP_STILL_SECONDS`, per-call `mouseEnterDelay`). Every pointer move restarts the countdown. The wrapper drives the popup controlled: Ant Design reports hover promptly; a document `mousemove` listener restarts the pending countdown. A caller driving `open`, using a non-hover trigger or passing `mouseEnterDelay={0}` gets Ant Design behavior.

The wrapper accepts a `markdown` prop. `title` wins when both are given.

Outside the system: native `title` revealing truncated text (file row, path, conversation); antd Modal/Card/Alert `title` headings; in-SVG diagram descriptions in canvas coordinates.

A disabled element fires no mouse events. It is wrapped in a `span` inside the tooltip; the span carries the hover.

## Refactor notes

Implements the word-count rule (00053) in Dashboard.
