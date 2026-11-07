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

**Decision:** boards merge concurrent disk changes with local edits. A codec may declare `merge(base, ours, theirs)`. On conflict the merge result is displayed and saved so both writers converge. The board merge is `boardMerge.ts`; boards are database records with their own merge, separate from disk-sync hooks.

A board has two writers: the runner writes `status`, `chat`, appended `log` and sent `body`; the UI writes titles, settings, chains, columns and positions. The merge is three-way over keyed task and column IDs. A field changed on one side takes that side. A field changed on both sides takes the board value, except an appended `log` keeps the appended tail. Card positions take the screen arrangement when present, else the file value. File-only entries are added; file-deleted entries not edited locally are dropped.

Save checks metadata first, so an external write since the last poll merges before the write. A race remains between the check and the write; the files API has no conditional write. Two concurrent prose rewrites of one body do not splice; local text wins.
