---
id: "00025"
title: "a task says it is being worked on, and a stopped one says it was interrupted"
status: accepted
date: 2026-08-28
tags: ["hybridflow", "status", "board"]
components: ["worker", "dashboard"]
paths: []
symbols: ["running", "interrupted", "draft"]
triggers: ["card status", "running card", "stopped turn", "draft", "Play missing", "stale running"]
supersedes: []
superseded_by: []
---

# 00025 — a task says it is being worked on, and a stopped one says it was interrupted

**Decision:** a task's `status` gains three words. `running` is written by the run **before the
prompt goes out** and is what the task says until the run lets go of it; `interrupted` is what a
turn somebody stopped leaves, and what a run ending while it still holds a task leaves on the way
out; `draft` is the user's, for a task still being written. With `ready`, `done` and `error` that
makes six, and `ready` stays the one the document leaves out. Only a `ready` task is played, so the
three new ones are three more cards with no Play, and the panel's select is where a task comes back
from any of them.

**Why: a run was invisible to everyone but the tab that started it.** What said a task was being
worked on was a spinner the board drew from the run's socket state — so a second machine, a closed
tab and tomorrow morning saw a card that looked exactly like an untouched one, on a run that lasts
minutes to hours. The document is what a board is read from everywhere else, and it said nothing.
The mark also settles what a task played again shows: it used to be set back to `ready` at the top
of the round, which is a task claiming to be waiting while its turn runs.

**And `done` was carrying two endings.** A turn stopped from its chat was filed and marked done —
it had been worked on — but the whole point of the stop is that the task was *not* finished, and
the mark a board is read for said it was. `error` would have been the other lie: nothing failed,
somebody pressed Stop. `interrupted` is the third ending, and it is also the honest thing to leave
on a task a run was holding when it was replaced, killed or stopped in the middle of a retry wait —
endings that used to leave the card saying nothing had happened at all.

**What it cost.** Every played task now writes the board once more than it did, at the top of its
round. A run whose whole service is killed leaves a `running` mark nothing sweeps — the loop marks
its task on the way out, and a process that never comes back has no way out — so that card has to be
set back by hand, which is the same gesture as any other status. And `draft` had to be an explicit
word rather than the absent one: a board written before this entry means *this task is to be
played*, and reading the missing field as a draft would have taken the Play off every card in
every store.
