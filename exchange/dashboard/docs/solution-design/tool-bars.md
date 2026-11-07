---
status: DRAFT
role: PRIMARY_SOURCE
---

# Tool bars (`src/cms-core/dashboard-ui/toolbars/`)

Part of the [Dashboard solution design](README.md).

Dashboard has left and right columns around **one to three central areas**. Registered tabs
can move between areas through the banner's **Show** menu. Placement belongs to the open
document; window visibility and sizing are app-wide.

## Placement and controls

The [document tab](../../src/cms-core/dashboard-ui/documents/DocumentPanel.tsx) leads the first central strip
and cannot move or close. Other tabs can share that area, allowing a narrow screen to use
one column with a tab chooser.

[ShowMenu](../../src/cms-core/dashboard-ui/top-banner/ShowMenu.tsx) lists every tab except the pinned
Document tab. Its [layout grid](../../src/cms-core/dashboard-ui/toolbars/LayoutGrid-cmp.tsx) shows the
current placement:

- Click another rectangle to move or restore the tab and reveal that area.
- Click its current rectangle to remove the tab; removed tabs appear dimmed in the menu.
- Use **Central areas** to change the count. Panels from removed areas move to the first
  central area. Invalid saved placements fall back to the tab's default.

A strip appears when an area has multiple tabs or its active tab has controls. Tabs are on
the left; `additionalPanels` controls are on the right. Document controls come from
`LayoutContent.additionalPanels`; application controls belong in `TopBanner`.

Empty areas are omitted. A tab mounts on first visit. The Document tab mounts immediately,
even when another tab is active, so its editor and stack followers do not depend on a visit.

## Visibility and sizing

[BarToggle](../../src/cms-core/dashboard-ui/top-banner/BarToggle.tsx) places visibility switches before
the tools menu: left, first central area, second central area when configured, and right.
An empty side column has a disabled switch. Hiding an area preserves mounted content,
placements, configured count and split proportions; visible areas share the freed width.
Showing a tab or opening a secondary document reveals its area.

Side columns resize from their outer edges. Restored widths are clamped inside the viewport,
including the handle, so they can always be narrowed. Central areas fill the remaining space.

## Persistence and navigation

| State | Scope |
| --- | --- |
| Tab placement and explicit tab choice | Per document |
| Area visibility, central-area count and side widths | Global |
| Split proportions | Global, per split row |

Unarranged documents use tab defaults. `activeTabIn` derives the active tab without writing
state on open; a central area with no explicit choice shows the document.

Opening a file or pushing a document-hosted stack panel brings Document forward. A tab the
user selects afterward stays selected. Panels hosted by another central tab remain there.
See [view state](view-state.md) and [central stacks](central-area.md).

[`barsModel.ts`](../../src/cms-core/dashboard-ui/toolbars/barsModel.ts) owns the pure placement rules for menus, layout and tests. Placements name bars, not sides. Vertically stacked bars are not implemented. Side widths stay shared.
