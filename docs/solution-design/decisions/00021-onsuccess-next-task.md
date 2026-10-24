---
id: "00021"
title: "a task may name the task played after it, in the same chat"
status: accepted
date: 2026-08-26
tags: ["hybridflow", "chains", "board"]
components: ["dashboard", "worker"]
paths: []
symbols: ["onSuccess", "ClaudeRunner.run", "conversationId", "/compact"]
triggers: ["play order", "chain", "next task", "shared conversation", "compact", "folder mismatch"]
supersedes: []
superseded_by: ["00022", "00051"]
---

# 00021 — a task may name the task played after it, in the same chat

**Decision:** a board task carries an optional `onSuccess: { task, compact }` naming another task of
**the same column**. When its turn comes back an answer, that task is played next — **in the very
conversation this one was played in** — and `compact` sends `/compact` into the chat first. The
chain is followed by the card's Play as well as the column's; when it runs out, the play goes back
to the column's own order, from its top playable card. `ClaudeRunner.run` gained a second shape,
`{ conversationId }`, for a prompt into a conversation it already made.

**Why: a column is a queue, and a queue cannot say "this, and then that, knowing what the first one
found out".** The board had two shapes for a piece of work and neither is that one. Two cards give
the second task a chat of its own, which starts from nothing the first learned — the files it read,
the failure it diagnosed, the decision it took. One card is one turn, and a turn is the unit
everything here is built on: what moves right, what an answer is filed under, what is retried after
an overload, what a Stop ends. Collapsing two tasks into one to share a context costs all of that.
`onSuccess` is the third shape — two cards, two answers, two moves, one conversation.

**It names a task, not a rank, and the same column.** Everything on this board is keyed on ids, so a
chain survives every drag; and it names a card of the column being played because what it changes is
the order that column is played in. A chain that reached across the board would be a second board.

**One chat is one folder, and the play stops rather than guess.** A conversation is made for a
folder and keeps it, so a chained task naming another cannot be played in the chat it was handed.
Where a played turn writes is the one setting this board has never decided on the user's behalf —
the reason `folder` has no default at all — so a mismatch ends the play with a message instead of
running the task in the chat's folder. The other three are per-turn on the wire, so a chained task
states its own model, effort and permission mode.

**On success, and only on success.** A turn that came back an API error did not do the task; it
already stays in its column and is retried or gives up. The chain hangs off the same test as the
move right, so there is one notion of "done" and not two. A stopped turn ends the play as it always
did — the chain is not an argument against somebody pressing Stop.

**A chain ends, and says so.** It ends where the task names none, where the one it names has left
the board or is not playable, and where it comes back round to a task the chain has already played:
a board is a thing people edit, and a circle would be a play with no end. Each of those is a
message, because a chain configured and then not followed is otherwise a column that quietly played
in the ordinary order.

**Continuing a conversation cost the runner one fact.** It drove a *new* conversation every time,
and that was load-bearing: a fresh conversation has held no turn, so `runtime.turnId` becoming
non-null was our turn starting and could be nothing else. A run now records the turn the
conversation was on before its prompt went out, and waits for the id to *change* — `start` is the
only frame that mints one. It also puts the conversation back on screen, the panel being where
`manualLive`'s ten-second countdown runs.

**And worker stopped decorating bare slash commands.** Every prompt is given a footer naming
the working folder; `/compact` takes free text as its argument, so that footer arrived as the
instructions for the summary. A prompt that is one command and nothing else is now passed through
untouched — a command to the CLI rather than a message to the model.

**What it cost.** A compaction is a whole turn of somebody's quota spent on housekeeping, and one
that fails stops the play rather than being worked around: the chain asked for a shorter chat before
its next task. And a chain is a second thing that decides play order, so the card that starts one
says so on its face — an order nothing on the board shows is one nobody can predict.

## Refactor notes

Same-column restriction dropped (00022); `compact` bool split into compact box plus continue/end fork (00051).
