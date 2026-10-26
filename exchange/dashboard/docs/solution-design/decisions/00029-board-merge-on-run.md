---
id: "00029"
title: "a board open during a run is merged with the file, not written over it"
status: accepted
date: 2026-08-31
tags: ["hybridflow", "board", "sync"]
components: ["dashboard"]
paths: []
symbols: ["disk-sync", "boardMerge.ts", "documentAt", "/info"]
triggers: ["board overwritten", "concurrent edit", "conflict", "two writers", "stale write", "pre-write check"]
supersedes: ["00019"]
superseded_by: []
---

# 00029 — a board open during a run is merged with the file, not written over it

**Decision:** `tasks-board` moves onto the shared `disk-sync` hook, and that hook gains a fourth
outcome. A codec may declare `merge(base, ours, theirs)`; where it does, a file that moved under an
unwritten edit is no longer a conflict to announce and lose, but two versions to put together — and
the result is *written back*, so both ends converge on it. The board's merge is
`exchange/dashboard/src/plugins/tasks-board/boardMerge.ts`.

**Why: a board has two writers, and starting a play must not stop the next ticket being written.**
A run is minutes to hours long and lives in worker — it marks the task it took `running`,
writes down the conversation, files the answer under the card — and it writes all of it into the
very document the user has open. The board, meanwhile, held the whole document in memory and wrote
the whole document back on its debounce. Every keystroke landed on top of whatever the run had
filed, and the reload the run's `documentAt` asked for made it certain: it flushed the stale
whole-document write *first*, then read back what it had just erased. The board also followed
nothing but the run — a Claude turn holding the `taskboard` skill, a `git pull`, a second tab all
rewrote the file with the board none the wiser.

**A board can be merged because its two writers touch different fields.** The run writes `status`,
`chat`, the answer it *appends* to `log` and the `body` it empties when it sends it; titles,
settings, chains, columns and where a card sits are only ever written here. So the merge is a
three-way one over a keyed structure, the key being the id every task and every column already
carries: a field one side moved is that side's, a field both moved is the board's — except a `log`
the file appended to, which keeps the appended tail grafted onto what was typed. Cards are only moved here, so an arrangement made on screen wins
as soon as there is one; where there is none, the file's is taken whole. What the file has and the
board has never seen is *added*; what the file dropped and the board has not written since is
*dropped*.

**Looking before writing is the other half.** Following the file is not enough on its own: the
board's save is a whole-document write, and it fires a second after the last keystroke — well
before the two-second poll would have noticed the run's write. So a codec with a merge has its
save preceded by the same check the poll runs, at the cost of one `/info` per save.

**What it costs.** A millisecond-wide race is left: between the pre-write check and the write
landing, the run can read, modify and write, and that write is lost. Closing it takes a conditional
write — an `If-Match` on the modification time — which the files API has no shape for, and the
window is now the duration of one HTTP write rather than the seconds it used to be. Two prose
rewrites of one task body still cannot be spliced, and the text on screen wins: it is the one
nobody can get back. And the board no longer draws anything over a file that is not JSON — it used
to show a fresh three-column board, one edit away from writing that over the file.
