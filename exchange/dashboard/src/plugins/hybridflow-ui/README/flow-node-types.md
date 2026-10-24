[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know what a task, a setting and a chain are.

# Flow node types

**A card is one of five kinds, and the kind is picked when the card is made.** The canvas menu
picks it; the select at the head of the large editor's first row can still change it, and everything
under it is drawn or not drawn according to its answer. The lateral panel asks nothing about it —
what it draws is what the kind asks for:

- **AI** — an agent plays it.
- **Human** — somebody does it themselves.
- **Shutdown** — the machine goes off. It has no options at all.
- **Scheduler** — it waits for a fixed duration or datetime, then plays the flow node after it.
- **Parallel gateway** — it waits for every branch feeding into it, then starts every branch leaving it.

Right-click an AI or Human task and open **Convert** to switch it to **Human task** or **AI task**.
The same submenu offers **Node class** to file its reusable shape. Type conversion applies to the
task clicked, keeps its content, folder, status, conversation and successor, and updates settings
using the same rules as the large editor.

**The first two are tasks.** A **task** is a flow node that is work somebody does, and it is the
word for that pair. The other three are the board acting on its own machine and
describe no work at all, which is why they are asked neither for a description nor for a folder.
`hybridflow-store` keeps a `task` row of its own for each of them, keyed by the flow node it belongs
to; the wire stays flat, so nothing here reads a card differently because of it.

```json
{ "id": "…", "title": "Write the plan", "type": "ai", "settings": { "agent": "…its agent id…", … } }
```

| | Human | AI | Shutdown | Scheduler | Gateway |
| --- | --- | --- | --- | --- | --- |
| A task | yes | yes | — | — | — |
| Title, tags, status | asked | asked | asked | asked | asked |
| Description | asked | asked | — | — | — |
| Folder | asked — where the work is is worth writing down whoever does it | asked, and **required** | — | — | — |
| The flow node that comes next | asked | asked | — | asked | — |
| The branches that come next | — | — | — | — | asked |
| Agent, effort, permission mode | — | asked; the agent is given, the rest are required | — | — | — |
| Runner | — | asked, never required | — | — | — |
| Chat | — | written by the play | — | — | — |
| Transition mode | — | asked | — | — | — |
| Duration or datetime | — | — | — | one **required** | — |

**The type is a field**, and **the editor keeps the two in step**: picking a type writes the
settings that go with it and takes back the ones it has no use for, so no card the board makes is
ever left claiming to be played by an agent it does not name.

**Reading is forgiving and writing is narrow, as everywhere in this format.** A document that says no
type — every board written before the field, and any written by hand — is read the old way: a named
agent makes the card AI, and nothing at all makes it Human. So no board needs migrating. `human` is
what a card says by saying nothing, so it is the one type absent from the file.

**Human by silence is not Human by default**, and the two are different questions. How a *file* is
read where it says nothing cannot move: a board written before the field, or by hand, means Human by
its silence, and reading it otherwise would turn a list of somebody's own work into a board of
agent's work nobody wrote. What the *editor* makes where the menu names no kind is the other
question, and the answer is **AI** (`NEW_FLOW_NODE_TYPE`) — see [Editing](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing).

**What a type no longer asks, it takes back in the document too.** Typing a card away from AI takes
out the agent, the effort and the permission mode, settles the transition mode back to `end` and
unticks the compact box; the three the board plays to itself give up the folder as well, a
**Shutdown** gives up the flow node named after it, nothing being played once the machine is off —
and a **Gateway** gives up the single flow node for its branches, typing away from it giving those
up in turn. A field nobody can see is worse than a wrong one — it would sit in the file unshown and unreachable,
marking the card as broken with nothing to fix it with — so a document saying one anyway is **read**
the same way. The **chat is left alone**: a conversation the card was played in is a thing that
happened, not a claim about what will.

**One of the four has a default when a card is typed AI**: the agent, written on the
spot — the store's first — because a select opening on a blank is a card
that looks broken the second it is typed. The other three keep their emptiness: what a turn costs,
what it may do while nobody watches and where it writes are answers, not defaults. A card the board
*makes* is answered one of the three as well — the permission mode, see [Editing](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing) — which
is a different thing from a fallback, and the [Settings](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md#settings) section says why.

## The Shutdown card

`"type": "shutdown"` is the one thing a board does that reaches past the store. It is for the chain
nobody sits through: work started in the evening should not leave a machine running all night, and a
card is the only place that can say what happens when the work ends.

**It has no options**, and that is the whole of what it is: playing it *is* what it does. No
description — it is no task, and nothing would be sent — no settings, no folder, and no flow node
named after it — the play ends there, so a chain drawn out of
that node would be a chain nothing could ever follow. It is drawn as a BPMN event's circle with a
power symbol in it rather than as a card — the ring thicker, the way an end event's is — with one
bubble under it saying `shutdown`, what it is being the whole of what there is to say, and no
chain knob at all: see [What a card shows](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#what-a-card-shows).

Everything it means when it is played is the run's, in the hybridflow-runner, and two things are worth
knowing here:

- **A chain that failed never reaches it.** The card is played when the card before it was done, so a
  turn that came back an error, or one somebody stopped, leaves something to look at and leaves the
  machine on. That is the whole point of putting one at the end of a chain.
- **Not every deployment can act on it**, and this end never asks which. The machine goes off where
  KIAO was started from the command line (`kiao`), on somebody's own machine, and nowhere else:
  the service is given the command to run it with or given nothing at all
  (`KIAO_WORKER_SHUTDOWN_COMMAND`). The card is therefore drawn whatever the deployment — a
  board is written in one place and played in another, and a card that vanished where it cannot be
  honoured would be taken out of the document by the first save made there. Where a machine cannot be
  turned off the card is played and marked `error`: it asked for something that did not happen, and
  `done` over a machine still running would be the play claiming otherwise.

## The Scheduler card

`"type": "scheduler"` waits, then plays the flow node after it. The editor offers two modes:

- **Fixed duration**: `duration: "15m"`, counted from each play. Positive hours, minutes,
  seconds and milliseconds can be combined, for example `1h30m`.
- **Date time**: `at: "2026-10-16T22:00"`, on the runner machine's local clock. A time already
  past continues immediately.

A Scheduler has no description, settings or conversation. Setting either mode clears the other;
without a valid duration or datetime it is incomplete and cannot play.

The board draws a clock in a circle, with the wait below it and a small Play beside it when
ready. The name is hidden on the board and remains editable in the panel. Play starts a named
chain run, as it does for a task. While waiting, its Stop cancels the wait and leaves the next
node unplayed. Schedulers can also be reached through chains.

## The Gateway card

`"type": "gateway"` is the board's parallel gateway, as in BPMN: it waits for every branch feeding
into it, then starts every branch leaving it:

```json
{ "id": "…", "title": "Both done?", "type": "gateway",
  "onSuccess": { "flowNodes": ["…", "…"] } }
```

**The branches are the whole of it.** No description, no settings, no transition mode and no
compaction: a Gateway is no task — firing *is* what it does, so there is nothing to ask of it — and
it speaks to nobody, so it has no conversation to shorten or to hand on. What it waits for is
written on the board rather than on the card: every card naming it as what follows it is a branch
feeding into it.

**One card follows every other kind; a Gateway starts a list.** The branches are named the list way
— `flowNodes`, beside the single `flowNode` it never uses — and picked in the panel's multi-select.
A chain drawn on the canvas adds one branch; taking one off is the multi-select, the gesture having
named no branch to take. Each branch gets an arrow of its own.

It is drawn as a BPMN gateway's diamond with a plus in it rather than as a card, and wears the
count in a bubble under it — `2 branches`, or `no branches` where there are none, which still
joins. Firing it starts every branch in parallel, each as a run of its own; what that means when
it is played is the run's, in the hybridflow-runner.

