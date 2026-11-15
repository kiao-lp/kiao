---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-08
tags: ["upload", "staging", "review", "worker", "dashboard"]
triggers: ["upload folder", "review upload", "safe import", "unsafe import", "sweep", "git-ignored upload", "subsidiary", "POST /staging", "DELETE /staging", "/moveBatch", "/reindex", "/listRecursive"]
supersedes: []
superseded_by: []
---

# 00030 — Uploads staged hidden for review before store entry.

## Context and Problem Statement

Uploaded folders can contain documents whose contents the owner has not inspected.
Direct upload makes Git, navigation and link fixing treat them as accepted store documents
before review; existing search conversions can make them readable first.

## Considered Options

* Upload into hidden staging, convert and review before importing.
* Upload directly into the browsed store folder and sort afterward.

## Decision Outcome

Chosen option: "Upload into hidden staging, convert and review before importing", because
the owner can inspect readable content before the store has anything to undo.

`POST /staging` creates `.kiao-uploads/u-<clock>-<rand>`. The browser uploads there,
calls `/reindex`, and displays the uploaded tree beside converted text. Converted files
receive an explicit **Delete** or **Import** choice, with neither selected by default.

**Cancel** discards the area. **Safe import** becomes available once every converted file
has a choice; red **Unsafe import** is available immediately without another confirmation.
Both execute the same import and include undecided files. Files without an index do not
require a choice because no readable content was shown.

Import uses `/moveBatch` to move files into the browsed folder, with indexes and other
subsidiaries following their main file. Deleted files remain in staging until discard.
The uploader combines its known paths with the index paths returned by `/reindex`;
`/listRecursive` is unsuitable because it caps at 500 entries and hides subsidiaries.

Ordinary file endpoints read and manipulate staging. Listings hide `.kiao-uploads`
itself but can list an area directly. A seeded `.gitignore` containing `*` excludes it
from Git; the next upload sweeps areas older than a day. Seeded dot-name exclusions in
`.kiao-files` keep automatic passes out while an explicitly targeted reindex still works.

`DELETE /staging` accepts only a directory minted by `POST /staging`, refusing the
parent staging folder and deeper paths. It performs no link fix because those paths
were never exposed as store references.
