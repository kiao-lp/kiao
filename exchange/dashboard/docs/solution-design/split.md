---
status: DRAFT
role: PRIMARY_SOURCE
---

# A divided centre (`src/cms-core/ui-foundation/layout/`)

Part of the [Dashboard solution design](README.md).

`SplitRow` arranges parts horizontally with **4 px drag handles**. It hosts Markdown source
and preview, and the document beside a [secondary document](README.md#secondary-document-srccms-coresecondary-document).
Rows may nest.

Parts store relative weights (`flex-grow`), so proportions survive viewport and side-column
changes. Dragging changes only the two adjacent weights and enforces `MIN_PART_SIZE`, leaving
each part reachable. [splitModel.ts](../../src/cms-core/ui-foundation/layout/splitModel.ts) owns the arithmetic.

The reusable row accepts local or controlled weights. Dashboard's
[adapter](../../src/cms-core/dashboard-ui/preferences/PersistentSplitRow.tsx) makes weights global per row
through `useGlobalViewState('split:<row id>')`; side-column widths
are stored separately in pixels. Each part retains the caller's class, style, ref, scroll
handler and data attributes. A `collapsed` part stays mounted but uses no width or handle,
as when both Markdown panes are hidden.
