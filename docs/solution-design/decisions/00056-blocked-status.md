---
id: "00056"
title: "a card can say it is **blocked**, and that word is the user's alone"
status: accepted
date: 2026-09-15
tags: ["hybridflow", "status", "board"]
components: ["dashboard", "worker", "hybridflow-store"]
paths: []
symbols: ["taskStatus.ts", "workflowStatusBlocked", "entities.StatusBlocked", "V007", "canPlay", "StartPlay", "ClaimTask", "Held()", "--task-blocked"]
triggers: ["blocked card", "waiting on", "pink card", "not playable", "waiting-refresh mirror", "Blocked column"]
supersedes: []
superseded_by: []
---

# 00056 — a card can say it is **blocked**, and that word is the user's alone

**Decision:** add `blocked` as an eighth task status, between `ready` and `running` in the order the
select and the card read them. It means the card is waiting on something that is not on the board —
an answer somebody owes, a deploy that has to land first, a decision nobody has taken. Pink
(`--task-blocked: #b83280`) in both themes, `MinusCircleOutlined` for the glyph, and not playable:
`canPlay` still answers `ready` and nothing else, so the Play simply is not on the card, and in the
database `StartPlay`/`ClaimTask` refuse it under the rule that was already there.

**Why a word rather than a column or a tag.** The seven were all either the user saying whether the
card was finished being written or a play saying what it had done with it, and neither covers work
that is fully described and cannot start. Left `ready` such a card is the next one somebody plays;
set back to `draft` it reads as unfinished writing and what it is actually waiting for is lost. A
*Blocked* column would say it too, at the price the status was introduced to stop paying — the
column is the user's filing, and a card held up in the middle of a project is still filed under that
project. A tag would not stop it being played.

**It is the mirror of `waiting-refresh`, and that is the whole of its behaviour.** Both say a card
is waiting rather than working. `waiting-refresh` waits on the account and is the run's to write and
to clear; `blocked` waits on the world and no run writes it, clears it or reads it — it is not
`Held()`, because nothing is holding the card, which is why it waits. Saying the card is `ready`
again is what offers it its turn back, as it is for a card that ended badly. Nothing records *what*
blocks it: that is a sentence in the description, or a chain from the card it waits on.

**Three vocabularies, one word.** `taskStatus.ts` in `hybridflow-ui`, `workflowStatusBlocked` in
worker's `.workflow.json` reader (which neither writes nor clears it, only carries it through
a rewrite), and `entities.StatusBlocked` plus schema `V007` in hybridflow-store, which widens the
`task_status_check`. No row says it yet, so the migration converts nothing. Every reader stays
forgiving, so a board written by a build that has the word and read by one that has not is a board
of `ready` cards rather than a board that fails to open.
