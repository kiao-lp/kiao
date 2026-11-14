---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-21
tags: ["dashboard", "hybridflow", "panels", "routing"]
triggers: ["board panel", "board replaces document", "panel route", "AppRouteDeclaration.panel", "AppRouteView", "BoardPanel", "BOARD_TAB_ID", "BOARDS_TAB_ID"]
supersedes: []
superseded_by: []
---

# 00057 — Boards have toolbar panel separate from documents.

## Context and Problem Statement

Board work, node drafts and documents need to stay mounted while the user switches between
them. Board routes should select their panel without discarding document work.

## Considered Options

* Give the board its own toolbar panel beside the Document panel.
* Render a board page in place of the document.

## Decision Outcome

Chosen option: "Give the board its own toolbar panel beside the Document panel", because
separate mounted views preserve work through navigation and placement changes.

The canvas is the **Board** toolbar tab, central by default and movable through Show;
files stay in **Document**. Board state, drafts and controls live above both.

`/boards/<handle>` selects its board and `/boards` its list.
`AppRouteDeclaration.panel` names the tab selected once on navigation while its renderer
runs beside the document. Other areas keep selection and visibility. Routes without
`panel` replace the document with a page.

Canvas template forms use Board's stack; document search results and Git diffs use the
document stack.
