---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-02
tags: ["hybridflow", "board", "prompt", "dashboard", "worker"]
triggers: ["description", "log", "replay", "follow-up question", "title as prompt", "empty card", "retry sends", "body", "quick box"]
supersedes: []
superseded_by: []
---

# 00021 — Task body is description sent; answers file separately.

## Context and Problem Statement

Keeping prompts and answers in one task body resends earlier answers as instructions on
replay. Including the title also resends it on every turn and makes a rename change the prompt.

## Considered Options

* Separate the description sent to a turn from its returned log.
* Keep prompts and answers together in the task body.
* Include the task title in each prompt.

## Decision Outcome

Chosen option: "Separate the description sent to a turn from its returned log", because a
card can accept follow-up work in its existing conversation without resending previous answers.

`body` is the description and whole prompt; the title is excluded. `done` and
`interrupted` turns append their answer to `log`, separated by `---`, then empty the
description. An `error` files nothing and keeps the description so a later retry can
send it again. Clearing occurs at the outcome, not when the prompt leaves.

A card without a description offers no Play, and a chain stops on reaching it.
The quick box initializes both title and description, then the panel selects the description:
a user can retain it as the question or replace it when the initial line was only a name.

### Consequences

* Bad, because a played card shows only its title once its description is cleared.
* Bad, because no migration separates old answers already in `body`. They would be sent
  whole if the user explicitly returned a completed card to `ready`.
* Bad, because `log` grows without bound. It stays editable and is serialized last.
