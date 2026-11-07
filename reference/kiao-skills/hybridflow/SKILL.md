---
name: hybridflow
description: Read and edit hybridflow boards, flow nodes, tasks, agents, runners, reusable classes and workflows. Use when configuring task chains, JSON Schema values, structured outputs or predecessor inputs, or when asked to edit a legacy .workflow.json board. Boards live behind an API; prefer the kiao-hybridflow MCP tools and use HTTP only when they are unavailable.
---

# Hybridflow — A Board Behind an API

A **board** is a row in a database, reached from the **hybridflow-store**. Its flow nodes have
stable ids and positions; `onSuccess` links define execution order. A **task** is an AI card
or a Human card. Notes and values display content and are never played.

**A board is not a file.** Nothing reads a board out of one, anywhere. **Do not write a
`.workflow.json` to make a card**: nothing would show it, and the board the user is looking at
would not change.

```
/boards/major              the board, on its boards page
```

## Connection limits

AI and Human tasks and Schedulers have at most one predecessor and one successor. Shutdown has
at most one predecessor and no successor. Gateways allow several predecessors and successors:
use a Gateway to join or split branches. Notes and values have no links. Incoming links include
Gateway branches. An occupied task, Scheduler or Shutdown cannot receive another link, including
from an archived card whose link is still stored. Remove the old link first. The runner validates a chain before Play,
restart and resume; an invalid legacy chain must be repaired before it can start.

## If the MCP tools are here, use them

When `board_get` is in the tool list, the `kiao-hybridflow` server is the way to change a board —
it reaches the store through the worker, which records the turn's owner as the actor, so there is
no address to name and no token to send. The tools cover the whole store:

- Boards: `board_list`, `board_create`, `board_get`, `board_patch`, `board_delete`.
- Cards: `board_add_cards`, `board_get_card`, `board_patch_card`, `board_delete_cards`,
  `board_chain_card`, `board_card_usage`, `board_card_to_class`.
- Classes: `class_list`, `class_create`, `class_get`, `class_patch`, `class_delete`, `class_chain`,
  `class_create_version`, `class_patch_version`, `class_delete_version`, `class_instantiate`.
- Workflows: `workflow_create`, `workflow_get`, `workflow_patch`, `workflow_delete`,
  `workflow_class_list`, `workflow_class_create`, `workflow_class_get`, `workflow_class_patch`,
  `workflow_class_delete`, `workflow_class_instantiate`.
- Agents: `agent_list`, `agent_create`, `agent_get`, `agent_patch`, `agent_publish`,
  `agent_versions`, `agent_delete`.
- Runners: `runner_list`, `runner_create`, `runner_get`, `runner_patch`, `runner_delete`.
- Watching: `board_changes`. The ledger: `hybridflow_schema`.
- Output types: `board_schema_values` lists JSON Schema values from every board.

**Read before changing**: card ids, spots and revisions all come from `board_get`'s answer.

The tool descriptions carry the per-field rules. What they assume you know:

- Read `agent_list` before choosing an agent id, using the published `description` for selection.
  Selection descriptions are separate from standing `instructions` and never sent to turns.
- Agent creation and configuration patches edit a draft. Call `agent_publish` explicitly before
  using a new configuration. Existing conversations keep their captured publication. Only active,
  published agents can start new task conversations; archive published agents instead of deleting
  them. Profiles, publication history and HTTP calls are in
  [references/cards.md](references/cards.md#agents).
- `settings` and `tags` are whole replacements: read the card, change one key, send all of them back.
- `ifMatch` is the revision the read reported: send it whenever you read a card, thought about
  it, and are writing it back — the write lands on it or comes back `409`.
- Only a `ready` card is played. To offer a card a turn, set it `ready` and leave it to the Play
  button — there is no play tool, and playing one by hand is the runner's alone.

For the field semantics behind the descriptions — types, settings, status, tags — read
[references/cards.md](references/cards.md); for chains and the types the board plays to itself,
[references/chains.md](references/chains.md); for reusable cards and the rectangles round them,
[references/classes.md](references/classes.md).

## Structured task data

To pass JSON between tasks, select a schema with the producer's `outputType`, export exactly
one fenced `output` block in its final message, and use `{{input.field}}` in the successor's
prompt. This works with `onSuccess.mode: "end"`; conversation handover is independent.

Read [references/structured-data.md](references/structured-data.md) before configuring this:
it distinguishes a value's `valueType` from a task's `outputType`, shows the MCP calls, and
covers validation, input paths, joins and output lifetime. A Human task exports from the
Dashboard WorkOnTask panel, not from a fenced block.

## Schedulers

A Scheduler (`type: "scheduler"`) can start a chain from the small Play beside its clock on the
Dashboard, or be reached through `onSuccess`. Its name stays in the editor and is hidden on the
board. Only a configured, `ready` Scheduler offers Play; Stop cancels its wait.

Choose exactly one mode on cards and classes:

- **Fixed duration**: `duration: "15m"` waits fifteen minutes from each play. Use positive `h`,
  `m`, `s` or `ms` components, such as `"1h30m"` or `"30s"`.
- **Date time**: `at: "2026-10-16T22:00"` waits until that local wall clock on the runner machine,
  with no timezone. A datetime already past continues immediately.

```json
{ "title": "Pause", "type": "scheduler", "duration": "15m" }
```

```json
{ "title": "Tonight", "type": "scheduler", "at": "2026-10-16T22:00" }
```

Use `board_add_cards` / `board_patch_card`, or `class_create` / `class_patch` for reusable presets.
Setting a nonempty `duration` clears `at`, and setting a nonempty `at` clears `duration`; sending
both nonempty is refused. Empty strings clear either field. Without a valid wait the Scheduler
cannot play. Add `onSuccess.flowNode` to name what runs when the wait completes. MCP configures
Schedulers; starting their play remains the Dashboard runner's action.

## If they are not, read the references

No `board_get` in the tool list means no MCP server, and the boards are reached over HTTP. Read
what the work needs — the transport first, then the semantics:

| File | Holds |
|------|-------|
| [references/api-curl.md](references/api-curl.md) | Reaching the store, the `curl` preamble, writing, watching, every recipe, and each tool's call. |
| [references/cards.md](references/cards.md) | Card fields, the seven types, agents, runners, settings, copy and paste, templates, mistakes. |
| [references/structured-data.md](references/structured-data.md) | JSON Schema values, task exports, predecessor inputs, validation and joins. |
| [references/chains.md](references/chains.md) | `onSuccess`, shutdown, scheduler, gateway, and what a play writes onto a card. |
| [references/classes.md](references/classes.md) | Node classes, versions, instantiation, workflows and workflow classes. |

When the store variables are not set either, there are no boards to edit: say so and stop. The
thing not to do is write a file instead.

## Either way

- Read the board before changing it. A write that guessed an id, a spot or a revision does nothing
  or does it somewhere else.
- Never write `running` or `waiting-refresh` by hand, and never call the runner's routes (`/play`,
  `/played`, `/settle`). Those say a run holds the card, and a card left saying so with no run
  behind it is stuck.
- Ask before deleting a card, a class, or an agent. There is no undo, and a chain naming a deleted card points at nothing.
