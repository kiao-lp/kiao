---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Playing a board

← [worker](/operation/worker/README.md) · assumes [Conversations and turns](/operation/worker/docs/solution-design/conversations.md).

**Playing a board** is owned by `hybridflow-runner/playback`. A board is rows in the
hybridflow-store, reached through `boards.BoardStore`; a **chain run** plays one of its
flow nodes and then whatever that flow node names after it, filing the agent's answer under
each flow node and marking it. The worker owns the loop, so it continues with no browser connected.

## Playback responsibilities

All files below belong to `internal/hybridflow-runner/playback/`. They share the runner's
dependencies and state within one package, keeping transitions and the lock protocol private.

| File | Owns |
| --- | --- |
| `chain_runner.go` | Dependencies, run registry, Play/Stop/Resume/Restart/Forget and conversation lifecycle callbacks. |
| `chain_state.go` | Shared `ChainRun` state, snapshots, wake signal, notifications and state transitions. |
| `chain_run.go` | One execution's context and completion channel, the loop cursor, retry budget, visited cards and dispatch by card type. |
| `chain_successor.go` | Fresh successor selection, post-success compaction and conversation handover. |
| `chain_ai.go` | Agent and input preparation, AI attempts, blocked-conversation recovery and common result handling. |
| `chain_automatic.go` | Scheduler waits and machine shutdown. |
| `chain_gateway.go` | Last-arrival joins, gateway claims and independent branch runs. |
| `chain_retry.go` | Retry limits, quota reset selection, wait state and prompt mode after a wait. |
| `chain_conversations.go` | Turn submission/attachment and settlement through `TurnExecutor`, transcript reads, conversation creation/forks and compaction. |
| `chain_boards.go` | Board reads and writes, stale-claim recovery, status marks and output contracts. |
| `chain_agents.go`, `chain_run_log.go` | Agent/runner resolution and refusal rules; durable run logs. |

The loop handles five results explicitly: `RoundOn` records the completed card and prepares
its successor; `roundAgain` waits within the retry budget; `roundSuspend` preserves the
card and chat for Resume; `roundStop` releases the claim and ends; `roundPowerOff` ends and
requests shutdown. AI attempts and blocked forks share fault interpretation, structured
output validation and completion marks. Interruption takes precedence over fault and
output interpretation.

`ChainRunner.Mu` protects the registry and mutable `ChainRun` state. Each loop alone owns
its cursor, prompt mode, retry count and visited set. `startLocked` captures a `runExecution`
under that lock, including its own `Done` channel. Resume and Restart wait for the previous
execution outside the lock, then recheck registry membership, state and execution identity
before activating the run. A terminal snapshot can therefore be published while the old
loop finishes its notifications, without allowing a new loop to reuse its state yet.

The wake signal has its own mutex; code acquiring both takes the runner lock first.
Stop wakes waits and lets a running turn settle. Abandon cancels the execution and waits
for it to leave. Board I/O and turn execution run outside the runner lock. `BoardStore`
owns atomic claims and card updates; only snapshot bookkeeping takes the runner lock
after a write. Run-log completion is persisted under the runner lock before `ended` is
visible to readers. Harness execution remains behind `TurnExecutor`, and the upstream
client and spool remain in `boards`.

## Card execution

A card is **typed**, and its type is what playing it means: an *AI* card is a turn, a *Human* one is
nobody's to play. A *Gateway* joins incoming branches and starts outgoing ones, a *Shutdown*
turns the machine off, and a *Scheduler* holds for its duration or datetime and then lets the
chain carry on. These automatic cards are marked like any other, taken and then done, because the board
is the record of where the work stands whoever did it.

**Several runs play at once**, and each is **named** by whoever started it — two boards side by side,
or two chains of one board started from two cards. One rule keeps them apart: a card is played by one
run (a second play on it is refused, and a chain walking into one ends there). The marks themselves
never collide — each is a named operation on one card and one field of it — so two runs marking two
cards of one board never queue behind each other. A run **stays in the
list once it has ended**, saying so and saying why, until it is restarted or forgotten — that is what
the chain runs panel offers a Restart on. The list reaches every open socket as a `chainRun` frame, and
`hello` carries it, so a tab that connects mid-run draws the board correctly without polling. Six
endpoints (`GET /hybridflow-runner/chain-runs`, `play`, `stop`, `resume`, `restart`, `forget`); every one but the
first names its run by id.

The run reads the board afresh at every step and finds its flow node by id: a turn lasts minutes
and the board is live throughout, so nothing is carried across a wait but ids. A reply is read
*before* it is filed (`hybridflow-runner/harnesses/faults/chain_run_fault.go`), because the CLI writes an API error where the
answer would go and ends the turn normally — filed as an answer, that sentence would mark a flow
node done by the one thing saying it was not. An error that passes (overloaded, a connection that
dropped) is waited out for 20 minutes and sent again, up to three times; the rest mark the flow node
and stop the run.

