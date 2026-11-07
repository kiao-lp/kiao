---
id: "00017"
title: "bookmarks are a document of the store, not a configuration document"
status: accepted
date: 2026-08-26
tags: ["dashboard", "bookmarks", "store"]
components: ["dashboard"]
paths: ["kiao-user-config/bookmarks.md"]
symbols: ["shared/markdown/sections.ts"]
triggers: ["bookmark", "kept at hand", "panel list", "bookmark identity", "link out of store"]
supersedes: []
superseded_by: ["00061"]
---

# 00017 — bookmarks are a document of the store, not a configuration document

**Decision:** bookmarks live in a store document read and written by the bookmarks tab. Bookmarks are user content: they carry names and notes, commit beside their targets and open as ordinary documents. The panel re-reads the file on view because the file is editable elsewhere.

The list is flat. Order is section order. Identity is the resolved link target: `/a/10%20To%20Test.md` and `/a/10 To Test.md` are one document. External links open outside the store.

## Refactor notes

Storage shape is superseded by 00061 (JSON, V015). List rules hold: flat, hand-ordered, no id, link identity.
