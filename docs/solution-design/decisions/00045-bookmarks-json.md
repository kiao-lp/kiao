---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-21
tags: ["dashboard", "bookmarks", "store"]
triggers: ["bookmark note render", "edit bookmark", "percent-encoded link", "old bookmarks.md", "rendered note", "bookmark", "kept at hand", "panel list", "bookmark identity", "link out of store", "title", "link", "note"]
supersedes: []
superseded_by: []
---

# 00045 — Bookmarks are ordered JSON entries with title, link and note.

## Context and Problem Statement

Bookmarks need independently editable titles, targets and rendered notes, and must travel
and be versioned beside their referenced documents. Markdown sections do not separate those fields.

## Considered Options

* Store an ordered JSON list of title, link and note entries.
* Represent bookmarks through Markdown section syntax.

## Decision Outcome

Chosen option: "Store an ordered JSON list of title, link and note entries", because
separate fields support those edits in an ordinary store document.

`kiao-user-config/bookmarks.json` contains a hand-ordered list of `{ title, link, note }`
without IDs. The resolved target is identity, so raw and percent-encoded links name the same
bookmark. External links open in their own tab. The panel re-reads on view to follow edits
made elsewhere.

The panel writes percent-encoded links and accepts either spelling. JSON link fixing
handles raw spaces and parentheses.

## More Information

The former Markdown shape was converted in the
[retired migration history](/migrations/cutover-2026-10-20.md).
