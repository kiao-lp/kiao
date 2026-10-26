# The file tree

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The **File tree** is a toolbar tab
([`files/nav-bar/fileNavigationTab.tsx`](../../src/cms-core/files/nav-bar/fileNavigationTab.tsx)).
It defaults to the left column, which starts hidden. The banner's left switch reveals it.
The Show menu can move it to either side column or a central area, or hide it.
Choosing a placement also switches that side on.

All panel areas are vertical. `placementOf` in
[`barsModel.ts`](../../src/cms-core/tool-bars/barsModel.ts) falls back to
the tab's default when a saved arrangement names a removed bar. Unregistered tabs are ignored.

The tree shows the whole store
([`files/nav-bar/FileTree-cmp.tsx`](../../src/cms-core/files/nav-bar/FileTree-cmp.tsx)):
folders open in place under their expander, which browses without navigating, while clicking a row
opens it as anywhere else. Branches are read one folder at a time on the way in, re-read each time
one is opened, and the set of open ones is remembered across sessions; the open folder itself is
never fetched — its listing is the file browser's, taken as-is so a creation or a deletion reaches
the tree at the same moment it reaches the browser. Wherever browsing lands, the tree opens down
to it and centres its row — **once per document**, and only for a row the pane was not already
showing whole: a branch the hand opens afterwards changes the shape of the tree, and clicking a row
is a navigation like any other, so in both cases the pane stays where it was put.

**A file operation reaches every folder it changed, not only the browsed one.** Each row of the
tree carries the file browser's whole context menu — New, Rename, Delete, Paste into folder — so
the folder that changes is as likely as not to be one the browser is not on, and the browsed
folder's listing says nothing about it. `useRefreshFileList`, which every mutation already calls,
is therefore two signals rather than one ([`files/core/CurrentFileList-ctx.tsx`](../../src/cms-core/files/core/CurrentFileList-ctx.tsx)):
it re-reads the browsed folder, and it bumps a **store revision** that tells whatever else draws
the store from its own listings to read them again. The tree reads that revision and re-reads the
branches it is showing — the ones both open and already read, the browsed one excepted since it
arrives from the browser. A listing that comes back unchanged never reaches React, so the branches
nothing happened to do not redraw, and the rows keep their offsets. The same pass runs on mount,
where it is what keeps a tree that outlives its pane fresh.

A listing also supersedes what it replaces: `withListing` drops the branches the folder has stopped
holding, so a folder deleted with its branch open cannot leave its children behind to be drawn
again under the next folder created with the same name.

Asking for it is the other way back: the crosshair in the pane's header — an IDE's "select opened
file" — opens the way down to the open document again, even if the branch holding it was closed by
hand, and centres its row. The request stands until that row is drawn, since reopening a branch
means reading it. The refresh and locate controls sit outside the scroller, so both stay in reach
at any depth. New files and folders can be created from a tree row's context menu or the folder
browser's New button.

The pane is not the tree's owner. Every plugin main view brings its own `<LayoutContent>`, so
opening a document of another type takes the pane down and mounts a new one; what it draws — the
listings read so far and where it was scrolled — is held above it, for the life of the app
([`files/nav-bar/NavTreeStore-ctx.tsx`](../../src/cms-core/files/nav-bar/NavTreeStore-ctx.tsx)). The new
pane therefore draws the same tree, at the same offset, on its first frame, and re-reads what it
shows in place rather than walking back down from the root a listing at a time.
