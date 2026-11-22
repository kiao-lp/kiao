---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Reordering (`src/core/ui-foundation/reorder/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Ordered lists reorder by **dragging a row's grip**. There are no up/down buttons. `useReorderable({ count, onMove })` returns `rowProps(index, className)` for the row and `handleProps(index)` for the `<ReorderHandle>` inside it. `onMove(from, to)` receives indices on the current list; `moveInArray` applies them.

The gesture uses pointer events, so touch reorders like a mouse. HTML5 drag-and-drop gives no insertion line on touch. Nothing moves until the drop: the dragged row dims in place, a line marks the target gap, and passed rows stay under the pointer. The grip is a button and the keyboard route: ↑ ↓ move one place, Home / End go to an end, Escape cancels the drag.

Used by unit contents and members, template sub-templates, the bookmarks panel and external projects.

Import from `@kiao-dashboard-core`; `@kiao-dashboard-kit/reorder` remains an alias to the same implementation.
