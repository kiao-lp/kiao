---
id: "00022"
title: "a task board is chains of tasks, not columns that get played"
status: accepted
date: 2026-08-27
tags: ["hybridflow", "chains", "board"]
components: ["dashboard", "worker"]
paths: []
symbols: ["onSuccess", "usePlayTask", "PlayColumnButton"]
triggers: ["column play", "move right", "Done column", "chain across columns", "chat field", "delete conversation"]
supersedes: ["00019", "00021"]
superseded_by: ["00051"]
---

# 00022 — a task board is chains of tasks, not columns that get played

**Decision:** the column stops being anything a play looks at. A task carries a `status`
(`ready` / `done` / `error`) and a `chat` (the conversation it is played in), and `onSuccess` — now
`{ task, chat: "continue" | "compact" | "end" }` — is the **only** thing that says what runs after
what. The column play, its header button, `PlayColumnButton` and the move-to-the-next-column that a
finished task used to make are gone; `usePlayColumn` is `usePlayTask`, started on a card and
following the chain from there, across columns.

**Why: a column was two things at once.** It was where the user filed a card, and it was how far the
play had got — the board took a column from its top card down and sent each finished task to the
column on its right, making a `Done` column when there was none. So a board whose columns were
projects, or weeks, or people was a board the play rearranged behind the user's back, and the only
boards it left alone were the ones whose columns were already a pipeline. A `status` says the same
thing without touching where the card is, and the column goes back to being a place to put a card.

**And the order was in two places.** A column said what came next by rank; `onSuccess` said it by
name, for the tasks that wanted one chat. Two mechanisms for one question, one of which was invisible
on the board. Keeping the chain and dropping the queue leaves one, written on the card that starts
it and shown on its face.

**A chat is now the task's, not the loop's.** It is written onto the task the moment the conversation
exists — before the prompt goes out — so a running task is one the user can open, and a task played
again goes back into the chat it was played in before. Handing the chat to the next task of a chain
is a field written on *that* task rather than a variable the loop holds, which is what makes a chain
stopped halfway and restarted from its second card land in the same conversation. The third value,
`end`, is what a chain says when the next task deserves a clean chat: it is also the only way a chain
crosses folders, a conversation keeping the one it was made in.

**What it cost.** A conversation now outlives every play, and nothing on the board would ever have
deleted one — so deleting the last card naming a chat asks whether the chat goes too (`useTaskDelete`),
in a second dialog rather than a third button. The card had to grow a line for where things stand, and
its Play had to become the play's Stop: the column header was where Stop lived, and it no longer has
anything to stop.

## Refactor notes

`continue` now forks the chat per card (00051).
