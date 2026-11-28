---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Reordering (`src/core/ui-foundation/reorder/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

`ReorderableList` supplies the rows, grip and drop indicator for vertical lists. Each caller renders the row contents, places and labels the grip, and applies `onMove(from, to)` to its data. `moveInArray` moves an item between those indices.

- Bookmarks keep open notes and edit state with the moved entry.
- Tags keep their colour control and name field, with rows keyed by label.
- Sub-templates move within the collection, below the fixed root, in both the template file and task description editors.
- Exclusive gateway routes move in evaluation order and disable their grips in read-only mode.

Mouse, pen and touch use pointer events. During a drag, the row dims in place and an insertion line marks the target gap. Arrow keys move one place, Home and End go to either end, and Escape cancels a drag. Focus follows the moved grip. Single-item lists disable the grip.

For tables and compound layouts, `useReorderable({ count, onMove })` exposes `rowProps(index, className)` and `handleProps(index)` for a `ReorderHandle`. Import from `@kiao-dashboard-core`. `@kiao-dashboard-kit/reorder` remains a compatibility alias.
