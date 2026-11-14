---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-22
tags: ["agents", "versions", "conversations", "archive", "hybridflow", "board", "worker", "hybridflow-store", "dashboard", "kiao-worker", "kiao-mcp"]
triggers: ["agent publication", "agent archive", "task provenance", "agent version", "managed agent", "standing instructions", "briefing", "agents panel", "card names engine", "no foreign key", "deleted agent", "AgentVersion", "agent_version", "agentVersion", "PublishAgent"]
supersedes: []
superseded_by: []
---

# 00058 — Agents publish immutable versions captured by conversations.

## Context and Problem Statement

Editing a shared agent must not change configuration halfway through a task. A conversation
must also retain readable provenance when the boards store or adapter catalogue is unavailable.

## Considered Options

* Publish immutable agent versions and copy the selected snapshot into each task conversation.
* Let an existing task follow subsequent edits to the shared agent.
* Use a cached board-spool agent when a new conversation cannot read a live publication.

## Decision Outcome

Chosen option: "Publish immutable agent versions and copy the selected snapshot into each task conversation",
because each task must retain its configuration independently of later edits or store availability.

An editable agent remains a draft. Publication appends a numbered snapshot of name,
harness, model, profile reference, selection description and standing instructions.
One transaction locks the row, checks optional `If-Match`, inserts the snapshot and advances
the revision. Published history is immutable and undeletable; agents with publications
cannot be deleted.

Task-conversation creation reads the latest publication live and copies it to `meta.json`
as `agentVersion`. `resolvedModel` and `resolvedProfileId` freeze adapter defaults once.
Prompts and replies carry agent ID/version; prompts retain composed system instructions.
Effective model/profile resolution remains in conversation and turn metadata, with Pi
profiles retaining independent per-turn revision tracing.

Replay, manual messages, retry and recovery keep that snapshot even after editing,
republishing, archiving or loss of access. New task conversations, successor forks and user
forks of the same managed agent select the latest publication. Recovery forks retain the
running task's version; switching a user fork to another engine creates a free conversation.
A failed live publication read never falls back to the board spool's cached agent.

Archiving hides normal listings and new choices. Explicit archived listings, direct reads
and history keep saved harness/model strings even if adapters stop listing them.
Restoration clears the flag; archived or unpublished agents cannot start new task conversations.

Tasks reference agents by stable ID without a foreign key. Missing references remain
readable but are refused when creating a conversation. Effort, permission mode and folder
remain task settings. Old engine/model cards remain readable; writes select a managed agent.
Standing instructions join system instructions, not the user's description.

## More Information

V028 publishes existing definitions as version 1; new agents start unpublished.
Earlier transcripts remain intact, and the next managed play forks with the latest
publication. No publication version is invented for past turns.
