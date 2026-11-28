---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Playing a board

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes [conversations](/operation/worker/PROTOCOL/conversations.md) and [socket frames](/operation/worker/PROTOCOL/socket-frames.md).

A **board** is rows in the hybridflow-store, reached over HTTP; a **chain run** plays one of
its flow nodes and then whatever that flow node names after it, filing what the agent said under
each flow node and marking it. A run is this service's — it keeps going with no browser connected,
which is the whole point of it living here — and **several play at once**: two boards side by
side, or two chains of one board started from two flow nodes.

Each carries a **name**, which the client asks its user for at the click and which is the only thing
telling two runs of one board apart; the flow node it was **started on**, so it can be played again; and
the **chain it has walked** — the flow nodes played, the flow node it is on, and the flow nodes ahead of it along
the `onSuccess` links, each with the title and status the board holds. A run **stays in the list once
it has ended**, saying so and saying why, until it is restarted or forgotten: a panel offers a
Restart on a finished run, and a run that vanished when it stopped could not be offered one.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/hybridflow-runner/chain-runs` | — | `{ runs: AgentChainRunDto[] }` |
| POST | `/hybridflow-runner/chain-runs/play` | `{ path, flowNodeId, name, afterPredecessor? }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/stop` | `{ runId }` | `204` |
| POST | `/hybridflow-runner/chain-runs/resume` | `{ runId, startTurn? }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/restart` | `{ runId }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/forget` | `{ runId }` | `204` |

The same handlers also serve `/hybridflow-runner/workflow-runs` and its operation paths
as compatibility aliases for HTTP clients.

Dashboard sets `afterPredecessor` when a Human task submission starts its successor. An automatic
arrival at a Done parallel gateway waits for every incoming branch to complete again. An explicit
Play or Restart of the gateway can use the current completed inputs.

`GET` is read **once**, at start-up: everything after it arrives as a `chainRun` frame, and `hello`
carries the runs too, so a tab that connects mid-run draws the board correctly without polling. The
list is oldest first, and it is always the *whole* list — a client merging deltas would be a second
place the truth lived.

**A flow node is played by one run.** `play` refuses (`409`) a flow node another run is holding, naming that
run, and a chain walking into one ends there and says the same thing: two turns would file two
answers under one flow node, and the second would be written over the first. Nothing else about a
second run is refused, and starting one stops nothing. The marks themselves never collide: each is
a named operation on one flow node and one field of it, so two runs marking two flow nodes of one board never
queue behind each other.

An empty `name` is named by the service after the moment the run starts — the box a client offers is
prefilled with the same sentence, so clearing it is not a way of having no name.

`play` names the board by its handle — the slug the browser has it open at — and refuses (`503`)
where no hybridflow-store is configured, (`404`) a board the store does not hold, and (`404`) a
flow node the board does not hold. An *AI* flow node requires `agent`, `effort`, `permission` and
`folder` settings. The runner resolves harness and model settings from the agent's publication
and the task's selection. Legacy flow nodes may name a harness directly and supply `model`.
The `agent` setting is required in both forms.
A *Human*, *Note* or *Value* flow node is not executable. A *Shutdown* turns the machine off and ends
the run; a *Scheduler* waits until its `at` datetime before continuing. A *Gateway* waits for its
incoming branches and starts its outgoing branches. These control flow nodes run without an agent turn.

Each runner checks that the selected harness is available locally and supports the requested
permission mode. It refuses Play with a message identifying the unavailable harness or mode.
At creation, the task conversation captures the agent publication and selected harness.

Configured flow nodes in Ready or Done can start or continue a chain. Interrupted AI tasks can resume in
their linked conversation. Play reactivates a matching suspended run when the runner still holds
it. On replay, each completed AI flow node gets a new conversation and its `chat` field points to that
conversation. A Continue link can fork the current run's predecessor conversation. Earlier transcripts
remain available in Conversations.

`stop` means the same thing in three situations, and none of them touches the running turn: a run
playing keeps its turn — the turn is the user's to interrupt, from the chat, and ending it from here
would kill work already done — so the flow node under way is filed and marked like any other and
nothing after it is started; a run *waiting* has nothing to let finish and ends at once, whether it
was waiting to try a flow node again, holding for a usage limit to lift or holding on a Scheduler's
datetime; and a suspended run ends where it stands, which is what answering *no* to the resume
question means. The run stays in the list in every case, marked `ended` with `endedAt` and the
sentence it stopped on.

`resume` picks up a suspended run on the interrupted task and marks it running. With
`startTurn: true`, it starts a continuation turn immediately. Otherwise it waits up to 30 seconds
for a separate turn before starting one itself. A stale run or a changed task or conversation
returns `409`. Dashboard sends a socket prompt with `resumeRunId` to use a specific message as the
task's next turn. The chain continues when that turn succeeds.

`restart` (`409` while the run is still playing) plays an ended run again **from the flow node it was
started on**, keeping its id, its name and its place in the list; the trail is dropped and the chain
followed afresh. An interrupted AI task resumes in its conversation if it is the starting flow node.
`forget` takes an ended run off the list, and is refused (`409`) while it is playing. Twenty ended
runs are kept, in memory only, oldest evicted first.

**A usage limit is waited out on the clock its own notice names.** `Claude AI usage limit
reached|1750000000`, `You've hit your session limit · resets 7:10pm (Europe/Paris)` and a `429`'s
`retry-after` each say when the window reopens; the run waits until that moment plus a minute,
reports itself as `refreshing` with `retryAt` set to it — hours off as often as not, where the fixed
twenty minutes of `waiting` would spend all four tries inside the first hour — and marks the flow
node `waiting-refresh` in the document. What it sends when the limit lifts is not the flow node
again but `You have been interrupted, please resume cleanly`: the turn that met the limit had
usually been working, its conversation holds all of it, and the answer to that word is filed under
the flow node.

