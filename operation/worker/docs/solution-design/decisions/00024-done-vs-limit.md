---
id: "00024"
title: "`done` means the task was finished, and a limit at the foot of an hour's work is not"
status: accepted
date: 2026-08-27
tags: ["hybridflow", "runs", "errors"]
components: ["worker"]
paths: ["operation/worker"]
symbols: ["agents/workflow_fault.go"]
triggers: ["limit notice", "session limit", "resets", "API Error", "done vs error", "last block", "529"]
supersedes: []
superseded_by: ["00034"]
---

# 00024 — `done` means the task was finished, and a limit at the foot of an hour's work is not

**Decision:** the CLI's error notices are read at the **foot** of a reply as well as at its head, and
a subscription limit — `You've hit your session limit · resets 7:10pm (Europe/Paris)`, and the
weekly, Opus, Sonnet and Fable 5 windows beside it — is one of the notices read. A turn that said
nothing at all and whose process exited non-zero is a third kind, needing no notice. All of them mark
the task `error` and file nothing under it.

**Why: a reply is not a notice, it *ends* with one.** `agents/workflow_fault.go` was written for a turn that
fails before it does anything — the reply *is* `API Error: 529 Overloaded…`, so matching at the head
and nowhere else kept an answer about API errors from being read as one. But the limit a long run
actually meets arrives after an hour of work: the CLI composes it as one more text block at the end
of everything already said, and the head of that reply is `I'll start by exploring…`. So the notice
went unread, the transcript was filed under the task as its answer, and the task was marked done by
the very sentence saying it was not finished — and, being done, its chain was played on. A reply is
one record whose text blocks are joined, so the last block is the stretch to read, and a notice is
still a whole block rather than a phrase found anywhere in prose.

**Nothing of the hour is filed.** The rule that a failed turn writes nothing under its task does not
soften because the turn worked first: a task's body is also its **prompt** when it is next played, so
half a turn filed into it comes back as part of the instructions. What was said is in the
conversation, which the card names and opens.

**What it cost.** A subscription limit is a clock, so it is waited out like a 429 — and a five-hour
window outlasts the four tries, so the run spends an hour of waiting before marking the task and
saying so. That is the retry policy working as written rather than a case for a longer one: the reset
time is in the notice, but a board that parked itself until 7:10pm would be a board nobody could tell
from a hung one. (Answered on 2026-09-03: the card says which it is, so the run does park itself.) The tail rule also widens the false-positive surface by one block — an answer whose
*last* block opens with the words `API Error` is read as a notice, where before only its first block
was. That reply keeps its conversation; the task is marked `error` rather than `done`, which is the
direction to be wrong in.

## Refactor notes

Limit wait policy replaced by park-until-reset (00034). Reading limits as error-not-done still holds.
