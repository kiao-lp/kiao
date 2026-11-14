---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-07
tags: ["dashboard", "layout", "view-state", "panels"]
triggers: ["toolbar persistence", "screen-size layout", "tab selection", "global preferences", "new panel", "panel placement", "Show menu", "column on/off", "FileNavigationBarCmp", "stacked bars", "global.toolBars", "normalizeViewState", "ToolBarsProvider", "DocumentPanel"]
supersedes: []
superseded_by: []
---

# 00064 — Panels are toolbar tabs; placement and selection are global per size.

## Context and Problem Statement

Panel registration and Show need one contract. Workspace arrangement belongs to a screen
size across documents, while plugin modes and pane settings belong to individual files.

## Considered Options

* Represent panels as toolbar tabs and store placement and selection globally per screen size.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Represent panels as toolbar tabs and store placement and selection globally per screen size",
because panel controls share registration and workspace preferences follow the reader across documents.

Dashboard provides left, central and right areas; Document is pinned to the first central
area. In **Show**, choosing another area moves a tab; choosing its current area removes it.
Empty areas are hidden, strips appear from two tabs, and the banner toggles columns.
Placement names a bar, and removal of a bar restores a tab's default placement.

`global.toolBars` stores placement, selection, visibility and sizing. Desktop and small
screens use separate [view-state documents](/docs/solution-design/decisions/00011-small-screen-view-state.md).
File entries retain plugin mode, pane visibility and zoom.

File or folder URLs select Document; panel routes and explicit panel actions select their
host tab once. Other areas retain selection and visibility.

## More Information

See [tool bars](../../../src/core/dashboard-ui/docs/solution-design/tool-bars.md) and
[view state](../../../src/core/view-state/docs/solution-design/view-state.md).
