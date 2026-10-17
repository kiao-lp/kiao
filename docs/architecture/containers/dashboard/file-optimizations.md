# File optimizations (`src/cms-core/file-optimizations/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

What the store is carrying that it need not be, opened by the **File optimizations…** entry of the
tools dropdown: the files stored more than once, and the biggest ones.

**It is an application mode, not a tool bar tab** — like the Git diff and unlike the configuration
panel. Two things say so. What it draws is two wide tables, one of them with two columns of radios
in every row, and none of that survives being folded into 300 pixels of column. And what it is
*about* is the store rather than the open document, so there is nothing for it to sit beside.
`LayoutContent` therefore pushes it onto the central area's stack, reading one flag held above the
layout ([`FileOptimizations-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/file-optimizations/FileOptimizations-ctx.tsx))
for the same reason the diff target is held there: the menu that opens it is in the top banner and
the view that answers is in the middle of the app. The last one opened is on top, and closing it
comes back to the other — or to the document or board underneath, which a mode swapped in for the
whole application could not do once a page was showing.

**The scan is the server's** (`GET /fileOptimizations`, worker `internal/files/optimize.go`).
Identity is size *then content*: files are grouped by size and only a group of two or more is hashed,
which is what makes the pass affordable and also why a group is exact rather than a hash collision
away from wrong — every file in one has been read. It honours the store's `.kiao-files`, so a
dependency tree is neither walked nor reported. It is asked **once when the view
opens**, and after that only by Re-scan or by a consolidation, which invalidates the answer that
suggested it ([`useFileOptimizations.ts`](../../../../exchange/dashboard/src/cms-core/file-optimizations/useFileOptimizations.ts)).

**A location and a name, chosen separately.** The server says these files are the same bytes; it does
not say which one to keep, because that is not a question about the bytes. So each group offers a
radio for the location and a radio for the name, and what is kept is the two put together — the good
name is very often on the copy that is in the wrong folder, and a model that only let a whole row be
picked would force a rename afterwards for the ordinary case. It follows that the radios are over
**distinct folders and distinct names**, not over rows: two copies in one folder are one location,
and choosing it on either lights both, which is something true about the store rather than a display
trick. Nothing is chosen by default and the button is disabled until both halves are — a destructive
button's whole guard is that it was aimed on purpose. The rules are pure functions in
[`duplicatesModel.ts`](../../../../exchange/dashboard/src/cms-core/file-optimizations/duplicatesModel.ts), which the tab, the
confirmation and the tests all read the same answers from.

**Keeping one is a move, not a delete** (`POST /deduplicate`). Every copy is moved onto the chosen
path, so the link fixer repoints every reference to a copy that goes at the one that stays instead of
leaving a link into nothing — which is the difference between a hygiene tool and a way to break a
store full of documents. The server re-hashes before it touches anything and refuses `409` when the
files are no longer identical or when the chosen path has since been taken by a stranger; that
sentence is what the tab shows, because it is the only thing the reader can act on.

**The big-files tab offers no button**, and that is deliberate. What to do about a 400 MB video — move
it out, re-encode it, leave it — is not a question with one answer, so the tab's whole job is to say
which files they are, with a bar per row against the largest: a store whose top ten are all the same
size has a different problem from one with a single outlier.
