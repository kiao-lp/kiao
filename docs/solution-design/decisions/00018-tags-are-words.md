---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-31
tags: ["hybridflow", "tags", "store", "dashboard", "worker"]
triggers: ["new tag", "tag colour", "rename tag", "grey tag", "tag picker", "paste across instances", "shared/color/ink.ts", "workflow_doc.go"]
supersedes: []
superseded_by: []
---

# 00018 — Tags are words on documents; store maps colours.

## Context and Problem Statement

Boards must be hand-writable and tags must retain their meaning across KIAO installations.
A tag ID requires another document lookup and names nothing in a different store; tag words
remain readable to both people and an agent filing a card.

## Considered Options

* Store tag words on documents and colors in a store catalogue.
* Store IDs referencing the tag catalogue.
* Rewrite every document when a catalogue label is renamed.

## Decision Outcome

Chosen option: "Store tag words on documents and colors in a store catalogue", because
documents remain readable and portable independently of the source store's catalogue.

`kiao-user-config/tags.json` is a flat list of `{ "label", "color" }`. Documents carry words,
for example `"tags": ["bug", "ui"]` on a board task. Unknown words display in neutral grey.
Unlike a conversation reference, a tag travels with a copied board or column.

Typing a new word in a document's tag picker adds it to the catalogue with the first unused
color. The `Tags` toolbar panel colors, renames, reorders and removes entries. An app-level
provider serves both that panel and board cards, whose lifetimes differ.

Colors are hex values rather than the activity log's theme-dependent palette slots. Chips
carry their own fill and black or white ink, calculated from luminance by
`shared/color/ink.ts`, shared with the activity log. The picker offers the eight validated
hues first.

### Consequences

* Bad, because renaming a catalogue entry leaves existing documents with the old word,
  displayed grey. Restoring that entry restores their color. IDs would provide automatic
  rename, but at the cost of document independence; rewriting all documents on each
  keystroke would require a store-wide pass honoring `.kiao-files` and confirmation.

## More Information

Worker attaches no tag semantics. `workflow_doc.go` preserves `tags` through run writes
in Dashboard's field order so playback does not discard an unfamiliar field.
