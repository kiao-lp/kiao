---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# UI foundation solution design

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).
The [code map](../../README.md) describes the reusable component groups.

| Design | Covers |
| --- | --- |
| [Split panes](split.md) | Weighted divisions, resizing and controlled state |
| [Row lists](row-lists.md) | Striping, state precedence and column widths |
| [Reordering](reordering.md) | Pointer and keyboard ordering through row grips |

## Zoomable editing surfaces

`ZoomSurface` scales the content and its layout together so scroll bounds follow the zoom.
Its outer element forwards the editor's ref and interaction handlers. `ZoomControl` displays
and changes the zoom. The host owns the value, any persisted settings and the scroll container.
Passing a change handler on the surface enables Ctrl/Cmd-wheel in ten-point steps.

- ArchDia and Graph use the SVG's intrinsic dimensions. Their file views have their own editor.
  This also covers ArchDia's Markdown editing dialog and the zoomable Graph embedded in Markdown,
  where the canvas is fitted to the column at 100%.
- Mindmaps size the surface from the notes and keep the document pane's scrolling and the map's
  keyboard shortcuts.
- The SVG editor uses the drawing's dimensions and places its text editor and context menu in
  the outer surface's coordinates.
- Hybridflow boards supply the logical size of the cards, workflows and links. Their tab strip
  supplies board-specific zoom levels.

## Decision records

- [00010 — magnification in place](../../../../../docs/solution-design/decisions/00010-magnify-in-place.md).
- [00038 — tooltip purpose and 16-word limit](../../../../../docs/solution-design/decisions/00038-tooltips-only-when-needed.md).
- [00044 — tooltip timing and shared component](../../../../../docs/solution-design/decisions/00044-tooltip-system-still-second.md).

The [shared decision index](/docs/solution-design/decisions/README.md) tracks IDs and supersession.
