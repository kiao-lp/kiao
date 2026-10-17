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

**Decision:** the navigation tree answers a **reveal request** — a store path left in a small
app-level context (`files/nav-bar/RevealInTree-ctx`) — as well as following the open document on its
own. Anything naming a document puts the same crosshair beside it (`RevealInTreeButton`, the glyph
the pane's own "Show the open document" already used): every link into the store in rendered
markdown, and the folder written on a task. Clicking it brings the Files tab forward and shows the
row, with a fading mark on it, and **opens nothing**.

**Why.** The document one wants to place is very often not the one on screen. Following a link
answers *what is in it*, never *where it sits* — and one usually wants where it sits precisely in
order not to leave the page. The tree already knew how to go to a row; all it was missing was
somebody other than the pane being able to ask.

**Why a request left in a context rather than a call into the tree.** The two ends do not meet. The
asking happens in a document, a panel, a plugin; the tree is mounted and unmounted with every pane it
is drawn in, since each plugin main view brings its own `<LayoutContent>`. And the click that asks may
be the one that brings the pane up, the button switching the Files tab on before it asks — so the
request *waits* until a tree takes it. It is taken **once**, and cleared as it is taken: a request
still standing at the next remount would pull a fresh pane away from the document it was mounted to
show. The pane's own crosshair keeps its counter (`revealRequest`), being a request the pane makes of
its own tree; both end up as the one pending row.

**The way down, and no further.** A reveal opens the branches down to the folder *holding* the row,
never the row's own: opening it would be browsing into it, which being shown where something is does
not ask for. The request stands until the row is drawn, a reopened branch taking a listing or two to
be read.

**Where the crosshair comes from beside a link.** `markdown-renderer` gained one prop,
`linkAdornment(href)`, drawn beside the anchor and never inside it; a `prefix::id` link, which belongs
to a plugin's own renderer, never reaches it. The renderer stays ignorant of the store — Dashboard
supplies the adornment in `ConfiguredMarkdown` and decides there that only a link resolving to a
store path gets one (`storePathOf`). The buttons a render puts on screen are now stripped from
*Copy as HTML* as they already were from the PDF: there is nothing to press in an email.

**Not every render is a page being read**, and `revealLinkTargets={false}` is how one says so. A
**mindmap note** is the case: a label on a canvas, sized to its own text and dragged by the hand
that would otherwise have to reach past a button to grab it, in a document read as a shape rather
than as prose. The link stays — a note pointing at a document of the store is one of the things a
map is for; what goes is the glyph beside it.
