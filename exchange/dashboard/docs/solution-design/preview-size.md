---
status: DRAFT
role: PRIMARY_SOURCE
---

# The markdown preview's size

Part of the [Dashboard solution design](README.md).

The [Markdown toolbar](../../src/kit/MarkdownEditor/MarkdownEditorToolbar.tsx) selects a
preview size remembered per file. The control stays in the document tab strip so it does
not cover the text or consume preview width.

CSS `zoom` applies to a box **inside** the scroller. Text, diagrams and tables reflow at the
chosen size while the pane keeps its allocated width and scrolls in screen pixels. Source
editor text keeps its own size.

Reflow invalidates pixel offsets and scroll fractions.
[previewAnchor.ts](../../src/kit/MarkdownEditor/previewAnchor.ts) restores the block at the
top of the pane after zoom, keeping the passage being read in view.

The element magnifier must account for the pane's CSS zoom when converting screen measurements
to layout units. It uses `currentCSSZoom`, or the ratio between measured boxes as a fallback.
Assuming a factor of 1 would enlarge the placeholder and miscalculate viewport limits.
