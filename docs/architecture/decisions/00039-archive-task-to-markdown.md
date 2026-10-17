---
id: "00039"
title: "an archived task is a dated markdown file beside the board"
status: accepted
date: 2026-09-04
tags: ["hybridflow", "archive", "board"]
components: ["dashboard"]
paths: []
symbols: ["toStoreName", "archive/"]
triggers: ["delete card", "archive", "tidy board", "Done column", "chat cleanup", "name taken"]
supersedes: []
superseded_by: []
---

# 00039 — an archived task is a dated markdown file beside the board

**Decision:** a card leaves the board one of two ways. **Delete** throws it away, as it always did.
**Archive** writes it out first — as markdown, in an `archive` folder beside the board's own
document, named for the day it was archived on and the task
(`backlog/archive/2026-09-04 Write the plan.md`) — and takes the card off only once that file has
landed. Both then ask the same question about the task's chat, where the card was the last thing on
the board naming one.

**Why: tidying a board and losing its record were the same press.** A board is kept readable by
taking work that is over off it, and Delete was the only gesture that did that — while a `done` card
is the one place the description that was asked, the log of what came back and the column it was
filed under are written down. Keeping them meant keeping the card, so boards grew a `Done` column
nobody read and cards nobody dared delete. Archiving separates the two questions: is this off the
board, and is this worth keeping.

**It is an ordinary file of the store and not a document type.** No `docType`, no id, nothing points
at it and nothing reads it back — it is markdown for a person, copied, moved, committed, searched and
rendered like any other file, and readable on GitHub or in an IDE with nothing installed. That is
what an archive has to be: it outlives the board, the plugin and probably the format. The store's own
naming rule applies (`toStoreName`), the date leads so a folder of them sorts into the order the work
ended in, and a name already taken is never written over — the second card of a title archived on one
day is `… (2)`.

**The order is the whole of the safety.** The document is the only copy of a card until the file is
on disk, so the write comes first and a failure leaves the card exactly where it was. Nothing is
taken off the board for a file that was never written.

**The `chat` is not written into it.** It is an id naming a conversation of *this* instance — the
same reason it never travels on the clipboard — and an archive is a text meant to still read in a
year, in another store. What the conversation said that is worth keeping is in the log, which is the
half of it written for a person. Whether the conversation itself goes is asked after the card is off
the board, by the question both gestures share.
