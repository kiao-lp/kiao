# image-view

Shows a picture, and treats it as one of its folder's: the reader steps to the next or the previous
one without going back to the file browser, and throws away the one in front of them.

## The gallery

`gallery.ts` is the whole of the ordering, and is pure — the folder's pictures in the file
browser's own order, the two either side of the open one, and where the reader goes once it is
deleted. Nothing in it knows about React, which is why it is where the tests are.

`useGallery.ts` is the same thing wired to the app. Two decisions worth knowing:

- **The folder listing is the browser's own** (`useCurrentFileListContext`). A file's `currentPath`
  *is* its folder, so the listing is already on hand and no second request is made for it. It is
  also refreshed by every file operation the app runs, so a picture deleted from another pane stops
  being a neighbour here without this plugin watching anything.
- **A deletion goes through `deleteBatch`**, as the file browser's does — that is the request which
  also fixes the links pointing at what is going. Where the reader lands is read *before* the
  delete, since the listing it is read from no longer holds the file after.

## The controls

`GalleryControls.tsx` draws `◀ 2 / 7 ▶ │ 🗑` on the right of the document's tab strip.
Each has a keyboard equivalent — `←`, `→`, `Delete` —
registered by the main view. The file browser's own arrows and `Delete` are gated on a folder being
browsed, so they are out of the way while a picture is open.

The three keys are registered **once**, and read the gallery through a ref rather than closing over
it. cms-core's hotkey registry snapshots which keys are live and recomputes that snapshot only when
a registration changes, so a key gated on `gallery.next` would be dead in the window between the
render that learnt the folder's listing and the effect that re-registers on it — which a fast hand,
or a loaded machine, lands inside. So nothing is gated: an arrow at an end of the folder has nowhere
to go and does nothing, which is what its disabled button already says.
