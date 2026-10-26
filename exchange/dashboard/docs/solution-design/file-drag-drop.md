# Dragging a file out of the store (`src/cms-core/files/dnd/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A row of the tree, of the folder table or of the grid is **dragged out** to say *this file* to
something that is not the store: it always could be dropped on a folder to move it there, and it is
now also dropped into a box that wants a path.

One module writes the drag and reads it back
([`files/dnd/dragPaths.ts`](../../src/cms-core/files/dnd/dragPaths.ts)). Two flavours ride on it:
`application/x-kiao-paths`, the store paths, which is what a folder row reads to move them; and
`application/x-kiao-folders`, naming which of those are folders — the paths alone do not say, and a
target that means one thing by a file and another by a folder has to know. `text/plain` goes along
for the world outside the app and is never read back, a paragraph dragged out of a web page being
no file of the store. The drag allows **both effects**: a folder row takes the drop as a move, and
a text box as a copy.

Five places take that drop today, through
[`files/dnd/markdownLinkDrop.ts`](../../src/cms-core/files/dnd/markdownLinkDrop.ts),
[`files/dnd/useFileDrop.ts`](../../src/cms-core/files/dnd/useFileDrop.ts) or the payload directly:

| Where | What the drop means |
| --- | --- |
| A flow node's **folder box** (`plugins/hybridflow-ui`) | The folder the turn runs in — the dropped folder, or the folder holding the dropped file. `/` for the store root. |
| A template's **`file` variable** (`@cms-kit/template-fields`) | The file itself: `${doc:file}` is its path from the store root, `${doc:file.name}` its name. |
| A flow node's **description**, panel and modal alike | A markdown link, at the drop point. CodeMirror's side is the `markdownLinkDrop` extension. |
| The **message box** of a chat, and its expanded twin | The same link, at the caret. Distinct from a dropped *file*, which is an attachment: that drag carries `Files`, this one carries the store's own paths. |
| A mindmap's **rich-text area** | A markdown link, at the drop point. |

The first two are the same box twice — a text field that a path is dropped into rather than typed
into — so what they share is a hook: `useFileDrop` marks the box while a drag of ours is over it,
hands over the first entry of the drop, and leaves every other drag to the browser. What each makes
of that entry is all that differs.

The link is `storedLinkOf`'s — bare, root-relative, percent-encoded (see **Internal links**) — so
what is dropped reads and navigates like every other link written in this CMS. A `file` variable is
the one place a path is written **unescaped**: it is as likely to end up in a sentence handed to an
agent as inside a markdown link.

`dragover` is where a target says whether it will take the drop, and it is the one event that may
not read the drag; `holdsDraggedFiles` therefore asks the *types* rather than the data. A target
that says nothing there gets no drop at all.

Dragging is off on a coarse pointer, in the tree as in the browser: the press that would start a
drag is the one that opens the row's menu.
