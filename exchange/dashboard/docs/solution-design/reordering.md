# Reordering (`src/kit/reorder/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A list whose order is part of its meaning is reordered by **dragging a row's grip**, never by
up/down buttons: a row moves to where it belongs in one gesture instead of one press per place.
`useReorderable({ count, onMove })` returns `rowProps(index, className)` for the row and
`handleProps(index)` for the `<ReorderHandle>` inside it; `onMove(from, to)` receives indices
on the list as it stands, and `moveInArray` applies them.

The gesture is built on pointer events, so a finger reorders like a mouse — HTML5 drag-and-drop
is dead on touch and its drop feedback cannot be turned into an insertion line. Nothing in the
list moves until the drop: the dragged row dims in place while a line marks the gap it is aimed
at, so the rows it travels past never slide out from under the pointer. The grip is a real
button, which is also the keyboard route — ↑ ↓ move one place, Home / End go to an end — and
Escape abandons a drag in flight.

Used by the unit's contents chain and members, the template editor's sub-templates and the
bookmarks panel — and by dropped-in projects outside the lot, for their own lists.
