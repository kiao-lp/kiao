---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-26
tags: ["dashboard", "layout", "mobile", "worker"]
triggers: ["phone layout", "small screen", "768px", "columns closed on desktop", "user-agent sniffing", "dashboard-view-state.json", "dashboard-view-state-small.json", "viewStateDocFor", "files/configdocs.go"]
supersedes: []
superseded_by: []
---

# 00011 — View state chosen by viewport width, documents separate.

## Context and Problem Statement

Phone and desktop visits overwrite each other's column visibility, sizes and selected
tabs when they share one layout document. State selection must agree with the CSS breakpoint.

## Considered Options

* Select a separate view-state document by viewport width at load.
* Share one view-state document across viewport sizes.
* Detect the device or touch capabilities.
* Switch the state document during resizing.

## Decision Outcome

Chosen option: "Select a separate view-state document by viewport width at load", because
each screen size keeps its layout without reseeding mounted panes during a resize.

`viewStateDocFor` selects `dashboard-view-state.json` above 768 px and
`dashboard-view-state-small.json` at 768 px or below; both are allow-listed in
`files/configdocs.go`. Width, rather than user-agent or touch detection, also covers
a narrow desktop window consistently with CSS.

The provider chooses on mount and keeps that document for the session. The next load
selects again. Document shape, per-file keys, debounce and re-read-before-write merging
remain the same, applied independently to each document.
