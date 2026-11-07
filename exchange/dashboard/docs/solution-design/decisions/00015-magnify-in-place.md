---
id: "00015"
title: "an element is magnified in place, with `zoom` and a placeholder"
status: accepted
date: 2026-08-25
tags: ["dashboard", "ui", "zoom"]
components: ["dashboard"]
paths: []
symbols: ["cms-core/ui-foundation/zoom", "magnify.ts", "zoomable", "zoom-magnifier.spec.ts"]
triggers: ["magnifier", "double-click", "readable size", "fixed positioning", "transform ancestor", "clipped element"]
supersedes: []
superseded_by: []
---

# 00015 — an element is magnified in place, with `zoom` and a placeholder

**Decision:** `cms-core/ui-foundation/zoom/` is one app-wide magnifier. Double-clicking an element matching `[data-zoomable], .code-block-wrapper` opens it magnified; a slider adjusts the size; Escape or a second double-click restores it. At 100% the element returns to the flow, still selected. The magnified element uses `position: fixed` and `zoom`; a placeholder holds the box it left. Fenced Markdown blocks are targets. Other elements opt in with the `zoomable` prop object.

The nearest match wins. A chat reply marks each prose run between tool calls separately. A diagram inside prose magnifies alone.

`zoom` reflows content at the larger size and rasterizes text at read size. `transform: scale` stretches the small render. Fixed positioning floats the element without moving neighbors or staying clipped. The banner band is excluded so the element never covers its own slider. Content too large for the remaining area scrolls internally.

Trap: any `transform` on an ancestor, including an identity transform from an animation fill, makes it the containing block for `fixed` descendants and re-clips the magnified element. `magnify.ts` measures offsets instead of assuming browser scaling. `zoom-magnifier.spec.ts` guards this.
