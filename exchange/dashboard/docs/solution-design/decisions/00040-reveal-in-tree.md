---
id: "00040"
title: "a document can be *placed* without being opened, and the tree is asked from anywhere"
status: accepted
date: 2026-09-07
tags: ["dashboard", "navigation", "links"]
components: ["dashboard"]
paths: []
symbols: ["RevealInTree-ctx", "RevealInTreeButton", "linkAdornment", "storePathOf", "revealLinkTargets", "ConfiguredMarkdown", "Copy as HTML"]
triggers: ["reveal", "crosshair", "locate file", "show in tree", "where it sits", "mindmap label"]
supersedes: []
superseded_by: []
---

# 00040 — a document can be *placed* without being opened, and the tree is asked from anywhere

**Decision:** the navigation tree answers reveal requests — a store path in an app-level context (`files/nav-bar/RevealInTree-ctx`) — and follows the open document. Any element naming a document shows a `RevealInTreeButton` (crosshair). Clicking brings the Files tab forward, shows the row with a fading mark and opens nothing.

The request waits in context until a tree consumes it, then clears. A standing request must not survive to the next remount. The pane crosshair keeps its own `revealRequest` counter; both end as one pending row. A reveal opens branches to the containing folder, never into the row itself. The request stands until the row renders.

`markdown-renderer` takes a `linkAdornment(href)` prop drawn beside the anchor. `ConfiguredMarkdown` supplies it only for links resolving to a store path (`storePathOf`). Adornment buttons are stripped from *Copy as HTML* and PDF output. Renders that are not pages set `revealLinkTargets={false}` (mindmap notes): the link stays, the button does not.
