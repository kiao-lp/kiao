---
id: "00015"
title: "an element is magnified in place, with `zoom` and a placeholder"
status: accepted
date: 2026-08-25
tags: ["dashboard", "ui", "zoom"]
components: ["dashboard"]
paths: []
symbols: ["cms-core/zoom", "magnify.ts", "zoomable", "zoom-magnifier.spec.ts"]
triggers: ["magnifier", "double-click", "readable size", "fixed positioning", "transform ancestor", "clipped element"]
supersedes: []
superseded_by: []
---

# 00015 — an element is magnified in place, with `zoom` and a placeholder

**Decision:** `cms-core/zoom/` is one app-wide magnifier rather than a feature of the chat that
asked for it. Double-clicking an element matching `[data-zoomable], .code-block-wrapper` selects it and opens it
at 120% — a double-click that gave back the same size would say nothing had happened — the top
banner grows a slider taking it anywhere from 90 to 150%, and Escape or a second double-click puts
it back. At exactly 100% it returns to the flow, still selected: there is nothing to float.
The element itself is styled — `position: fixed`, `zoom: <factor>`, its own border-box width pinned
— while a placeholder holds the exact box it left. Every fenced markdown block is a target already,
which is how each rendered diagram became one without `markdown-renderer` knowing this exists;
anything else marks itself with the exported `zoomable` prop object.

**What a target is, is a judgement about reading, and the nearest match wins.** A chat reply marks
each run of prose between two tool calls — and the last one after them all — rather than the turn
that holds them: what a reader wants larger is the passage in front of them, and magnifying the
whole turn would drag its tool chips and its earlier paragraphs along with it. A diagram inside such
a passage is nearer still, so double-clicking the picture magnifies the picture and double-clicking
the prose around it magnifies the prose.

**Why `zoom` and not `transform: scale`.** The point of magnifying is to read what is there. `zoom`
lays the content out again at the larger size, so text is rasterised at the size it is read at and a
diagram is drawn from its geometry; a transform stretches the picture that was drawn for the smaller
box. Layout under `zoom` is proportional, so pinning the width the element had keeps the original's
line breaks — the same picture, larger, and not a different one.

**Why `fixed` plus a placeholder.** Nothing behind the element may move. Fixed takes it out of the
flow, so it floats over its neighbours instead of pushing them, and it escapes whatever was clipping
it — a scrolling transcript, a preview pane. The placeholder gives that flow back the box it lost,
sized in pixels and carrying the element's own margins, so a flex or grid parent counts it as the
item that left. The banner's own band is excluded from the area a magnified element may use: it must
never cover the slider that shrinks it again. What is then too large for what is left scrolls inside
itself rather than off the window — which is why the `min-height` that keeps a stretched element
from collapsing is held under that ceiling, CSS resolving `min-height` after `max-height` and it
would otherwise win.

**The trap, and the one thing to know before reusing this.** An element carrying *any* transform —
including the identity one an entrance animation leaves behind under `animation-fill-mode: both` —
becomes the containing block of everything positioned `fixed` below it, which puts a magnified
element back inside the box it was trying to leave and lets that box clip it. `.claude-message` gave
up its filled-forwards transform for exactly this, and `zoom-magnifier.spec.ts` guards it in a
browser. Placement does not depend on that answer, though: `magnify.ts` measures where `left: 0`
lands and how far one unit of `left` moves the element, rather than assuming how a browser scales
the offsets set on a zoomed element.
