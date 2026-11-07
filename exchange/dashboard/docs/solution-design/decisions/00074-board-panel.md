---
id: "00074"
title: "boards have a toolbar panel separate from documents"
status: accepted
date: 2026-10-21
tags: ["dashboard", "hybridflow", "panels", "routing"]
components: ["dashboard"]
paths: ["exchange/dashboard/src/cms-core/app-routes", "exchange/dashboard/src/plugins/hybridflow-ui"]
symbols: ["AppRouteDeclaration.panel", "AppRouteView", "BoardPanel", "BOARD_TAB_ID"]
triggers: ["board panel", "board replaces document", "panel route", "expanded node editor"]
supersedes: []
superseded_by: []
---

# 00074 — boards have a toolbar panel separate from documents

**Decision:** the board canvas is the **Board** toolbar tab, central by default and movable via Show. The **Document** tab holds files. Board state, node drafts and controls live above both panels, so opening a document or moving the board keeps that work.

`/boards/<handle>` selects a board and reveals its panel. `/boards` shows the full list there; the **Boards** tab is the compact browser. A route names a tab in `AppRouteDeclaration.panel`: its renderer runs beside the mounted document and navigation reveals the tab once. Routes without `panel` render a page in place of the document.

Expanded node editors and template forms from the canvas use a stack inside the Board panel. Expanding from the Node tab reveals Board. Document search results and Git diffs keep the document stack.

Separate panels let board and document stay mounted and switchable. Neither replaces the other.
