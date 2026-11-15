---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Chains and execution

Read to connect cards, choose conversation behavior, configure control cards or diagnose why
execution stops. For data passed across these links, read [structured data](structured-data.md).
For revisions and safe editing, read [operations](operations.md).

## Connections

Only explicit successor links define execution order. Dragging, grouping and tagging do not.

| Type | Incoming links | Outgoing links |
|---|---|---|
| AI, Human, Scheduler | At most one | At most one, in `onSuccess.flowNode` |
| Shutdown | At most one | None |
| Gateway | Several | Several, in `onSuccess.flowNodes` |
| Note, Value | None | None |

Targets must be different cards on the same board. Incoming links count Gateway branches and
links stored on archived cards. Unlink an occupied target before assigning another predecessor,
or insert a Gateway to join branches. Batch creation, patches and link operations enforce these
limits. The runner validates topology before Play, restart and resume; repair invalid legacy
chains before starting them. Self-links are refused; a run stops when it reaches a card it has
already played. Do not use cycles as a repeat mechanism.

`board_chain_card` changes links only and preserves conversation options. For an ordinary card,
`flowNode: ""` unlinks it. For a Gateway, a nonempty target adds one branch idempotently and an
empty target clears all branches. To remove just one branch, patch `onSuccess` with the complete
remaining `flowNodes` list. Patching `onSuccess` replaces the whole object: preserve its other
options. Classes link class ids instead of card ids; see [classes](classes.md).

## On success

```json
{"onSuccess":{"flowNode":"<successor-id>","mode":"continue","compact":true}}
```

| Key | Rule |
|---|---|
| `flowNode` | Single successor for tasks and Schedulers; empty ends the chain. |
| `flowNodes` | Gateway branches, in the listed launch order. Never use the singular field for a Gateway. |
| `mode` | AI only: `end` (default) or `continue`. |
| `compact` | AI only: shorten this card's conversation after success; default false. |

`end` hands on no conversation. The next AI task uses its existing conversation or a new one;
if its existing chat is the one just ended, execution creates a fresh one. `continue` forks the
preceding conversation for the next AI task, preserving the source card's independent chat.
The transcript travels; a compatible native harness session travels when supported. Both tasks
must name the same working folder. Different folders stop continuation; use `end` for that boundary.

Compaction happens before any fork and can also be requested on a final AI task with no successor.
Mode and compaction belong to the source card even when its link is removed. Legacy `mode:
"compact"` is read as continue plus compaction; new writes use the two separate fields.
Only AI cards have conversation options, and their execution settings must be complete.

Schedulers, Gateways, Shutdowns and Human tasks carry no AI conversation forward. A `continue`
link before one ends conversation continuity there. Structured data follows separate rules and
can cross waits and Gateways even with `end` or compaction.

A success link is reached only after completion, including any required export validation.
It is not a condition on the exported verdict: consumers must interpret business results.
An error or interruption prevents normal succession. The runner's retry policy can retry an
error; success links do not provide failure handlers or guaranteed cleanup.

## Human steps

Reaching a non-archived Human task sets it to `todo` and ends the current automatic run.
Dashboard's Work button opens its instructions, criteria and submission editor. Submit completes
the task and offers a Human successor as `todo`. When chat execution is available, Dashboard
also starts a ready, runnable automatic successor if no run already holds it; otherwise start
that successor with Play. Configure the intended successor in advance. Output validation and
preserving earlier results are covered in [structured data](structured-data.md#human-results).

## Schedulers

A Scheduler waits once, then follows its successor. Choose exactly one mode:

```json
{"title":"Pause","type":"scheduler","duration":"15m"}
```

```json
{"title":"Tonight","type":"scheduler","at":"2026-11-20T22:00"}
```

- `duration` counts from each play: positive `h`, `m`, `s` or `ms` components, including `1h30m`.
  Zero, negative and malformed waits are refused.
- `at` is `YYYY-MM-DDTHH:mm`, without seconds or zone, on the runner machine's local clock.
  A past datetime continues immediately.
- Setting one field nonempty clears the other. Sending both nonempty is refused; clearing both
  leaves the card incomplete. These rules also apply to class presets.
- Play starts the wait, from the small button beside the clock or through a predecessor. Only a
  configured, `ready` Scheduler offers Play. Its title is edited in the panel and hidden on the canvas.
- The Scheduler is `running` while waiting and `done` when the wait finishes. Stop cancels the
  wait and leaves its successor unplayed. It has no task settings or conversation.

## Gateways

```json
{"title":"Both done?","type":"gateway","onSuccess":{"flowNodes":["<left-id>","<right-id>"]}}
```

Every card naming the Gateway is an incoming branch. The Gateway fires only when all incoming
branches are `done`. An arrival before that ends its run and leaves the Gateway untouched;
the last arrival fires it. Direct Play while branches remain unfinished is refused and names them.
This is an AND join, without conditional selection. A failed branch holds the join until resolved.

Firing starts every outgoing branch in parallel as a separate run and ends the arriving run.
Each AI branch uses its own conversation. A Gateway with no outgoing branches simply finishes;
with no incoming branches it can act as a split. It needs no task settings, description or mode,
and it has no node class. For the order and shape of joined results, read
[structured data](structured-data.md#data-across-control-cards).

## Shutdown

```json
{"title":"Good night","type":"shutdown"}
```

Shutdown turns off the runner machine and ends the chain. It has no options, task fields or
successor. Put it after successful work by linking its predecessor to it; keep explanatory
text in a Note. A failed or interrupted earlier step never reaches Shutdown and leaves the
machine on.

The runner needs `KIAO_WORKER_SHUTDOWN_COMMAND`; blank makes Shutdown fail with `error`.
The installed executable supplies a default that the environment can override or clear.

## What a play writes

The runner claims a card, assigns its `run`, sets `running` and clears old output. It creates or
selects an AI conversation and records `chat` before sending the prompt. Success stores validated
output and `done`; failure records `error`, while a stopped or abandoned run leaves `interrupted`.
Instructions and positions remain unchanged. Never simulate these writes through a card patch.

A chain stops when its successor is absent, archived, incomplete, empty of work, held by another
run, pinned to another runner, or already played by that run. A runner pin is not an automatic
cross-machine dispatch. Human steps and Gateway arrivals have the boundary behavior described
above. Read current cards and runner notices to distinguish these outcomes.
