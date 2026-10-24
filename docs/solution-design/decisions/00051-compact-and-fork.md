---
id: "00051"
title: "compacting a chat is the card's own answer, and continuing forks it"
status: accepted
date: 2026-09-14
tags: ["hybridflow", "chains", "chat"]
components: ["worker", "hybridflow-store", "dashboard"]
paths: []
symbols: ["onSuccess.compact", "onSuccess.mode", "V005"]
triggers: ["compact", "continue", "fork", "shared conversation", "chain cost", "fork failed", "branched from"]
supersedes: ["00021", "00022"]
superseded_by: []
---

# 00051 — compacting a chat is the card's own answer, and continuing forks it

**Decision:** `onSuccess.mode` keeps two values, `continue` and `end`, and shortening the chat
becomes `onSuccess.compact`, a box beside them. When a task ends well, its chat is compacted if the
box is ticked; then, where the mode says `continue`, that chat is **forked** and the next task is
played in the copy. Schema V005 splits the column the same way, and the word `compact` is read as
both halves wherever it still appears — in a document, in a request, in a row of the old column.

**Why the box: one word was two answers.** `compact` meant *shorten this chat and hand it on*, and a
word that says two things is a word one half of which cannot be picked alone. A card that wanted its
conversation shortened **and ended** — the last of a chain, or one played on its own, whose chat is
the long thing a long turn leaves — had no way to say so; nor could the two questions be put
separately to a card in the middle of a chain. They are different questions: who gets the
conversation next, and what state this card leaves it in. The second is worth asking of every played
card, which is why it is not a value of the first.

**Why the fork: a chain was one thread wearing five cards.** Under the old `continue`, every card of
a chain pointed at the same conversation: the fifth card's chat was also the first card's, opening
either meant reading all five, and a message typed into one arrived in all five. That is one
conversation doing the work of five records. A fork gives each card a chat of its own while the copy
carries the transcript *and the CLI session*, so the next task still remembers everything the chain
has done — which was the whole point of carrying the chat on. What the cards share is where each was
branched from, which the fork's own notice in the transcript says, and the copy is named after the
card it was made for rather than after the card it came from: six conversations called "Write the
plan (2)" would have lost the one thing a title is for.

**The order is the order it reads in.** Compaction first, fork second: the copy is taken from the
shortened chat, which is what makes a long chain cost less with the box ticked. Both are reached
only by a task that **succeeded** — a turn that came back an error shortens nothing and forks
nothing, as it chains nothing.

**What it cost.** A run that continues now writes a conversation per card instead of one per chain,
and the fork is a write the play can fail on: a chat that could not be forked stops the play and says
so, as a compaction that came back an error already did. A fork also inherits its source's folder,
which is the same rule the chain already had — a chained task naming another folder stops the play —
said once more in a place where it now cannot be got around.
