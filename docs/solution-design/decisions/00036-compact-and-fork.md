---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-14
tags: ["hybridflow", "chains", "chat", "board", "worker", "hybridflow-store", "dashboard"]
triggers: ["compact", "continue", "fork", "shared conversation", "chain cost", "fork failed", "branched from", "play order", "chain", "next task", "folder mismatch", "column play", "move right", "Done column", "chain across columns", "chat field", "delete conversation", "onSuccess.compact", "onSuccess.mode", "V005"]
supersedes: []
superseded_by: []
---

# 00036 — Compaction per card; continue forks chat per card.

## Context and Problem Statement

The old `compact` mode coupled shortening a conversation with handing it on, preventing
compaction of a final or standalone card. Continuing also made all cards share one chat,
so opening or messaging one affected every card in the chain.

## Considered Options

* Configure compaction independently and fork the conversation for each continuation.
* Keep compaction coupled to continuation in one mode.
* Reuse the same conversation across all continuing cards.

## Decision Outcome

Chosen option: "Configure compaction independently and fork the conversation for each continuation",
because cards need independent choices and their own conversation records with inherited context.

`onSuccess.mode` is `continue` or `end`; `onSuccess.compact` is a separate checkbox.
After success, compact first when selected, then fork for `continue` and play the next
card in the copy. The fork carries transcript and CLI session, records its source in a
notice, and takes the destination card's name. Failed turns neither compact, fork nor chain.

`onSuccess` links by stable node ID alone determine execution order. Runs start on ready
nodes. Missing or unplayable successors, repeated nodes, a folder mismatch during continuation,
or an explicit stop end or suspend with a notice. Positions and visual groups never select
the next node. An `end` successor starts a fresh conversation and may use another folder.

Tasks record their conversation before sending the prompt, allowing opening and resuming
while running. Removing its last task reference offers conversation deletion separately.
Bare slash commands reach the driver without a prompt footer.

### Consequences

* Bad, because continuation writes a conversation per card rather than per chain.
* Bad, because failed fork or compaction stops the run with a notice.
* Bad, because a fork inherits its source folder; a chained task naming another folder stops
  continuation.

## More Information

Schema V005 splits the stored column. Legacy `compact` in documents, requests or old rows
continues to mean both compaction and continuation.
