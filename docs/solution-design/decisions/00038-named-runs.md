---
id: "00038"
title: "the service plays several boards at once, and a run is a named thing that outlives its play"
status: accepted
date: 2026-09-04
tags: ["hybridflow", "runs"]
components: ["worker", "dashboard"]
paths: ["operation/worker"]
symbols: ["agents/workflow_run.go", "play", "stop", "resume", "restart", "forget"]
triggers: ["second run", "named run", "restart", "forget", "resume", "workflows panel", "card played twice"]
supersedes: []
superseded_by: []
---

# 00038 — the service plays several boards at once, and a run is a named thing that outlives its play

**Decision:** `WorkflowRunner` holds a **list of runs** rather than the one it had
(`agents/workflow_run.go`). Every run carries a **name**, asked for in a dialogue when Play is
pressed and prefilled with `Started 4 Sep 13:22`; the card it was started on, so it can be played
again; and the **chain it has walked** — the cards played, the card it is on, the cards ahead along
the `onSuccess` links, each with its title and status. It **stays in the list once it has ended**,
saying so and saying why, until it is restarted or forgotten. Six endpoints where there were four
(`play`, `stop`, `resume`, `restart`, `forget`, and the read), every one but the read naming its run
by id; the `workflow` frame and `hello` carry the whole list. Protocol version 13. Dashboard grows a
**workflows panel** in the tasks-board plugin, registered for every document.

**Why: one run was a ceiling on the unit of work, not a property of the domain.** The previous entry
argued that a play belongs to the service because the unit of work is hours and the unit of attention
is minutes. The same argument reaches one step further: a person with an hour of work to hand over
has *several* hours of it, on several boards, and being able to start only one at a time meant
sitting through the first before naming the second — which is exactly the waiting the move out of the
browser was meant to abolish. The turns were never the constraint; the hub has run four at once since
it existed.

**What made it safe is two rules, and neither is a lock on the feature.** A **card is played by one
run** — a second play on it is refused at the click, and a chain walking into one ends there naming
the workflow that got there first — because two turns would file two answers under one task. And
**every board write is serialised across every run**, the lock held across the read as well as the
write, since a write here is read-change-write: two of them at once on one document would lose
whichever landed first, with no trace anywhere that the answer had existed. Those two are the whole
of the concurrency story; everything else about a run was already keyed on ids and already read the
document afresh at every step.

**A run had to become a thing you can name, because it stopped being *the* run.** "Stop the play" is
a sentence when there is one play and a riddle when there are three. So the name is asked for once,
at the click, and never derived: a board path and a task id are what two runs of one board share.
Every notice now rides under the name of the run that decided it, and the card's Stop says which
workflow it would end.

**And it had to outlive its play, because a finished run is the only thing a Restart can be offered
on.** A run that vanished when it stopped would leave the panel showing what is happening and nothing
about what happened — while the plainest thing anyone does with a chain that failed is fix something
and run it again. Restart replays from the card the run started on, keeping the name and the place in
the list. A card whose description went into its conversation has nothing left to send and the
restart is refused in those words, which is the same answer the board gives by drawing no Play on a
card that has run. Twenty ended runs are kept, in memory only: what happened this session is worth
having, and what happened last week is in the board, where every answer was filed.

**The panel holds no document, and that is what makes it a panel rather than a second board.** The
chain travels with the run — the service works it out from the board it has just read anyway, so a
step costs no extra read — which is why a workflow playing a `.workflow.json` nobody has opened draws
correctly, and why the tail of the chain is a forecast refreshed at every step rather than a plan
fixed when the run started. It lives in the tasks-board plugin, not the agent one: what it draws is
boards and cards, and a run is only what puts them in motion.

## Refactor notes

Runs later renamed chain runs (00066); endpoints and frames renamed with them.
