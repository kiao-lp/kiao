---
id: "00033"
title: "a task is a box to write in and a log of what came back"
status: accepted
date: 2026-09-02
tags: ["hybridflow", "board", "prompt"]
components: ["dashboard", "worker"]
paths: []
symbols: ["body", "log", "quick box"]
triggers: ["description", "log", "replay", "follow-up question", "title as prompt", "empty card", "retry sends"]
supersedes: []
superseded_by: []
---

# 00033 — a task is a box to write in and a log of what came back

**Decision:** a task's `body` is its **description** — what is sent when the task is played, and the
whole of the prompt. The title is no part of it. A play sends the description and **empties it**, and
files what came back in a new field, `log`, each answer behind a `---`. A task with no description is
not played: no Play on its card, and a chain reaching one ends there.

**Why: a card was readable exactly once.** The prompt and the answers grew into the same `body`, so
playing a task a second time sent the first answer back as part of the instructions — and the way to
ask a follow-up was a second card that had to say everything again, in a chat of its own. The board
was a list of things to ask once. Two fields make a card a thing to **come back to**: write, play,
read the log, write again — in the conversation the card already names, which is what makes the
second question worth asking there at all. That is also the plainest way to say what a played card
is: an empty box and a full log.

**The title stopped being the prompt's first line** for the same reason. It is the card's name — read
on the board, named by a chain, typed into a column's quick box before anybody knows what they are
asking — and sending it made it a sentence of the prompt as well: a task played twice sent it twice,
and renaming a card changed what its next turn was told. What replaces it is at the other end: the
quick box writes what is typed into the title **and** the description, and the panel opens with that
description selected, so a line meant as the ask is kept with one arrow key and a line meant as a
name is typed over.

**Where the description goes is at the outcome, not on the way out.** A turn that comes back an error
worth waiting out is sent *again*, read from the document, so a description cleared when the prompt
went would be an empty prompt twenty minutes later. `done` and `interrupted` file and empty; `error`
files nothing and **keeps** the description, which is what tells that ending from the other two — the
card is played again as it stands.

**What it costs.** A card whose description has been sent shows nothing but its title on the board,
where it used to show the lead of what it was asked. There is no migration: a body written before
this holds its old answers, is read as a description, and would be sent whole if the card were played
again — a `done` card that somebody has to set `ready` first, so it is not something a run does on
its own. And the log grows without bound, which is why it is editable and written last in the object.
