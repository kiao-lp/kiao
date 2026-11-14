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
side, or two chains of one board started from two cards.

Each carries a **name**, which the client asks its user for at the click and which is the only thing
telling two runs of one board apart; the card it was **started on**, so it can be played again; and
the **chain it has walked** — the cards played, the card it is on, and the cards ahead of it along
the `onSuccess` links, each with the title and status the board holds. A run **stays in the list once
it has ended**, saying so and saying why, until it is restarted or forgotten: a panel offers a
Restart on a finished run, and a run that vanished when it stopped could not be offered one.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/hybridflow-runner/chain-runs` | — | `{ runs: AgentChainRunDto[] }` |
| POST | `/hybridflow-runner/chain-runs/play` | `{ path, flowNodeId, name }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/stop` | `{ runId }` | `204` |
| POST | `/hybridflow-runner/chain-runs/resume` | `{ runId }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/restart` | `{ runId }` | `{ run }` |
| POST | `/hybridflow-runner/chain-runs/forget` | `{ runId }` | `204` |

The same handlers also serve `/hybridflow-runner/workflow-runs` and its operation paths
as compatibility aliases for HTTP clients.

`GET` is read **once**, at start-up: everything after it arrives as a `chainRun` frame, and `hello`
carries the runs too, so a tab that connects mid-run draws the board correctly without polling. The
list is oldest first, and it is always the *whole* list — a client merging deltas would be a second
place the truth lived.

**A card is played by one run.** `play` refuses (`409`) a card another run is holding, naming that
run, and a chain walking into one ends there and says the same thing: two turns would file two
answers under one flow node, and the second would be written over the first. Nothing else about a
second run is refused, and starting one stops nothing. The marks themselves never collide: each is
a named operation on one card and one field of it, so two runs marking two cards of one board never
queue behind each other.

An empty `name` is named by the service after the moment the run starts — the box a client offers is
prefilled with the same sentence, so clearing it is not a way of having no name.

`play` names the board by its handle — the slug the browser has it open at — and refuses (`503`)
where no hybridflow-store is configured, (`404`) a board the store does not hold, and (`404`) a
flow node the board does not hold. An *AI* card requires `agent`, `effort`, `permission` and
`folder` settings. The managed agent resolves its published harness and model configuration;
legacy cards may name an engine directly and supply `model`. Neither form defaults the agent.
A *Human*, *Note* or *Value* card is not executable. A *Shutdown* turns the machine off and ends
the run; a *Scheduler* waits until its `at` datetime before continuing. A *Gateway* waits for its
incoming branches and starts its outgoing branches. These control cards run without an agent turn.

What it names must also be coherent: the boards are one list shared by every machine, so a card
naming an agent this host does not offer, or a permission mode that agent does not have
(asking Codex for `manual`), is refused at the click with a message naming both. The chat a card is
played in is bound to its agent at creation, which is what makes the turn run on that engine at all.

`stop` means the same thing in three situations, and none of them touches the running turn: a run
playing keeps its turn — the turn is the user's to interrupt, from the chat, and ending it from here
would kill work already done — so the flow node under way is filed and marked like any other and
nothing after it is started; a run *waiting* has nothing to let finish and ends at once, whether it
was waiting to try a flow node again, holding for a usage limit to lift or holding on a Scheduler's
datetime; and a suspended run ends where it stands, which is what answering *no* to the resume
question means. The run stays in the list in every case, marked `ended` with `endedAt` and the
sentence it stopped on.

`resume` (`409` when that run is not suspended) picks up a run that was stopped by its turn being
stopped from the chat. It **attaches to the turn the user is about to start** rather than sending
one of its own: the message being typed is what the flow node's answer will come from, and the chain
carries on from there. Nothing arriving within 30 s, the run plays its flow node itself.

`restart` (`409` while the run is still playing) plays an ended run again **from the card it was
started on**, keeping its id, its name and its place in the list; the trail is dropped and the chain
followed afresh. It is refused (`400`) where that card has nothing left to send, which is what a card
whose description went into its conversation looks like until the next question is written in it.
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

**Where the notice names no moment, the agent's own account is asked.** `codex exec` never names one
— it reports a `429` and stops — and a bare `429` from either CLI says nothing about when it lifts.
The run reads the agent's usage port and waits for the last exhausted window to reopen.
Only when none reports exhaustion does it use the soonest window at least 95% spent.
Expired observations and resets beyond the 32-day sanity bound are ignored. With no usable
notice or quota window, it waits twenty minutes.

**A Codex error is read off the turn's failure channel, not off its reply.** `codex exec` writes its
errors as `error`/`turn.failed` events and then exits **zero**, having written no reply at all —
read as text, that turn is an empty answer filed under a flow node and the flow node marked done. So
the last failure the agent reported is a reading of its own, taken under two conditions: a turn that
came back with no answer at all, and a **usage limit**, which no progress notice ever looks like and
which is exactly the thing a run must not miss at the foot of an hour's work. Anything else reported
by a turn that did answer is left alone. The summaries name the engine the turn ran on — `Codex's
usage limit was reached` under a Codex card.

A run updates cards through the hybridflow-store client, using named operations on each card.
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

The links resolve from the **store root**, independently of the turn's working folder. Every
markdown image counts, and a plain markdown link counts when its extension says it is a picture: a
file dropped in from the tree arrives as a link, and it is still a screenshot. `https://` and `data:`
targets are left alone, so is anything inside a fenced code block, and at most ten files are handed
over — the attachment cap, for the same reason.

Nothing is copied anywhere: the file is named where the store really keeps it, because the turn is
working in that store and may have to change the picture as well as look at it. A link that resolves
to nothing does **not** refuse the turn the way a missing attachment does — a dead link is a mistake
in a document somebody is still writing, not a file the user just handed over — so the flow node is
played as it stands and a `warning` notice says which image the turn was never given.
