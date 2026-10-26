# bookmarks

The documents kept at hand, as a tool bar panel over one JSON file.

```json
[
  {
    "title": "The framing of a unit",
    "link": "/units/abc/cadre.md",
    "note": "the one to copy from."
  }
]
```

The file is **`kiao-user-config/bookmarks.json`** and there is nothing else: no index, no id, no
sidecar. A bookmark is one entry of it — a title, a link and a note, each its own field — the
order is the order of the entries, and the list is flat — there are no categories yet.

It is an ordinary store file, committed with the rest and one click away as JSON, which is why
the panel has a refresh: what was written there wins, and what the panel owes always leaves before
it reads.

It used to be a markdown file of `### [title](link)` sections (`bookmarks.md`); migration `V015`
carried those over, and nothing reads the old shape any more.

## What it claims

**Nothing.** `fileConfigFor` returns `null` for every file — `bookmarks.json` is JSON, and
`code-edit` edits it as such — so the plugin is one tool bar tab and the provider behind it,
like `claude`. The provider is app-level: the panel lives in a tool bar, which every navigation
between documents replaces, and a panel-owned list would be read again — and the note being typed
thrown away — on the way to the very document the user navigated to in order to bookmark it.

## Files

| File | Role |
| --- | --- |
| `index.tsx` | Manifest: the tab and the provider. |
| `bookmarksFile.ts` | The format: entries in, entries out, and the link a store path is written as. |
| `Bookmarks-ctx.tsx` | The list, and the debounced writes back to the store. |
| `BookmarksPanel.tsx` | The panel: the star, the list and its grips, and the note each row opens on. |

## The order

The list is ordered by hand: a row is **dragged by its grip** to where it belongs, and its entry
moves to that rank in the file. There is nothing else to update — the order *is* the order of the
entries, so a drop is one rewrite of the file and a hand edit of the file reorders the panel just
as well.

The gesture is [`@cms-kit/reorder`](../../kit/reorder/), like the unit's contents and the template
editor's sub-templates, so the grip is a real button and ↑ ↓ Home / End reorder from the keyboard
too. The rows open on their note follow their bookmark: `move` shifts the open ranks rather than
closing them, and a note being written keeps its caret while the list is rearranged around it.

## The star

It bookmarks whatever the browser is on — a document or a folder — under that document's own name,
and takes it back out when it is already there. That is the whole of what the panel does to the
list without being asked.

Whether the open document is in the list is decided on the **path the link points at**, not on the
text of the link: `/backlog/board/05%20Ready.tasks.md` and `/backlog/board/05 Ready.tasks.md` are
the same document, and a link to a heading of one is a link to it. A link that points outside the
store — an external URL, written by hand into the link box — points at no document of the store,
and opens in a tab of its own rather than replacing the app.

## Opening a row

A row opens like a folder of the file tree — the caret before its name — and is closed until it is
opened. What an open row shows is the note, rendered as markdown; the **✎** beside the name is the
way into the title, the link and the note themselves, each in its own box, written as they are
typed. The Delete button in that form throws the bookmark away, and so does starring the open
document again.

A bookmark that points nowhere still opens: its note is where the link is put back.

Which rows are open is kept in the view state, like the file tree's open branches: a note left
open is still open after a navigation, and after leaving the dashboard and coming back.
