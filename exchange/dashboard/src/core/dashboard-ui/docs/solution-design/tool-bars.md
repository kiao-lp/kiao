---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Tool bars (`src/core/dashboard-ui/toolbars/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Dashboard has left and right columns around **one or two central areas**. Registered tabs
can move between areas through the banner's **Show** menu. Placement, selection, visibility
and sizing are global for each screen size.

Each tab declares its ID, title, icon, placement and rendering options. Load panel data
on first reveal rather than on mount: document layouts remount bars, and a never-opened
tab should not cause requests.

Git, Boards, Bookmarks and Usage (quotas) default to the left area. Decisions defaults
to the first central area. Saved placements take precedence over these defaults.

## Placement and controls

The [document tab](../../documents/DocumentPanel.tsx) is pinned at the start
of the first central strip. Other tabs can share that area, allowing a narrow screen to use
one column with a tab chooser.

[ShowMenu](../../top-banner/ShowMenu.tsx) lists movable tabs.
Its [layout grid](../../toolbars/LayoutGrid-cmp.tsx) shows the
current placement:

- Click another rectangle to move or restore the tab and reveal that area.
- Click its current rectangle to remove the tab; removed tabs appear dimmed in the menu.
- Use the second central area's banner switch to add or remove it. Its panels move to the
  first area when it is removed. Invalid saved placements fall back to the tab's default.

A strip appears when an area has multiple tabs or its active tab has controls. Tabs are on
the left; `additionalPanels` controls are on the right. Document controls come from
`LayoutContent.additionalPanels`; application controls belong in `TopBanner`.

Empty areas are omitted. A tab mounts on first visit. The Document tab mounts immediately,
even when another tab is active, so its editor and stack followers do not depend on a visit.

## Visibility and sizing

[BarToggle](../../top-banner/BarToggle.tsx) places switches before
the tools menu: left, second central area and right. The first central area stays visible.
An empty side column has a disabled switch. Hiding a side column preserves its placements
and width; visible areas share the freed space. Central split proportions survive closing
and reopening the second area. Showing a tab or opening a secondary document reveals its area.

Side columns resize from their outer edges. Restored widths are clamped inside the viewport,
including the handle, so they can always be narrowed. Central areas fill the remaining space.

## Persistence and navigation

| State | Scope |
| --- | --- |
| Tab placement and explicit tab choice | Global |
| Area visibility, central-area count and side widths | Global |
| Split proportions | Global, per split row |

Tabs without a saved placement use their defaults. `activeTabIn` derives the active tab from
the saved choice and available tabs, with the pinned document tab leading each central area.
All global state uses the view-state document selected for the screen size.

Opening a file or folder URL selects Document once per navigation, on first load and on links
to the current document alike. A panel route selects its declared tab. Other areas retain their
selection and visibility. Placement stays global across documents. Pushing a document-hosted
stack panel brings Document forward. Panels hosted by another central tab remain there.
See [view state](../../../view-state/docs/solution-design/view-state.md) and [central stacks](central-area.md).

[`barsModel.ts`](../../toolbars/barsModel.ts) owns the pure placement rules
for menus, layout and tests. Placements identify bars. Widths belong to sides.
