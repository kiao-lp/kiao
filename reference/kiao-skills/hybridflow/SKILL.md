---
name: hybridflow
description: This skill should be used when the user asks to "add a flow node to the board", "add a task to the board", "move a flow node", "place a flow node", "make a flow node playable by an agent", "make a flow node an AI one or a human one", "set a flow node's type", "set a flow node's agent or effort", "manage the agents", "create an agent", "manage the runners", "file a class", "instantiate a class", "write a board", "edit a board", "list the boards", "read a board", or works with boards, flow nodes, tasks, workflow documents, or a `.workflow.json` file. A **task** is a flow node that is work somebody does — an AI card or a Human one. Prefer the kiao-hybridflow MCP tools when they are available; only without them, read the bundled references and reach the boards over HTTP.
---

# Hybridflow — A Board Behind an API

A **board** is a row in a database, reached from the **hybridflow-store**. It holds one
list of flow nodes, each with an id of its own. Each card sits at a point somebody put it, and names
the card played after it: the chain is the whole of the order a board has.

**A board is not a file.** Nothing reads a board out of one, anywhere. **Do not write a
`.workflow.json` to make a card**: nothing would show it, and the board the user is looking at
would not change.

```
/boards/major              the board, on its boards page
```

## Connection limits

AI and Human tasks and Schedulers have at most one predecessor and one successor. Shutdown has
at most one predecessor and no successor. Gateways allow several predecessors and successors:
use a Gateway to join or split branches. Incoming links include Gateway branches. An occupied
task, Scheduler or Shutdown cannot receive another link, including from an archived card whose
link is still stored. Remove the old link first. The runner validates a chain before Play,
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
- Agents and runners: `agent_list`, `agent_create`, `agent_get`, `agent_patch`, `agent_publish`, `agent_versions`, `agent_delete`,
  `runner_list`, `runner_create`, `runner_get`, `runner_patch`, `runner_delete`.
- Watching: `board_changes`. The ledger: `hybridflow_schema`.

**Read before changing**: card ids, spots and revisions all come from `board_get`'s answer.

The tool descriptions carry the per-field rules. What they assume you know:

- An agent's `description` says when to choose it for a task. Read the descriptions from
  `agent_list` before picking an agent id, using the published description where one exists. Keep this selection guidance separate from
  `instructions`: descriptions are never sent to the agent's turns. `agent_create` and
  `agent_patch` accept `description`; an empty string clears it.
- Agent creation and configuration patches edit an unpublished draft. Call `agent_publish`
  explicitly to append an immutable numbered version; send the revision as `ifMatch` when known.
  New task conversations capture the latest publication and retain its model, profile reference
  and standing instructions on replay, retries and manual messages. Later draft edits and
  publications do not change an existing conversation. `agent_versions` reads the full history.
- Archive an agent with `agent_patch` and `patch: { archived: true }`; restore it with `false`.
  `agent_list` hides archives unless asked for `archived: true`. Archived agents and agents with
  no publication cannot start new task conversations. Published agents cannot be deleted: archive
  them to retain the configuration history. Their saved platform and model remain readable even
  when adapters no longer list them.
  Without MCP, publish with `POST /agents/{id}/publish`, read history with
  `GET /agents/{id}/versions`, and archive with `PATCH /agents/{id}` and `{"archived":true}`.
  `GET /agents?archived=true` includes archives. These calls use the same HTTP preamble as boards.
- `settings` and `tags` are whole replacements: read the card, change one key, send all of them back.
- `ifMatch` is the revision the read reported: send it whenever you read a card, thought about
  it, and are writing it back — the write lands on it or comes back `409`.
- Only a `ready` card is played. To offer a card a turn, set it `ready` and leave it to the Play
  button — there is no play tool, and playing one by hand is the runner's alone.

For the field semantics behind the descriptions — types, settings, status, tags — read
[references/cards.md](references/cards.md); for chains and the types the board plays to itself,
[references/chains.md](references/chains.md); for reusable cards and the rectangles round them,
[references/classes.md](references/classes.md).

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
| [references/cards.md](references/cards.md) | Every field of a card, the five types, agents, runners, settings, copy and paste, templates, mistakes. |
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
