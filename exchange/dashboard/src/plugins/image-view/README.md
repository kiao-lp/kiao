---
status: DRAFT
role: PRIMARY_SOURCE
---

# image-view

Displays an image with previous/next navigation and deletion within its folder.

## The gallery

`gallery.ts` computes order, neighbors and the destination after deletion as pure functions.
`useGallery.ts` connects it to the browser's existing `useCurrentFileListContext`; no duplicate
folder request or separate watch is needed. File operations refresh that shared listing.

Deletion uses `deleteBatch`, including link repair. Compute the next destination **before**
deleting, while the listing still contains the current image.

## The controls

`GalleryControls.tsx` places previous, count, next and Delete in the document tab strip.
The main view registers ←, → and Delete; folder-browser shortcuts are inactive while an image
is open.

Register those keys once and read current gallery state through a ref. The hotkey registry
snapshots enabled keys only when registration changes, so gating registration on a newly
loaded neighbor creates a transient dead shortcut. At a gallery boundary the arrow is a no-op,
matching its disabled button.
