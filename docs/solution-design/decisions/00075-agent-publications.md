---
id: "00075"
title: "Managed agents publish immutable versions captured by task conversations"
status: accepted
date: 2026-10-22
tags: ["agents", "versions", "conversations", "archive"]
components: ["worker", "hybridflow-store", "dashboard", "kiao-worker", "kiao-mcp"]
paths: ["operation/hybridflow-store", "operation/worker/internal/hybridflow-runner", "exchange/dashboard/src/plugins/hybridflow-ui"]
symbols: ["AgentVersion", "agent_version", "agentVersion", "PublishAgent"]
triggers: ["agent publication", "agent archive", "task provenance", "agent version"]
supersedes: []
superseded_by: []
---

# 00075 — Published agent versions

**Decision:** keep an agent's editable configuration as its draft. Publishing appends a numbered,
immutable snapshot of its name, platform, model, profile reference, selection description and
standing instructions. The publication locks the agent row, checks `If-Match` when supplied,
inserts the snapshot and advances the agent revision in one transaction. Published history cannot
be updated or deleted, and an agent with publications cannot be deleted.

Creating a task conversation selects the latest publication and copies the complete snapshot into
`meta.json` as `agentVersion`. Its model and standing instructions are fixed for that conversation.
Prompt and reply records carry the agent ID and version number; each prompt retains the actual
composed system instructions. Effective model and profile resolution remain in conversation and
turn metadata. Pi execution profiles retain their independent per-turn revision tracing.
The copied snapshot also keeps `resolvedModel` and `resolvedProfileId`, so adapter defaults are
resolved once and a later profile default cannot change the model of an existing conversation.

A task replay, manual message, retry or recovery continues with this snapshot, including when the
agent has been edited, published again, archived, or cannot be fetched. A new task conversation,
successor fork or user fork of the same managed agent selects the latest publication. A recovery
fork preserves the running task's publication. Switching a user fork to another engine creates a
free conversation without a managed-agent binding.
New conversation creation requires a live publication read; the board spool does not substitute a
cached agent when the store is unavailable.

Archiving marks the agent and hides it from normal listings and new choices. Explicit archived
listings, direct reads and publication history retain its saved platform and model strings even
when the runner's adapters no longer list them. Restoration clears the flag. Archived agents and
agents without publications cannot start new task conversations.

**Upgrade:** database migration V028 publishes each existing definition as version 1. New agents
start unpublished. Conversations created before this feature keep their original transcripts;
their next managed task play creates a fork with the latest publication, leaving the historical
conversation intact. No version is invented for past turns.

**Why:** changing a shared agent must not change the configuration used halfway through a task.
The version number identifies the publication, while the conversation copy remains readable
independently of the boards store and the current adapter catalogues.
