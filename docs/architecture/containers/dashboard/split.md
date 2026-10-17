# A divided centre (`src/cms-core/split/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The columns around the document are dragged wider from their outer edge; so is every division of
the document's own area. `<SplitRow>` is that row: it takes its parts left to right, draws the
same 4-pixel handle between each two of them, and hands each part the width the reader dragged it
to. Two rows use it today — the markdown source beside its preview
([`kit/MarkdownEditor/MarkdownEditorBody.tsx`](../../../../exchange/dashboard/src/kit/MarkdownEditor/MarkdownEditorBody.tsx)) and
a document beside the side documents shown with it (see [Side documents](../../../../exchange/dashboard/ARCHITECTURE.md#side-documents-srccms-coreside-documents)) — and they nest, since the first is
drawn inside the host part of the second.

**A part is a share, not a width.** A column is remembered in pixels because it is furniture of the
window; a part is remembered as a *weight* (`flex-grow`), because what the reader chose is a
proportion of whatever room the document has been left with. The proportion survives what a pixel
width would not: the window resized, a column widened beside it, a pane opened next to it, the same
store reopened on another screen. Dragging a handle shares out the two parts it touches and leaves
every other part exactly as wide as it was — the arithmetic is
[`splitModel.ts`](../../../../exchange/dashboard/src/cms-core/split/splitModel.ts), which knows nothing of React. A drag never
takes a part below `MIN_PART_SIZE`, so there is always an edge left to bring it back by.

**The shares are app-wide**, like the columns' widths and for the same reason: how the centre is
divided describes the screen being worked on, not the file open on it. Each row stores its own
(`useGlobalViewState('split:<row id>')`), so two rows on screen never write over one another.

A part is otherwise the caller's own box — its class, its style, its `ref`, its `onScroll`, its
`data-` attributes are passed straight through, and the row adds only how wide it is. A part may
declare itself `collapsed`: it stays mounted, gives its width up entirely and takes no handle,
which is what the markdown host does when both its panes are switched off.
