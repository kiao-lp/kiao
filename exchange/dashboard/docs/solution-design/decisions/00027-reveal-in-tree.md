---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-07
tags: ["dashboard", "navigation", "links"]
triggers: ["reveal", "crosshair", "locate file", "show in tree", "where it sits", "mindmap label", "RevealInTree-ctx", "RevealInTreeButton", "linkAdornment", "storePathOf", "revealLinkTargets", "ConfiguredMarkdown", "Copy as HTML"]
supersedes: []
superseded_by: []
---

# 00027 — Any store path revealed in tree without opening.

## Context and Problem Statement

A document reference needs to reveal its tree location without replacing the open document.
Requests may arrive before the tree or target row renders.

## Considered Options

* Route reveal requests through app-level context to the file tree.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Route reveal requests through app-level context to the file tree", because
references can request navigation independently of the tree's rendering lifecycle.

`files/nav-bar/RevealInTree-ctx` holds a store-path request until a tree consumes and clears
it. The tree follows the open document and handles both this request and the pane crosshair's
`revealRequest` counter as one pending row. It opens branches to the containing folder,
waits for the row to render, brings Files forward and applies a fading mark; it opens
neither the document nor branches inside the target. Consumed requests do not recur on remount.

Elements naming documents show `RevealInTreeButton`.
`markdown-renderer` accepts `linkAdornment(href)`; `ConfiguredMarkdown` supplies it only
for store paths resolved through `storePathOf`. Copy as HTML and PDF strip these buttons.
Non-page renders such as mindmap notes use `revealLinkTargets={false}`, keeping links
without adornments.
