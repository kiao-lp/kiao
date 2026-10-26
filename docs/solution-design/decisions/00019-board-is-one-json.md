---
id: "00019"
title: "a task board is one `.workflow.json` document, not a folder of `.tasks.md` columns"
status: accepted
date: 2026-08-26
tags: ["hybridflow", "board", "format"]
components: ["dashboard", "worker"]
paths: []
symbols: ["KiaoWorkflow", ".workflow.json", "fileConfigFor", "folderViewFor", "V002__tasks-boards-to-workflow.js"]
triggers: ["board format", "column order", "task identity", "paste board", "clipboard", "nextColumnTitle"]
supersedes: []
superseded_by: ["00022", "00029", "00059"]
---

# 00019 — a task board is one `.workflow.json` document, not a folder of `.tasks.md` columns

**Decision:** a board is a single JSON document — `docType: KiaoWorkflow`, `content.columns[]`, each
column a `tasks[]`, each column and each task carrying a UUID of its own. `tasks-board` claims the
file through `fileConfigFor` like every other editor, and the `folderViewFor` hook it was the only
user of is gone from `CmsPlugin`, along with the file browser's `board` view mode.
`migrations/V002__tasks-boards-to-workflow.js` converts a store that still has the old
shape, minting the ids the old one never had.

**Why: a task had no identity.** It was the text sitting at a rank in a markdown file. A turn runs
for minutes with the board live throughout, so the play loop had to find its own task again
afterwards by comparing whole section texts and falling back to titles — and a card dragged
meanwhile could still take the answer written for the one below it. An id makes that a lookup, and
makes a paste, a panel and a running play able to name the same task without agreeing on when they
last read the board.

**And a task could not hold a heading.** A `#` or a `##` in a body ended the section it was in and
started a task of its own, so the panel and the large editor both carried a CodeMirror guard that
demoted what was typed as it was typed, every filed answer was pushed down to `###` first, and a
task that wanted to *show* markdown headings had to fence them. A body is a JSON string: all of that
went, guard included.

**And the board was a folder.** The column order was the alphabetical order of the file names, so
renaming a column was renaming a file, moving one was renaming it to sort elsewhere, and the column
a played task lands in had to be *named* to sort after the one it leaves (`nextColumnTitle`, five
cases). Adding and removing columns are now list operations, and the play appends a `Done` when it
has nowhere to put a finished task.

**Settings are fields, not a fenced YAML block under the heading.** The block only counted where it
sat: a line typed above it pushed it into the body, where it was somebody's YAML and the task
quietly stopped being played — which is why a template could only ever be inserted at the end, and
why the lead a card shows had to be computed around it. The four keys are unchanged, and so is the
rule that a task naming a model but no effort, no permission mode or no folder is not played.

**Copy and paste as JSON, because the other end is another instance.** Two boards in two stores have
no server in common, so a task or a column worth carrying over travels on the system clipboard, in
the document's own shape, wrapped in one line naming what it is. Reading is forgiving — a bare
object is accepted, so JSON a turn produced can be pasted straight onto a board — and **a paste
always mints new ids**: the copy is of what a task is, never of which task it is, and a clipboard is
a thing that pastes twice. **A cut is that copy and then the cards off the board**, in that order:
the write can be refused outright by the browser, so the cards leave only once the clipboard has
them, and a refused write leaves the board whole.

**What it cost.** The document is read and written whole, on the board's own debounce, so an edit
made to the file while the board is open on it is still overwritten — the same rule as before, with
one file instead of four. *(Since 2026-08-31 it is not: see below.)* And a board can no longer be
edited as markdown from one click away, which is what `.tasks.md` gave for free; the panel, the
large editor and the `taskboard` skill are the three ways in.

## Refactor notes

Column play removed (00022); concurrent-write rule replaced by merge (00029); columns dropped from editor/store/wire (00059). One-JSON-document shape and UUID identity still hold.
