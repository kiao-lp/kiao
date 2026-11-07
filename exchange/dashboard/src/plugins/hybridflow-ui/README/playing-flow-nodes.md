---
status: DRAFT
role: PRIMARY_SOURCE
---

# Playing flow nodes

[Board guide](../README.md) · [Settings](settings.md) · [On success](on-success.md)

The hybridflow-runner in worker owns execution: read the board, send a task prompt, record
status and chat, then follow successors. Dashboard starts named runs, displays reported state
and requests Stop. Closing the board or browser does not stop a run; the runner machine must
remain available.

Multiple runs may execute concurrently, even on one board. A second run cannot take a node
already held by another; a chain reaching it stops and names its owner.

An eligible AI or Scheduler node offers Play. Pressing it asks for a run name, prefilled from
the start time, such as `Started 4 Sep 13:22`. That name identifies the run in panels, notices
and card tooltips. The active node offers its run's Stop. Shutdown and Gateway are reached
through chains and controlled from the runs panel.

## The chain runs panel

The Chain runs tab is available across documents. It lists live and recently ended runs,
with a tree of played, current and anticipated nodes. The service supplies that chain from
the latest board; the panel need not open the board itself. The anticipated tail can change
at every step.

| Action | Behavior |
| --- | --- |
| Stop | End a live chain after the active agent turn; cancel an idle wait immediately |
| Resume | Continue a run suspended by stopping its chat turn |
| Restart | Restart an ended run from its original node, retaining its name and list position |
| Forget | Remove an ended run; refused while active |

The run name opens its board; its speech bubble opens the current conversation. Ended runs
retain their last reported explanation. All execution messages come from the runner.

## Prompts, images and synchronization

The prompt uses the description, or the title if no description, plus any success criteria.
A title is not added beside a nonempty description. Complexity and execution settings are not
prompt text. Templates have already been instantiated in the editor. An AI node with no title,
description or criterion cannot play and ends a chain that reaches it.

Images linked in the body accompany the first turn as notes giving their actual absolute
paths (`flow_node_images.go`). Markdown images count, as do ordinary links with image
extensions. Relative links resolve against the **board's folder**, independently of the task's
working directory. Files are not copied, so the agent can inspect or change the stored image.
Missing images are reported but do not stop execution.

Playing preserves task text and position; output belongs in the conversation. Every step
rereads the board and finds nodes by stable ID. Field-level writes preserve unrelated edits;
Dashboard merges watched revisions and responds to `documentAt` notifications without closing
the selected editor. See [board synchronization](../README.md#two-writers-one-board).

The service rechecks eligibility independently of buttons: AI needs all four settings and a
prompt, Scheduler needs valid timing, and archived nodes never run. Human, Note and Value are
not runnable. Shutdown and Gateway run without an agent turn. Replaying a task uses its existing
chat and records `running` before sending anything.

## Stop and resume

**Board Stop ends the chain after the current turn.** It lets agent work finish and record its
result, then starts no successor. During retry, usage or Scheduler waits it cancels immediately.

**Chat Stop interrupts the turn and suspends the chain.** The node becomes `interrupted`; the
run retains its node and chat for resumption. The next message in that conversation asks once
whether to continue the board. Yes uses that message as the task's new turn and resumes the
chain; No releases the run and leaves an ordinary conversation. The runs panel also offers
Resume. An aborted turn caused by Chat Stop keeps this behavior rather than entering retries.

## Errors and retries

The runner inspects reply text as well as process exit state: a CLI may report an API failure
as a normal reply with a successful exit. Error notices can occur at the head or in the last
text block after partial work. Detection requires a short block beginning with a recognized
notice, so an ordinary answer discussing errors is not treated as one.

| Failure | Response |
| --- | --- |
| Overloaded API or dropped connection | Wait 20 minutes and retry the same task in the same chat, up to three retries |
| Usage limit | Wait for the reset and resume interrupted work; see below |
| Login, credit, excessive prompt, unavailable model or unknown error | Mark error and stop |
| Empty reply with failed process exit | Mark error and stop |
| Quiet reply with clean exit | Accept normally |

During retry waits the UI shows a clock and retry time. After four failed attempts in total,
the run stops and reports the failure. Failed tasks do not compact, fork or start successors.
Partial work remains in the conversation, never in the task description.

## Permission and capability integration

Playback uses the task's explicit agent, effort, folder and permission. Available options are
per platform; a withdrawn mode is absent from the selector. For platforms offering these modes:

| Mode | Tool call behavior |
| --- | --- |
| `manual` | Wait for approval of every call |
| `manualLive` | Display the call and allow it when the live countdown expires unless denied |
| `bypassPermissions` | Execute without approval prompts |

The service owns the live countdown even without a connected browser.
`manualLiveCountdownSeconds` in `.kiao-config/conversations.json` defaults to 10 seconds;
the panel displays that deadline and allows Deny.

The board imports no other plugin. It consumes `chat.run`, `chat.show` and `chat.options`
through [capabilities](../../../kit/capabilities/index.ts), plus `tags.ui` for tags. The chat
plugin owns run state delivered on its socket. Missing capabilities provide the kit's no-op
behavior: no Play or chain knob and empty options. `chatEnabled: false` also hides execution
controls while retaining status for manually managed work.

## What an AI card spent

The expanded editor reads aggregate cost and input/output tokens when opened and when selecting
another task. Tooltips include cache, reasoning and report counts. Unpriced reports mean cost
unknown, not free; no reports means no recorded spend, distinct from a failed read.

## Waiting for a usage limit

Reset detection supports an epoch, a CLI's zoned local reset time, an ISO timestamp, and API
`retry-after` durations or HTTP dates. The run waits until the reset **plus one minute**.
A bare limit notice uses account quota: all exhausted windows must reopen; near-full windows
are a fallback if none reports exhaustion. Expired resets are ignored and monthly windows
are supported. Without a usable reset, the wait is 20 minutes.

The persisted node status is `waiting-refresh`; the run reports `refreshing`. Stop cancels
the wait and leaves the node `interrupted`. Cards, usage gauges and conversation notices show
full local datetimes in the browser's locale and timezone, including today. Gauges show the
provider reset; cards show the resume time with its extra minute.

After waiting, the runner sends:

> You have been interrupted, please resume cleanly

It does not resend the task or image notes, because the conversation already holds the work
and attachments. That resumed turn supplies the task's answer. Repeated limits remain bounded
by four attempts in total.

## Structured data

An AI task's **Output type** selects a JSON Schema value from any board. The prompt requests
matching JSON in exactly one fenced `output` block in the final message. A missing or invalid
export marks the task as error and stops the chain; the editor shows the last export under
**Output**.

A successor description can use `{{input}}` for the entire export or `{{input.message}}` for
a field. Nested paths and numeric array indices work; a missing field stops execution before
sending a turn. Saved descriptions retain placeholders. Data passes independently of chat
handoff, through Schedulers, and through Gateway joins as an array in board order, for example
`{{input.0.message}}`.
