---
id: "00016"
title: "every panel is a tool bar tab the document places, not a fixture of the layout"
status: accepted
date: 2026-08-26
tags: ["dashboard", "layout", "panels"]
components: ["dashboard"]
paths: []
symbols: ["dashboard-view-state.json", "LayoutContent", "TopBanner", "BARS", "toolBars"]
triggers: ["new panel", "panel placement", "Show menu", "column on/off", "FileNavigationBarCmp", "stacked bars"]
supersedes: []
superseded_by: []
---

# 00016 — every panel is a tool bar tab the document places, not a fixture of the layout

**Decision:** Dashboard has left, central and right panel areas. The open document is pinned to the first central area. Every other panel is a **tab** the user places in any area or removes from the layout. Placement is chosen in the **Show** menu: clicking another area moves the tab; clicking its current area removes it. A strip shows from two tabs on. An empty area is not drawn. Each column toggles via the banner.

Tab placement is per document in `dashboard-view-state.json`. Unarranged documents inherit the last arrangement app-wide. Column visibility and width are app-wide. A saved placement in a removed bar falls back to the tab default. `render` receives the occupied bar.

Placement names a *bar*, not a side, and `BARS` is a list. A column width belongs to the side. This supports stacked bars without other changes. Stacked bars are not built.
