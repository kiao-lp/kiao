# The file navigators

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Browsing the store is **two tabs like any other**
([`files/nav-bar/fileNavigationTab.tsx`](../../../../exchange/dashboard/src/cms-core/files/nav-bar/fileNavigationTab.tsx)) — the
**file line** across the top and the **file tree** down a column. It used to be one tab that asked
the bar it was in which way to lay itself out, which made the two ways of browsing exclusive: a tab
is in one bar at a time, so putting the tree down a column took the line off the top. They are the
same subject but not the same tool — the line is the open folder, the tree is the whole store — and
wanting both at once is ordinary, so each is its own tab, placed and taken away on its own.

Each names the one **orientation** it draws itself in, and that is what says where it may go: the
line is horizontal, so the top bar and nowhere else; the tree is vertical, so either column and
nowhere else. `barsFor`/`acceptsPlacement` in [`barsModel.ts`](../../../../exchange/dashboard/src/cms-core/tool-bars/barsModel.ts)
are the rule, the Show menu draws the rectangles it forbids faint and disabled rather than leaving
them out — the picture has to stay the picture of the app — and `placementOf` refuses an arrangement
naming a bar the tab cannot hold, so a state file written before the split cannot put a tree across
the top.

**What the app opens on is unchanged**: the line ships in the top bar, the tree ships in the left
column, and the left column ships switched off along with the right. The left switch at the end of
the banner is therefore what the tree is brought up and put away with, and the two show together as
soon as it is on. Choosing a rectangle in the Show menu switches its side on too, since putting a
panel somewhere is asking to see it there.

The line is the open folder's entries plus a `..` row, with files dropped past thirty entries so the
line stays readable. The tree is a pane, so it shows the
whole store as a browsable tree instead ([`files/nav-bar/FileTree-cmp.tsx`](../../../../exchange/dashboard/src/cms-core/files/nav-bar/FileTree-cmp.tsx)):
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
is therefore two signals rather than one ([`files/core/CurrentFileList-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/files/core/CurrentFileList-ctx.tsx)):
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
means reading it. The header sits outside the scroller, with the New button, so both stay in reach
at any depth of the tree.

The pane is not the tree's owner. Every plugin main view brings its own `<LayoutContent>`, so
opening a document of another type takes the pane down and mounts a new one; what it draws — the
listings read so far and where it was scrolled — is held above it, for the life of the app
([`files/nav-bar/NavTreeStore-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/files/nav-bar/NavTreeStore-ctx.tsx)). The new
pane therefore draws the same tree, at the same offset, on its first frame, and re-reads what it
shows in place rather than walking back down from the root a listing at a time.
