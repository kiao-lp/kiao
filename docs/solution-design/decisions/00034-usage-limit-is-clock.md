---
id: "00034"
title: "a usage limit is a clock, and the turn it cut off is resumed rather than replayed"
status: accepted
date: 2026-09-03
tags: ["hybridflow", "runs", "limits"]
components: ["worker", "dashboard"]
paths: []
symbols: ["waiting-refresh", "refreshing", "retryAt", "resets"]
triggers: ["usage limit", "resets", "429", "waiting refresh", "resume line", "weekly window", "eight-day bound"]
supersedes: ["00024"]
superseded_by: ["00076"]
---

# 00034 — a usage limit is a clock, and the turn it cut off is resumed rather than replayed

**Decision:** a usage limit is told apart from the other errors a run waits out. Its notice says when
it lifts — `Claude AI usage limit reached|<epoch>`, `resets 7:10pm (Europe/Paris)`, a `429`'s
`retry-after` — and the run waits **until that moment plus a minute** instead of the fixed twenty.
The task is marked `waiting-refresh` in the document, a seventh status, and the run reports itself as
`refreshing`, a seventh run state, with `retryAt` on the moment. When the limit lifts, what goes into
the chat is not the description again but `You have been interrupted, please resume cleanly`.

**Why: the twenty minutes were no answer to a five-hour window.** Four tries twenty minutes apart all
land inside the first hour of it, so the run marked as an error a task nothing was ever wrong with —
after an hour of doing nothing but asking a closed window the same question. The entry of 2026-08-27
saw this and left it, on the grounds that *a board that parked itself until 7:10pm would be a board
nobody could tell from a hung one*. That objection is answered rather than overruled: the card now
says `waiting-refresh` and the line under its title reads *Waiting refresh · back at 19:11*, in the
document rather than in the tab that started the run, so a board read in the morning says which of
the two it is. Stop still cuts the wait short, and the four tries still bound it.

**Why not send the task again.** The turn that meets a limit has usually been working for an hour: it
read the folder, wrote half the change, and the conversation holds every word of that. The
description sent a second time asks for all of it again in a chat that already contains it — the
model reading its own half-done work as somebody else's, and an hour paid for twice. The resume line
says the one thing that is true, and the answer to it is the task's answer, filed under the
description that asked for it. The play's log entry is opened once and stays open across the wait, so
the card shows one question and one answer however many attempts it took; the images the body links
are not sent again either.

**What it cost.** A run may now hold a card for hours — a weekly window is days — where it used to
give up in an hour, which is the point, but it is a board that looks busy for far longer. The mark is
what makes that legible, and the sanity bound on what a notice can name is eight days: a moment
further off is this reader having misread a number, and the run falls back on the twenty minutes.
Reading a wall clock is best-effort — the zone the notice names is honoured where the host can
resolve it, `resets Mon 9am` is read as the next Monday, and a notice naming nothing at all (a bare
`429`) is waited out the old way. Being an hour early costs one of the four tries; being wrong about
the day costs the card another wait.

## Refactor notes

[00076](./00076-quota-reset-instants.md) replaces the eight-day bound and clock-only display with
monthly reset support and full local datetimes. The wait and resume lifecycle above still applies.
