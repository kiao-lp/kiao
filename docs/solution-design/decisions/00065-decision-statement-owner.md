---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "superseded by ADR-00067"
date: 2026-11-09
tags: ["docs", "decisions", "conventions"]
triggers: ["new decision", "decision status", "decision owner", "decision statement", "decision.statement", "decision.owner", "decision.status"]
supersedes: []
superseded_by: ["00067"]
---

# 00065 — Decision records use statement and owner, never title.

## Context and Problem Statement

A separate title duplicated the sentence stating a decision. The earlier model needed
one statement shared by metadata, H1 and catalogue, with explicit ownership.

## Considered Options

* Keep a short statement and an owner in namespaced decision metadata.
* Maintain a separate decision title alongside its statement.

## Decision Outcome

Chosen option: "Keep a short statement and an owner in namespaced decision metadata",
because a single sentence could identify the decision consistently at every status.

The earlier `decision` namespace held `statement` and `owner`, without `title`.
Statements had at most 12 words: questions in `DRAFT` and `PROPOSED`, decision sentences
from `DECIDED` onward. H1 and index shared `id — statement`.
`owner` identified the accountable person or role; `owner: ""` was an attribution TODO.
Statuses were `DRAFT`, `PROPOSED`, `DECIDED`, `SUPERSEDED` and `REJECTED`.

The model applied within each independent catalogue. Cleanup could update bodies, filenames,
IDs and references together while retaining dates and keeping ownership unassigned until
attributed. Git retained previous versions.

## More Information

Superseded by [ADR-00067](00067-madr-decision-records.md).
The current format is specified by [kiao-adr](/reference/kiao-skills/kiao-adr/SKILL.md).
