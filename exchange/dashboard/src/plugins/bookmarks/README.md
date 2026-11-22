---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Bookmarks

The Bookmarks panel keeps a flat, ordered list in `kiao-user-config/bookmarks.json`:

```json
[
  {
    "title": "Document guide",
    "link": "/docs/guide.md",
    "note": "Use this as a starting point."
  }
]
```

Each entry has a title, link and Markdown note. This ordinary store file versions with the documents. Refresh flushes pending writes before rereading. The reader accepts JSON only.

## What it claims

The manifest omits `fileConfigFor`; `code-edit` opens the JSON file. The plugin contributes
a toolbar tab and an app-lifetime provider. The provider loads on first use and preserves
the list and pending edits when navigation replaces a document's layout.

## Files

| File | Role |
| --- | --- |
| `index.tsx` | Manifest, tab and provider |
| `bookmarksFile.ts` | Parsing, serialization and store links |
| `Bookmarks-ctx.tsx` | List and debounced persistence |
| `BookmarksPanel.tsx` | Star, reorder controls and expandable notes |

## The order

Drag a row by its grip, or focus the grip and use ↑, ↓, Home or End. The
[reorder controls](../../core/ui-foundation/reorder/) update array order, preserve expanded rows and keep
the caret in an edited note. Editing array order in JSON has the same effect.

## The star

The star toggles a bookmark for the current document or folder, using its name as the title.
Membership compares the decoded destination path: encoded spaces and heading fragments
do not make separate bookmarks. External URLs open in another browser tab.

## Opening a row

The caret expands a Markdown note. The pencil opens separate title, link and note fields,
which autosave; Delete removes the entry. A broken link remains editable so it can be
repaired. Expanded rows are remembered in view state across navigation and reloads.
