---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# On success

[Board guide](../README.md)

`onSuccess` names the next node and, for AI tasks, the conversation handoff:

```json
{
  "onSuccess": { "flowNode": "next-node-id", "mode": "continue", "compact": true }
}
```

Links use stable node IDs, so moving a card does not change the chain. AI, Human, Scheduler and
Bitbucket events can name one successor. Gateways link their successors in `flowNodes`. An exclusive
gateway evaluates `routes` in order to select one of those successors. Shutdown, Note and Value
have no successors. Chat actions belong to AI only.

## The transition mode

| Mode | Conversation used by the successor |
| --- | --- |
| `end` | A linked chat for a Ready task, or a new chat for an unlinked or Done task |
| `continue` | A new fork of this task's current conversation, including its transcript and, where compatible, its native harness session |

The current task retains its own conversation. The runner links the new fork to the successor
before sending its prompt. A suspended run resumes in that fork. Replaying the completed
successor replaces its previous link.

## Compact

`compact: true` sends `/compact` as a separate turn after successful work. It runs **before**
a `continue` fork. With no successor it still shortens the task's conversation. Removing or
redrawing a chain preserves mode and compaction; they describe how this task ends.

The command is sent bare: attachment notes would become summary instructions. Compaction
failure stops execution rather than forking an unshortened conversation. Failed attempts do
not compact; a task that finally succeeds compacts once.

## Validation and compatibility

AI chat controls stay visible even while required settings are missing; warnings explain the
incomplete choices. Converting away from AI resets mode to `end` and removes compaction.
Machine-only nodes have no conversation to receive, so a preceding `continue` cannot carry
one through them.

A conversation and its forks keep one folder. A handed-off task must name that same folder;
a mismatch stops the run. Use `end` to let a successor work elsewhere. Effort and permission
remain per-turn choices.

[flowNodeSuccess.ts](../flowNodeSuccess.ts) reads these older forms:

- A bare successor ID or named successor without mode implies `continue`.
- A legacy `chat` field supplies the mode beside a named successor.
- `mode: "compact"` means `continue` plus compaction.
- An explicit unknown mode, including retired `shutdown`, means `end`.

Writes always include mode so a chain cannot accidentally imply legacy continuation;
`compact` is omitted when false.

## Following and ending a chain

The runner rereads the board after each turn, so edits made during work affect the next step.
Errors and stopped turns skip compaction, handoff and successors. Ordinary success stops when
there is no successor, it has left the board, it is not runnable, or the chain revisits a node.
Examples include a Human task, incomplete AI settings, an empty AI prompt or invalid Scheduler
timing. The runner reports the reason; see [play and retry behavior](playing-flow-nodes.md).
