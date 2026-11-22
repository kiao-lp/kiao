---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-25
tags: ["dashboard", "ui", "zoom"]
triggers: ["magnifier", "double-click", "readable size", "fixed positioning", "transform ancestor", "clipped element", "core/ui-foundation/zoom", "magnify.ts", "zoomable", "zoom-magnifier.spec.ts"]
supersedes: []
superseded_by: []
---

# 00010 — Double-click magnifies element with zoom and placeholder.

## Context and Problem Statement

Magnification must render readable text without moving neighbors or remaining clipped by
the original container. `transform: scale` stretches the small render rather than reflowing it.

## Considered Options

* Magnify with CSS `zoom`, fixed positioning and a placeholder.
* Scale with `transform: scale`.

## Decision Outcome

Chosen option: "Magnify with CSS `zoom`, fixed positioning and a placeholder", because zoom
reflows and rasterizes content at the larger size while the placeholder preserves its space.

`core/ui-foundation/zoom/` supplies one app-wide magnifier. Double-click on
`[data-zoomable], .code-block-wrapper` magnifies the nearest matching element; a slider
sets its size. Escape or a second double-click restores it. At 100%, it returns to the
flow while remaining selected. Fenced Markdown blocks participate; other elements opt in
through `zoomable`.

Chat prose runs between tool calls are separate targets, and an inner diagram magnifies
alone. `position: fixed` preserves neighbors. The banner band remains outside the
magnified area so the slider stays accessible; oversized content scrolls internally.

### Confirmation

`zoom-magnifier.spec.ts` guards ancestor `transform`, including identity animation fills,
which establish a containing block and can re-clip fixed descendants. `magnify.ts`
measures offsets rather than assuming browser scaling.
