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

**Decision:** every tooltip on a control in `exchange/dashboard` and `exchange/dashboard-plugins` comes
from the app `Tooltip` (`cms-core/ui/Tooltip`, re-exported from `@cms-core`) — none from `antd`
directly, none from a native `title`, none from custom CSS. The inventory it replaced: five files
importing `Tooltip` from `antd` (`BoardsList`, `MlexToolbar`, `MLToolbar`, `UnitConfigControls`,
`UnitExportPanel`), the hand-rolled CSS tooltips of the archdia and diagram-shared toolbars (deleted
with their styles), and the sixty-odd native `title` attributes on controls, converted one by one.
**Why:** four systems meant four timings, four placements and four looks for the same sentence — and
a tooltip that opens the instant the pointer passes over its target is read in flashes on the way to
somewhere else, which is reading it nowhere.

**The popup opens on a still second.** The pointer must rest on its target for one second
(`TOOLTIP_STILL_SECONDS`, overridable per call through `mouseEnterDelay`), and every move restarts
the countdown — which is what makes it a stillness rather than a fuse. Ant Design's own
`mouseEnterDelay` is a single fuse lit on entry, so the countdown lives in the wrapper: the popup is
driven controlled, Ant Design reports the hover promptly underneath, and a document-wide `mousemove`
listener restarts the countdown while it is pending. A caller driving `open` itself, asking for a
non-hover trigger, or passing `mouseEnterDelay={0}` gets Ant Design untouched.

**The wrapper is ready for markdown.** It already takes a `markdown` prop, shown as plain text today;
the follow-up renders it as rich text without touching the call sites, and `title` wins when both
are given.

**Three things stay outside the system, deliberately.** A native `title` still shows the full text of
a truncated label (a file row, a path, a conversation) — that is a reveal, not help on a control.
The `title` props of antd's Modal, Card and Alert are headings, not tooltips. And the markdown
descriptions inside archdia diagrams stay in-SVG `foreignObject` popups, positioned in canvas
coordinates no DOM popup can follow.

**One rule for the next conversion:** a native disabled element fires no mouse events, so it must not
sit in a `Tooltip` directly — it is wrapped in a span when disabled, and the span carries the hover
(the thinking toggle, the layout-grid cell, the reorder grip).

## Refactor notes

Implements the repo word-count rule (00053) in Dashboard. TODO: confirm whether the markdown-rendering follow-up for the `markdown` prop landed.
