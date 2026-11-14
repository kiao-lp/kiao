---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-24
tags: ["store", "config", "migrations", "dashboard"]
triggers: ["store configuration", "config/", "value providers", "file templates", "kiao-user-config"]
supersedes: []
superseded_by: []
---

# 00008 — Store configuration lives in kiao-user-config.

## Context and Problem Statement

DCMS serves arbitrary folders, including repositories whose `config/` already contains
deployment settings. Dashboard must not interpret those files as store configuration.

## Considered Options

* Store Dashboard configuration in `kiao-user-config/`.
* Use the store's `config/` folder.

## Decision Outcome

Chosen option: "Store Dashboard configuration in `kiao-user-config/`", because its distinct
name avoids claiming another project's configuration folder.

Dashboard reads value providers, file templates and other user configuration there.
Ordinary documents may live anywhere; `docs/` is not reserved for notes.

## More Information

Old folder renames belong to the
[retired migration history](/migrations/cutover-2026-10-20.md).