**A usage limit is a clock rather than a failure**, and is the one error waited out on its own
terms.
Its notice says when it lifts — `Claude AI usage limit reached|1750000000`, `resets 7:10pm
(Europe/Paris)`, Muse's `resets at 2026-10-23T09:59:32Z`, a `429`'s `retry-after` — so the run reads that moment and holds the flow node
until it, plus a minute; the twenty-minute wait would spend all four tries inside the first hour of
a five-hour window. The flow node is marked `waiting-refresh` in the document and the run reports
itself `refreshing`, because hours of `running` is a spinner over a card nothing is happening to.
What goes in when the limit lifts is **not the flow node again** but `You have been interrupted,
please resume cleanly`: the turn that met the limit had usually been working, its conversation still
holds all of it, and the answer to that word is filed under the flow node as the play's one answer.

Reset notices are stored as absolute timestamps and displayed in the browser's locale and timezone,
with the weekday, date and time on cards, usage gauges and conversation notices. When no notice
gives a reset, the run reads the
agent's quota and waits for the last exhausted window to reopen. Expired observations are ignored;
near-full windows are only a fallback when none reports exhaustion. Monthly windows are supported
within a 32-day sanity bound. If no reset can be determined, the run waits twenty minutes.

**A flow node's images travel with it** (`hybridflow-runner/boards/flow_node_images.go`). A body is markdown, so a
picture in one is a file of the store it links — a screenshot pasted into the flow node, an image
dragged in from the tree — and the prompt is text on a pipe, so the run appends a note giving each
file's absolute path, the way an attachment is named. The links are read from the store root rather
than against the one the turn runs in, and nothing is copied: the file is named where the
store really keeps it, because the turn is working in that store. A link that resolves to nothing is
said out loud and does not stop the play — unlike a missing attachment, which refuses the turn.

Stopping the *turn* from its chat stops the run and **keeps** it: interrupting a turn is the plainest
way of saying the run is not going as it should, and the next message said in that chat is offered as
the way to pick the whole chain back up (`resume`, which attaches to the turn that message starts).
The board's own Stop is the other one: the turn under way finishes and is filed like any other, and
nothing after it is started.

**Every harness reports its consumption on the AI card.** Turn settlement queues one usage
report, including failed or interrupted turns with observed usage, independently of the play loop.
No reported usage means unknown; an unpriced report stays unpriced. Input and output are full
totals: cache reads/writes are included in input, and reasoning is included in output.

The [board spool](/docs/solution-design/partitions/hybridflow/interactions.md) confirms a
queued write only after its disk save succeeds. Failed saves leave the queue and optimistic
cache unchanged and return an error. The play loop propagates marking errors; reclaiming an
orphaned card also propagates a failed `SettleRun` enqueue. Turn settlement logs a failed
usage enqueue. Once persisted, reports retain their ids through retries and restarts, including
when delivery succeeds but saving the reduced queue fails.

| Harness | Mapping |
| --- | --- |
| Claude Code | Sum `modelUsage` across models, including subagents. Add cache reads and writes to Claude's uncached input. CLI versions before 2.1.277 report process totals; newer versions restore session totals, so the driver subtracts its saved baseline. Without a baseline, use current-turn counters and reported child usage. Streaming counters retain observed usage when a process fails before its result. |
| Pi | Subtract the starting `get_session_stats` from the final snapshot, including tools, compactions and retries. Add both cache counters to Pi's uncached input. Completed-message usage provides a fallback if final stats cannot be read. |
| Codex | Keep `turn.completed.usage` input/output totals and map cache and reasoning breakdowns alongside them. |
| Muse | Sum each completion's counted-once `promptTokens` and output, preserving cache and reasoning. Include observed compaction usage, child snapshots once, later child updates during draining, and usage from native turns restarted after a blockage. |

When a report supplies a total without a complete split, retain the remainder as approximate input
tokens. Cache-only and reasoning-only reports still contribute to the input/output totals.
Claude's private `claude-usage/<session-id>.json` files under the worker state directory retain
the session baseline across worker restarts; they contain counters only.

The source contracts are [Claude's cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking),
[Pi's session statistics](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc-commands.md),
the [Codex stream](https://learn.chatgpt.com/docs/non-interactive-mode), and
[Muse's token notifications](https://meta-models.github.io/muse-code-sdk/next/generated/msp/notifications/session-tokenusage/).

A **Shutdown card** turns the machine off — `"type": "shutdown"`, and nothing else on the card: the
one thing a board does that reaches past the store (`hybridflow-runner/playback/shutdown.go`). It **ends the board**, and
that is why it names nothing after it: playing anything into a machine on its way down would be
starting work to abandon it. A chain that failed never reaches it, a card being played only when the
card before it was done, which is the point of putting one at the end of one.

It happens only where `KIAO_WORKER_SHUTDOWN_COMMAND` names a command — which `kiao` sets
and no other start does. Everywhere else the card is read, written, copied and *played*, and marked
`error`: it asked for something that did not happen, and `done` over a machine still running would be
the play claiming otherwise. A board travels between deployments, and a card dropped where it cannot
be honoured would be taken out of the document by the first save made there.

A **Scheduler card** holds until its `at` — a local `YYYY-MM-DDTHH:mm`, read in this process's own
location, because the machine that will be woken is the one whose clock decides — and then plays the
flow node it names. It reports itself as a run state of its own (`scheduled`), so a board says which
of its waits it is in; a datetime already past does not wait; and the board's Stop ends the wait
there and then, as it ends the twenty minutes between two tries.
