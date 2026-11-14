---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The file tree

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

The [File tree tab](../../nav-bar/fileNavigationTab.tsx) defaults to the
left column, initially hidden. The banner switch reveals it; Show can move or hide it.
Placement follows [tool bar rules](../../../dashboard-ui/docs/solution-design/tool-bars.md), including fallback for removed bars and
ignoring unregistered tabs.

## Reading and reveal

[FileTree](../../nav-bar/FileTree-cmp.tsx) browses the whole store.
Expanders open folders without navigating; row clicks open the file or folder. Branches load
one folder at a time and reread whenever opened. Open branches persist across sessions.
The current folder reuses the browser's listing, keeping creations and deletions synchronized.

Navigation expands the path and centers its row once per document, only if the row is not
already fully visible. Later manual expansion and row clicks retain the scroll position.
The header's crosshair explicitly reveals the current document again; the request remains
pending until any required branch reads finish and the row is drawn. Refresh and locate stay
outside the scroller.

## Refresh after mutations

Every row offers the browser context menu, including creation, rename, delete and paste.
A mutation may affect a folder other than the one currently browsed.
[useRefreshFileList](../../core/CurrentFileList-ctx.tsx) therefore both
reloads the current listing and increments a **store revision**.

The tree responds by rereading branches that are open and already loaded, except the current
folder supplied by the browser. It does the same on mount. Unchanged listings do not reach React,
preserving row offsets. `withListing` removes cached descendants absent from a replacement
listing, preventing deleted branches from reappearing under a reused folder name.

## Lifetime

[NavTreeStore](../../nav-bar/NavTreeStore-ctx.tsx) owns cached listings and
scroll position for the app's lifetime. Switching document types replaces `LayoutContent` and
the tree pane, but the new pane draws that cache at the same offset immediately, then refreshes
in place rather than loading from the root again.
