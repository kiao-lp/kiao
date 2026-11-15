---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Flow node types

[Board guide](../README.md)

The canvas creates one of seven node kinds. AI and Human task menus offer conversion to
either task kind or to a node class.

| Type | Purpose | Main fields |
| --- | --- | --- |
| AI | Work performed by an agent | Description, criteria, settings, chat, successor and chat handoff |
| Human | Work performed by a person | Description, criteria, optional folder and successor |
| Shutdown | End execution by shutting down the runner machine | No settings or successor |
| Scheduler | Wait before continuing | Positive duration or local datetime, successor |
| Parallel gateway | Join incoming branches and start outgoing branches | Successor list |
| Note | Display Markdown on the canvas | `note`; no execution or successor |
| Value | Hold JSON, optionally typed by a schema value | `value`, `valueType`; no execution or successor |

AI and Human are **tasks**. The store gives each a task row keyed by its flow node; the API
keeps their fields flat. Only AI, Human, Shutdown and Scheduler have reusable node classes.

## Type conversion and compatibility

The type controls visible fields and normalization. Converting away from AI removes turn
settings and runner, resets transition to `end` and clears compaction. Converting away from a
task also removes folder. Shutdown and display nodes lose successors; Gateway uses `flowNodes`
instead of `flowNode`, and converting away removes its branches. Stored conversations are kept
as history even when the new type hides them.

Typing a card AI retains its agent or writes the first managed agent, without supplying missing
effort, permission or folder. Canvas creation may additionally write a supported bypass mode;
see [settings](settings.md).

Legacy input with no recognized type infers AI from an agent or model, otherwise Human. Human
is omitted on write. This reading rule is independent of canvas creation's AI default
(`NEW_FLOW_NODE_TYPE`); it must not convert older manual work into agent work.

## The Shutdown card

`"type": "shutdown"` has no prompt, settings, folder or successor. It is reached through a
successful chain, so failed or stopped work leaves the machine running.

The runner executes `KIAO_WORKER_SHUTDOWN_COMMAND` when configured. The command-line launcher
can supply it; other deployments may not. The editor keeps the node visible everywhere so
opening a board cannot erase a shutdown configured elsewhere. If the runner cannot perform
the command, the node becomes `error`, not `done`.

## The Scheduler card

`"type": "scheduler"` has two mutually exclusive modes:

- **Duration:** `"duration": "1h30m"`, counted from each play. Positive hours, minutes,
  seconds and milliseconds can be combined.
- **Date time:** `"at": "2026-10-16T22:00"`, interpreted in the runner machine's local timezone.
  A past time continues immediately. Moving the board preserves wall time, not an instant.

Without valid timing it is incomplete. It has no description, settings or conversation.
An eligible Scheduler can start a named run directly or be reached through a chain.
Stop during the wait cancels it without playing the successor.

## The Gateway card

A Gateway waits for every incoming branch, then starts its listed successors in parallel:

```json
{
  "id": "gateway-1",
  "title": "Both done?",
  "type": "gateway",
  "onSuccess": { "flowNodes": ["task-2", "task-3"], "mode": "end" }
}
```

Incoming branches are nodes naming the Gateway as successor. It has no description, settings,
chat handoff or compaction. Its panel multi-select removes branches; drawing a canvas chain
adds one. Each outgoing branch has an arrow and runs independently. A Gateway with no outgoing
branches still joins its incoming branches. Start and Stop for it belong to the runs panel.
