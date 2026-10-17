---
id: "00061"
title: "a bookmark is an entry of a JSON file, not a markdown section"
status: accepted
date: 2026-09-21
tags: ["dashboard", "bookmarks", "store"]
components: ["dashboard", "migrations"]
paths: ["kiao-user-config/bookmarks.json"]
symbols: ["V015", "title", "link", "note"]
triggers: ["bookmark note render", "edit bookmark", "percent-encoded link", "old bookmarks.md", "rendered note"]
supersedes: ["00017"]
superseded_by: []
---

# 00061 — a bookmark is an entry of a JSON file, not a markdown section

**Decision:** the documents kept at hand live in `kiao-user-config/bookmarks.json`, one
`{ title, link, note }` entry per bookmark, and the markdown file of `### [title](link)` sections
is gone — migration `V015` carries those over on the next deploy, and nothing reads the old shape
any more. **Why:** a bookmark was the last document of the store still read as sections of
markdown, and the shape was fighting the panel: the title and the link shared one heading line,
so editing either meant editing the raw section text, and the note was source-or-nothing. Three
fields are three boxes, and a note that is a field is shown rendered — a row opens on it like a
folder of the file tree, closed until it is opened. What the decision of 2026-08-26 said about the
list still holds: flat, ordered by hand, no id, the path the link resolves to deciding what is
bookmarked, a link out of the store opening in a tab of its own.

**The link fixer already speaks the new shape.** It scans `.json` too, and what it writes back into
a JSON string is the path as it reads — a string ends at its quote, so unlike a markdown
destination it takes spaces and parentheses raw. The panel goes on writing the percent-encoded form
for a bookmark it makes, and reads either form back.