**Where the notice names no moment, the runner checks the harness's quota.** `codex exec` never names one
— it reports a `429` and stops — and a bare `429` from either CLI says nothing about when it lifts.
The run reads usage for the harness's account and waits for the last exhausted window to reopen.
Only when none reports exhaustion does it use the soonest window at least 95% spent.
Expired observations and resets beyond the 32-day sanity bound are ignored. With no usable
notice or quota window, it waits twenty minutes.

**A Codex error is read off the turn's failure channel, not off its reply.** `codex exec` writes its
errors as `error`/`turn.failed` events and then exits **zero**, having written no reply at all —
read as text, that turn is an empty answer filed under a flow node and the flow node marked done. So
the last failure the harness reported is a reading of its own, taken under two conditions: a turn that
came back with no answer at all, and a **usage limit**, which no progress notice ever looks like and
which is exactly the thing a run must not miss at the foot of an hour's work. Anything else reported
by a turn that did answer is left alone. The summaries name the harness used for the turn — `Codex's
usage limit was reached` under a Codex card.

A run updates flow nodes through the hybridflow-store client, using named operations on each flow node.
The spool retains pending updates while the upstream is unavailable. Each update bumps
`documentAt` on the run so clients know to refresh their view.

**A flow node's images travel with it.** A body is markdown, so a picture in one is a file of the
store it links — a screenshot pasted into the flow node and saved beside the board, or an image
dragged in from the file tree. The prompt is text on a pipe, so the run resolves those links and
appends a note naming each file's absolute path, the way an attachment is named:

```
---
The message above links these images, files of the store. Read them with the Read tool — the paths
are absolute, so use them as written:
- /srv/store/backlog/shot.png (image/png, 84213 bytes)
---
```

The links resolve from the **DCMS root**, independently of the turn's working folder. Every
markdown image counts, and a plain markdown link counts when its extension says it is a picture: a
file dropped in from the tree arrives as a link, and it is still a screenshot. `https://` and `data:`
targets are left alone, so is anything inside a fenced code block, and at most ten files are handed
over — the attachment cap, for the same reason.

Nothing is copied anywhere: the file is named where the store really keeps it, because the turn is
working in that store and may have to change the picture as well as look at it. A link that resolves
to nothing does **not** refuse the turn the way a missing attachment does — a dead link is a mistake
in a document somebody is still writing, not a file the user just handed over — so the flow node is
played as it stands and a `warning` notice says which image the turn was never given.
