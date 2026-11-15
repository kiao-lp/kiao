---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Cards

Read when creating or configuring cards. These are shared field semantics for MCP and HTTP.
For editing rules, read [operations](operations.md); for control flow, read [chains](chains.md).

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable UUID, minted on creation unless supplied for batch references. |
| `title` | Card name. For an AI prompt, used only when `body` is empty. |
| `type` | `human`, `ai`, `shutdown`, `scheduler`, `gateway`, `note` or `value`. Write it explicitly. |
| `note` | Markdown displayed by a Note, including links. |
| `value`, `valueType` | Value payload and optional type; see [structured data](structured-data.md). |
| `body` | Task description in Markdown. |
| `criteria` | Task success criteria: `[{"id":"…","text":"…"}]`. Creation mints missing criterion ids. |
| `complexity` | Optional task estimate: `1`, `2`, `3`, `5`, `8`, `13` or `21`. Informational; never sent in the prompt. |
| `settings` | Task execution configuration; see [settings](#settings). |
| `outputType`, `output` | Task export schema and read-only last result; see [structured data](structured-data.md). |
| `at`, `duration` | Alternative Scheduler waits; see [Schedulers](chains.md#schedulers). |
| `spot` | Position on this board's canvas; see [placement](#placement). |
| `tags` | Array of plain words; see [tags](#tags). |
| `status`, `chat` | Work state and AI conversation; see [status and chat](#status-and-chat). |
| `archived` | Boolean, false by default. Hides the card and its links; stored links still count toward topology limits. |
| `onSuccess` | Successor links and AI conversation options; see [chains](chains.md). |
| `workflow` | This board's workflow group id, or empty for none. |
| `classVersion` | Read response: `{classId, classTitle, versionId, versionNumber}`. Patch with a version id to rebind, or `""` to detach; see [classes](classes.md). |
| `run` | Read-only id of the run holding the card, or empty. |
| `revision` | Read-only revision for conditional writes; see [operations](operations.md). |

## Flow node type

**Task** means AI or Human. **Flow node** or **card** includes all seven types.

| Type | Fields specific to that type |
|---|---|
| `human` | `title`, `body`, `criteria`, optional `complexity`, `settings.folder`, optional `outputType`, single successor. Work and submission happen in Dashboard. |
| `ai` | Task fields, plus complete AI `settings`, conversation options and optional `outputType`. |
| `shutdown` | Title, tags, status and position. No task fields or successor. |
| `scheduler` | Title, tags, status, position, exactly one of `at` and `duration`, single successor. |
| `gateway` | Title, tags, status, position and `onSuccess.flowNodes` branches. |
| `note` | `note` and position. The editor has no title, tags or status controls. |
| `value` | `title`, `value`, optional `valueType` and position. |

Fields unsupported by a type are normalized away or refused. In particular, control cards
have no task description, criteria, complexity, settings or conversation. Only AI cards use
conversation options. Notes and Values cannot be played or linked. Old cards can infer AI from
an agent setting and otherwise Human; new writes should always state the type.

## Task instructions

An AI prompt contains `body` (or `title` when no body exists) and all success criteria. The
title is never added beside a body. A task needs at least one of a title, body or criterion
to be playable. Prefer a title naming the work and a body describing the request. Input
interpolation and export instructions are described in [structured data](structured-data.md).

Descriptions and criteria stay on the card after success, error or interruption. Replaying
an AI card reuses its conversation unless execution creates or assigns another one. To ask a
follow-up, update its body if needed and return it to `ready`.

Write image and document links from the store root, with a leading slash. A card has no
document folder against which relative Markdown links could resolve. Pasted screenshots are
stored under `/boards/<slug>/`; the runner tells the agent where linked image files can be read.
Description templates are applied by the editor, not by execution; see [templates](reuse/templates.md).

## Settings

```json
{"agent":"<managed-agent-id>","effort":"high","permission":"bypassPermissions","folder":"/"}
```

| Key | Rule |
|---|---|
| `agent` | Required for AI: managed agent **id**. Select an active published agent using its published description; see [agents](execution/agents.md). |
| `effort` | Required for AI, using that agent harness's vocabulary. |
| `permission` | Required for AI, using that harness's supported permission modes. |
| `folder` | Required for AI; also records the work location for Human tasks. Store link with a leading slash, `/` for the root. |
| `runner` | Optional AI runner id. Without one, work executes where Play is pressed; see [runners](execution/runners.md). |
| `extra` | Preserved extension settings, as string key/value pairs. |

All four AI settings are explicit; deployment defaults do not supply missing values. `settings`
is replaced whole, including `runner` and `extra`. A conversation retains its original folder.
Conversation continuation requires matching folders; see [chains](chains.md).

Harness choices determine effort and permissions. Typical efforts include `low`, `medium`,
`high`, `xhigh` and `max`; typical permission modes include `manual`, `manualLive` and
`bypassPermissions`. Codex offers `bypassPermissions` only. The current harness
lists are authoritative; incompatible or unavailable settings fail at execution validation.
Legacy cards may read a harness name and `model` in settings. New writes select a managed agent
and keep its model on the agent, not the card.

## Status and chat

| Status | Meaning |
|---|---|
| `draft` | Being authored, unavailable for Play. |
| `ready` | Offered for Play when configuration is complete. |
| `todo` | Human work awaiting attention; Dashboard labels it To do. |
| `blocked` | Explicit external dependency; only an intentional status edit clears it. |
| `running` | Execution in progress: held by a run, or Human work opened in WorkOnTask. |
| `waiting-refresh` | A run retains the card while an agent usage limit prevents progress. |
| `interrupted` | Execution was stopped before completion. |
| `done` | Successful completion, including any required output validation. |
| `error` | Execution or validation failed. Instructions remain available for retry. |

Play is offered on a configured `ready` execution card. To replay it, return it to `ready`.
Human work uses the Work button in `todo` or `running` and completes by submission. Do not
manufacture held states or completion: let the runner and Dashboard manage them.

`chat` is the AI conversation id assigned by execution. It persists across replays. Do not
patch a chat id: a missing conversation fails, and copying an id between cards can give them
the same transcript. [Chains](chains.md) describes deliberate conversation forking.

## Placement

`spot` is `{ "x": 320, "y": 160 }`, nonnegative integer pixels from the canvas's top left.
Omit it to let Dashboard place an unplaced card on its first render. If positioning manually,
allow approximately 260 pixels across and 160 down between cards to avoid overlap. Do not copy
coordinates to another board without considering its existing cards. Patch `spot` to move;
`clearSpot: true` clears it. Placement changes no execution order.

## Tags

`tags` contains words, never ids or objects. Words are trimmed, inner whitespace is collapsed,
and duplicates are removed case-insensitively. Prefer existing spelling. Unknown tags are valid
and appear neutral grey. The store's `kiao-user-config/tags.json` assigns colors; change it only
when requested. Tags describe the work and have no execution effect. Replace the list whole;
an empty list removes all tags.
