# The markdown preview's size

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The preview beside the markdown source is read at a size of its own, chosen from a select in the
top banner ([`kit/MarkdownEditor/MarkdownEditorToolbar.tsx`](../../../../exchange/dashboard/src/kit/MarkdownEditor/MarkdownEditorToolbar.tsx))
and remembered per file with the panes around it, like the mindmap's and the PDF's. It is in the
bar rather than over the pane because the pane is the document being read: a floating control would
cover the text, and a column of its own would take from the width that is the point of zooming.

`zoom` does the resizing, on a box *inside* the scroller rather than on the pane: the document is
laid out again at the size it is read at — text rasterised crisp, a diagram drawn from its geometry,
tables re-wrapped — while the pane keeps the column the layout gave it and goes on scrolling in
screen pixels. Only the preview is resized; the source pane keeps the editor's own size, because
what is zoomed is the document as it will be read, not the text being typed.

Laying a document out again moves every offset in it, so no pixel and no fraction of the content
survives the change. What is held across it is the block at the top of the pane
([`previewAnchor.ts`](../../../../exchange/dashboard/src/kit/MarkdownEditor/previewAnchor.ts)), put back where it was once the
new size has settled — the passage being read is still the passage on screen.

**A pane at any setting but 100% is a zoom the magnifier has to read.** An element magnified out of
it is measured on screen and written back in the units of the flow it left, and those differ by
exactly that setting: taken for 1, the element would be laid out wider than it was, the space held
open behind it would be larger than the space it took, and the caps keeping it inside the window
would read as more window than there is. `magnify` measures it instead (`currentCSSZoom`, or the
ratio between the two boxes where the browser does not state it).
