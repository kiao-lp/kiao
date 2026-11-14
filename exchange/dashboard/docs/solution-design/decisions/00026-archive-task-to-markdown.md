---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-04
tags: ["hybridflow", "archive", "board", "dashboard"]
triggers: ["delete card", "archive", "tidy board", "Done column", "chat cleanup", "name taken", "toStoreName", "archive/"]
supersedes: []
superseded_by: []
---

# 00026 — Archive writes card to dated markdown beside board.

## Context and Problem Statement

Archiving must preserve a card's readable record after removal, including its description,
returned log and filed column. A failed archive write must leave the card intact.

## Considered Options

* Write a dated Markdown archive before removing the card.
* Delete the card without creating an archive.

## Decision Outcome

Chosen option: "Write a dated Markdown archive before removing the card", because ordinary
store Markdown preserves that record and writing first prevents loss on failure.

**Archive** writes to an `archive` folder beside the board, then removes the card.
Names begin with archive date followed by task title, using `toStoreName`; collisions
receive a suffix without overwrite. The leading date sorts files by completion.
**Delete** removes the card without an archive.

The archive has no `docType`, ID or read-back mechanism. It excludes the conversation ID,
since the log contains the readable answers. Both operations separately ask about deleting
the task's conversation after card removal.
