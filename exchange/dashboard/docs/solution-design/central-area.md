# The central area

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

[`LayoutContent`](../../src/cms-core/core/LayoutContent.tsx) draws
the row of left column, central area and right column. The middle of the row is a bar like the
other two, and what the open document — or the folder's listing, or a plugin's folder view — goes
in is its first tab, the **document panel**
([`core/DocumentPanel.tsx`](../../src/cms-core/core/DocumentPanel.tsx)): the app's shared scroller (see
*View state*), the corner the close cross floats over, and the panel the central area's stack is
pushed onto. The panel reads the layout's content from a context rather than capturing it in its
registration, so what the layout holds is what the tab shows. A plugin main view renders
`<LayoutContent>` with its editor inside and `<TopBanner/>` beside it; the banner floats to the very
top by CSS order, so the DOM order in the layout is the visual one.

It is **addressable**: the element is published through
[`DocumentArea-ctx.tsx`](../../src/cms-core/core/DocumentArea-ctx.tsx), and `useDocumentArea` hands it to
anyone under the layout — the tool bars included, which is what makes it useful. A dialog
belonging to what is *in* the area rather than to the application is rendered into it (antd's
`getContainer`) with its mask and wrapper placed absolutely, and then covers the document and
nothing else: the chrome around it stays visible and usable, including the panel the dialog was
opened from. The hook is `null`
outside the layout, where the caller should fall back to the window rather than not render.

The document panel carries a **stack**. [`CentralStack-ctx.tsx`](../../src/cms-core/core/CentralStack-ctx.tsx) is the
panels pushed over the document when a dialog would be the wrong thing — anything that has to be
**filled in to continue**, like `hybridflow-ui`'s template instantiation or its large flow node
editor, and the three application modes, the Git diff, the file-optimizations view and the file
search results, which the document panel follows onto the stack itself so they open over whatever
it is showing — a document, a board — and close back onto it. Each pushed panel fills the panel and carries the same
floating cross as a closing file; closing it is back on the panel below, state and all, and the ones
below stay mounted while they are buried. There is deliberately **no mask and no focus trap**: the
tool bars around the area stay usable while a panel is open — the file tree included, so a file
dragged out of it still lands where it is dropped — which a dialog cannot do.

Reach for the stack when the user works *in* the thing — a form whose answers become the next thing,
an editor opened over what it edits. Keep the confirmations as modals: deleting a file wants a yes
or a no, not a place to work in. The two rules of pushing:

- **Push by stable id** (`useCentralStack().push({ id, ... })`), from the document or from a tool
  bar — both are under the provider `LayoutContent` mounts. Pushing an id that is already there
  replaces it on top, so a button that stays on screen behind its own panel cannot pile it twice.
- **Close by id, from anywhere** — the floating cross the frame draws, or `close(id)` in code. The
  panel's `onClose` fires however it leaves, which is where the opener writes back the state the
  panel was showing. Read live content from a context rather than capturing it in the pushed
  element, so what is typed behind the panel is what the panel shows.

One stack per document panel: leaving the document empties it, the panels belonging to what was
showing rather than to the application. Pushing while another tab of the centre is showing brings
the document back in front with the panel — it covers the document, so that is where it is looked
at. (What "in front" means once several tabs share the centre is the tool bars' own rule — see
*Tool bars*.)
