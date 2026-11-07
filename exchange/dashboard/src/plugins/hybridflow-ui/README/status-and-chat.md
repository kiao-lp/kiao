---
status: DRAFT
role: PRIMARY_SOURCE
---

# Status and chat

[Board guide](../README.md) · [Playing nodes](playing-flow-nodes.md)

The runner and editor update a node's status; the runner also attaches its conversation:

```json
{ "id": "task-1", "title": "Write the plan", "status": "done", "chat": "conversation-id" }
```

| Status | Meaning | Color |
| --- | --- | --- |
| `draft` | Task still being written | Grey |
| absent or `ready` | Eligible to start when settings and prompt are complete | Amber |
| `todo` | Human work to do | Teal |
| `blocked` | External dependency; set and cleared by the user | Pink |
| `running` | Taken by a run, or human work in progress | Blue |
| `waiting-refresh` | Held until the agent's usage window reopens | Orange |
| `interrupted` | Stopped before completion | Violet |
| `done` | Work completed; agent answer remains in the conversation | Green |
| `error` | Execution failed or could not start | Red |

`ready` is omitted on write for compatibility with older boards. The runner writes `running`
before sending the prompt, persists usage waits and records terminal state. A stopped,
replaced or abandoned run leaves unfinished work `interrupted`. Usage exhaustion does not
mean completion; see [usage waits](playing-flow-nodes.md#waiting-for-a-usage-limit).

Only `ready` offers a new Play. Reset terminal status explicitly to replay. The current AI or
Scheduler node can instead show its run's Stop; Shutdown and Gateway use the runs panel.
AI task inputs are editable in Draft or Ready and read-only in other states
(`taskInputsReadOnly`). Human work can be opened while To do or In progress (`canWorkOn`).

Task cards use a fixed 3 px status stripe, avoiding layout shifts. Error has a full red outline;
active execution uses the accent outline. Symbol nodes use their ring. Status labels and select
options use the same colors. [flowNodeStatus.ts](../flowNodeStatus.ts) defines states and gates.

## Conversation lifetime

A task without a chat gets a new conversation; its ID is saved **before** the prompt goes out
so the user can follow a live turn. A task already naming one reuses it, including a conversation
handed over by a predecessor. Run notifications prompt the board to refresh without closing the
selected editor.

The AI editor's Chat button and the task card's speech bubble open Conversations. Forgetting a
chat removes the node's reference without deleting the conversation; the next play creates one.
Converting away from AI keeps the reference as history, even when the editor hides chat controls.

Delete, Cut and Archive can ask about conversations no remaining live node on the board uses;
see [removal rules](clipboard-and-archive.md). They never silently delete transcripts.
