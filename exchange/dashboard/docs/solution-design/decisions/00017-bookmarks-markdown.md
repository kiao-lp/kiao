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

**Decision:** the documents kept at hand live in `kiao-user-config/bookmarks.md`, one
`### [name](link)` section per bookmark with the note under it, read and written by the bookmarks
tool bar tab. **Why:** the two kinds of state DCMS keeps are already split — what describes the
*window* (which column is on, where the caret was, the feature flags) is a configuration document
in the worker state directory, out of the file tree and out of `git status`; what the user
*wrote* is a document of the store. A bookmark is the second kind: it has a name somebody chose and
a note somebody wrote, it belongs in the commit beside what it points at, and it is worth opening
as markdown — which is exactly what happens, `markdown-edit` claiming the file like any other.
That is also why the panel has a refresh and re-reads the file whenever it is looked at, rather
than holding a copy for the session: the file is one click away from being edited elsewhere.

**A flat list, and the link is the record.** No index, no id, no sidecar, and no categories: the
order is the order of the sections, and a bookmark's identity is the link on its heading line. What
is bookmarked is decided on the *path that link resolves to*, so `/a/10%20To%20Test.md` and
`/a/10 To Test.md` are one document and a link to a heading of one is a link to it. A link out of
the store is left alone and opened in a tab of its own.

**One rank down from a task.** A bookmark is a `###` section whose note may hold `####` and deeper,
exactly as a task then was a `##` section whose body could hold `###` and deeper — same fence-aware
reading, same demotion of a heading that would end the section it is written in, same guard inside
the CodeMirror transaction so the caret is not thrown away. That machinery is
`shared/markdown/sections.ts` with the rank as its parameter, written once for the two rather than
as the same eighty lines of subtle parsing twice. The board has since stopped needing it — a task is
a field of a JSON document now, see below — so `bookmarks` is its only caller, and the parameter is
what would let the next one in.

## Refactor notes

Storage shape replaced by 00061 (JSON, V015). The list rules — flat, hand-ordered, no id, link identity — still hold.
