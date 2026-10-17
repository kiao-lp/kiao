---
id: "00030"
title: "a tag is a word, and the store keeps its colour"
status: accepted
date: 2026-08-31
tags: ["hybridflow", "tags", "store"]
components: ["dashboard", "worker"]
paths: ["kiao-user-config/tags.json"]
symbols: ["shared/color/ink.ts", "workflow_doc.go"]
triggers: ["new tag", "tag colour", "rename tag", "grey tag", "tag picker", "paste across instances"]
supersedes: []
superseded_by: []
---

# 00030 — a tag is a word, and the store keeps its colour

**Decision:** the store's tags live in `kiao-user-config/tags.json` — a flat list of
`{ "label", "color" }`, managed from a `Tags` tool bar panel — and a document that carries tags
carries **the words themselves** (`"tags": ["bug", "ui"]` on a board's task), never ids pointing at
that file. A word the file does not name is still worn, in a neutral grey.

**Why not ids.** Ids are the right key for a task, a column and a conversation, and they are the
wrong one here, for four reasons that all say the same thing: the tag file is not where a tag is
*read*. A board must stay hand-writable; a Claude turn holding the `taskboard` skill must be able to
file a card without opening a second document; a column pasted into **another instance of KIAO**
must arrive meaning what it meant, and an id minted in this store names nothing in that one — which
is precisely why a `chat` never travels and a tag always does; and `"tags": ["bug"]` is a line a
person reads, while a uuid is a line a person looks up. Ids would buy exactly one thing, the free
rename, and the price is the document's self-sufficiency.

**What the rename costs, and why it is left costing it.** Editing a label in the panel renames the
*entry*: cards carrying the old word keep it and go grey. That is visible rather than silent, and
putting the word back restores every one of them at once. The alternative — rewriting every document
in the store on a keystroke in a text box — is a tree-wide pass with `.kiao-files` to honour and a
confirmation to ask, hung on the smallest control in the panel. Not worth it, and not asked for.

**The panel is not where tags are made.** A word typed into a document's own tag picker is added to
the list on the spot, with the first colour no tag holds. A tag that has to be declared before it can
be used is a tag nobody declares, and the store would stay empty. The panel is where they are then
coloured, renamed, reordered and thrown away — the same shape as the bookmarks panel, and an
app-level provider for one reason more: the list has two readers that never share a lifetime, a
tool bar tab and a board's cards.

**A hex, not a palette slot.** The activity log's project colours are slot *names* resolved per
theme, because its segments sit on a themed table row and each hue needs a different step light and
dark. A chip does not: it carries its own fill **and** its own ink — black or white, computed from
the fill's luminance — so one colour serves both themes. That computation is `shared/color/ink.ts`,
moved out of the activity log so the two places that let a user pick a colour and write on it share
one rule. The picker still offers the eight validated hues first.

**worker reads none of it.** `workflow_doc.go` carries `tags` through the rewrites a run
makes, in the field order Dashboard writes, because a field it did not know about would be a field
the play quietly deleted — and it means nothing there. The words are the board's, and their colours
are the store's.
