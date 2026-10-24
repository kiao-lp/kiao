---
id: "00050"
title: "a task names a managed agent, and the engine and model are the agent's to say"
status: accepted
date: 2026-09-14
tags: ["hybridflow", "agents", "board"]
components: ["worker", "hybridflow-store", "dashboard"]
paths: []
symbols: ["managed agent", "briefing", "--append-system-prompt", "developer_instructions"]
triggers: ["managed agent", "standing instructions", "briefing", "agents panel", "card names engine", "no foreign key", "deleted agent"]
supersedes: ["00036"]
superseded_by: []
---

# 00050 — a task names a managed agent, and the engine and model are the agent's to say

**Decision:** what plays a task is a **managed agent** — a named row in the workflows-service
holding a platform, a model and standing instructions — and a task names one by id. The effort, the
permission mode and the folder stay the task's own. They are kept in a Task agents panel beside the
boards, and the runner resolves the id at every play: the platform and model the turn runs on, and
the instructions it is given in the system prompt beside the briefing.

**No migration of the cards.** A card written before this names the engine itself, with the model
beside it, and those cards are played as they always were: the runner reads one where the id names
no agent. The reads stay forgiving and the writes narrow — a card's settings cannot be written back
until they name an agent — so the old shape fades one edit at a time instead of by a rewrite of
every board. There is deliberately **no foreign key** from the card to the agent, for the same
reason the chat is a reference: a card naming an agent that has gone must still open and say which
agent it wanted, refused at its next play rather than at the delete.

**The instructions travel with the briefing, not with the prompt.** Each driver appends them to the
system prompt it already sends — `--append-system-prompt`, `developer_instructions`, the input
text — which is what keeps them out of the transcript the user reads back, and what makes a resumed
turn inherit them exactly as it inherits the briefing. Chats typed by hand get none: standing
orders are what a board plays with, not what a conversation is.

## Refactor notes

Narrows the writes of 00036 (agent field becomes a managed-agent id); cards naming the engine directly still play.
