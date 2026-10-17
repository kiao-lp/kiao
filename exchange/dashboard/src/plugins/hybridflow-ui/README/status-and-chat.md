[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know card kinds, the panel and chain runs.

# Status and chat

Two fields a **run** writes onto a flow node — in the runner, not here — and which the panel can
also be used to write:

```json
{ "id": "…", "title": "Write the plan", "status": "done", "chat": "1f0c…" }
```

**`status`** is where the flow node stands, and it reads as a life:

| Value | Meaning |
| --- | --- |
| `draft` | Still being written. On the board because that is where thinking about it happens, and not to be played until it is finished being asked. |
| absent, or `ready` | Waiting to be played. |
| `blocked` | Waiting on something that is not on the board: an answer somebody owes, a deploy that has to land first, a decision nobody has taken. The card is written and would play as it stands; what holds it up is outside. |
| `running` | A play has it: the turn was sent and nothing has come back yet. |
| `waiting-refresh` | A play has it and can do nothing with it: the agent's usage limit was reached mid-turn, and the run is holding the flow node until the moment that limit lifts. |
| `interrupted` | Its turn was stopped part-way. What it said before the stop is in the conversation; the rest of the flow node was never done. |
| `done` | Its turn came back an answer, which is in the conversation — and the description it sent stays where it is. |
| `error` | Its turn came back an error, or never ran. Its description is kept so it can be played again as it stands, and the mark stays until it is. |

`ready` is what a flow node says by saying nothing, so it is absent from the document for all but
the flow nodes something has since had to say more about. `draft` is not the silent one, though it
comes first: a board written before these eight, and every flow node typed on one since, means *this
flow node is to be played*, and reading that as a draft would quietly take the Play off every card
in the store.

Four of them are the run's own — `running` the moment it takes the flow node, `waiting-refresh`
while it holds it for a usage limit to come round, then one of `done`, `interrupted` and `error`
when it lets go — and the other four are the user's, written in the panel's select. That select is
also the way back: a flow node that ended anywhere but `done` is offered a second turn by being set
`ready` again.

**`blocked` is the user's word, and it is the mirror of `waiting-refresh`.** Both say a card is
waiting rather than working; one waits on the account and is the run's to write and to clear, the
other waits on the world and no run touches it either way. It exists because the two words on either
side of it answer a different question: `draft` says the flow node is not finished being asked,
`ready` says nothing is in its way, and work that is fully described and cannot start is neither.
Left `ready` such a card is the next one somebody plays; set back to `draft` it reads as unfinished
writing, and what it is actually waiting for is lost. Nothing on the board tracks *what* blocks it —
that is a sentence for the description, or a chain from the card it waits on.

**`running` is written before the prompt goes out**, because what it says is that the flow node has
been *taken*. A turn is minutes to hours long, and the spinner the board draws over the card belongs
to whoever started the run: a tab that was closed, a second machine and tomorrow morning have
nothing but the mark. It is also what a flow node the run was holding stops saying when the run ends
without finishing it — killed by a second play, stopped in the middle of a wait, or left by a board
that went unreadable underneath it. None of those is a failure of the flow node's, so none of them
is an `error`: they are `interrupted`, like a turn somebody stopped.

**`done` means the flow node was finished, and nothing weaker.** It is not "the turn ended", and it
is not "a lot was said": a turn that worked for an hour and then met the five-hour usage window has
an hour of work and no finished flow node. What the run does with that one is wait it out — see
[Waiting for a usage limit](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#waiting-for-a-usage-limit) — and a turn that came back an error no
waiting fixes is marked `error`. The mark is the only thing a board is read for.

**Only a `ready` flow node is played**, so every other card carries no Play at all (`canPlay`). A
`draft` is not finished being asked, a `blocked` one is waiting on something off the board, and a
`running` or `waiting-refresh` flow node is one a run is already holding; a play started on one of
the other three would write over the very thing the mark is on the board to say — what a finished
flow node came back with, what a stopped turn managed to get down, or where last night's run stopped
— and it would do it on one press, on a card the user was reading rather than aiming at. Setting the
status back to `ready` in the panel is how the button comes back, which makes replaying a flow node
a thing somebody decided instead of a thing that happened. The AI card the run is *on* keeps its
button either way: what it is showing there is the play's Stop, not a Play, whatever mark it wears.
A Shutdown, a Scheduler and a Gateway never carry either — a run holding one is stopped from the
chain runs panel.

**Each status has a colour, and it is the same colour everywhere.** Amber for `ready`, green for
`done`, red for `error` — the three the CMS already wore for the same three meanings — and grey,
pink, blue, orange and violet for the five the board added: nothing asked for yet, waiting on
something off the board, being worked on now, held until a usage limit refreshes, stopped part-way.
Both themes get the same eight, the app's tokens running to an accent and a muted and having no
colour for waiting, for finished, or for something having gone wrong. A card
wears its colour as a **stripe down its left edge**, three pixels wide whatever the status, so a
play that marks a card never nudges its text sideways. That stripe is the whole of what a `ready`
card says about where it stands — the line under the title stays silent, because saying *Ready* on
every card on the board is saying nothing forty times — and on the other seven the line that names
the status is in the same colour as the edge, so a card is read at either distance. `error` alone is
loud on all four sides: it is the one card a board read the next morning is read for. A card being
played is painted the accent on all four sides instead: while a play runs, what the board is doing
is the news, and the mark underneath it is not. The select is where those colours are learnt, being
the one place all eight are named together, so each option there is in the colour its card is
striped with.

**`chat`** is the conversation the flow node is played in, by id, or nothing at all until it has
been played. A flow node played without one gets a conversation made for it, and **the id is written
onto the flow node the moment that conversation exists** — before the prompt goes out, not when the
turn ends, because a flow node running for ten minutes is ten minutes of somebody wanting to see
what it is doing. The board is told the document was written and reads it again, which is how the
card fills in while somebody is looking at it. A flow node played **with** one is played into it,
however it came by it: its own last play, or the flow node before it in a chain that handed it on.

So a flow node keeps its chat, and the panel gives an [AI card](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types) a **Chat** button
that puts that conversation on screen — which is how the user reads what a played flow node actually
did. The button beside it *forgets* the conversation without deleting it, and the flow node is
played in a new one next time. The one place the conversation itself is deleted is [the card's own
delete](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing), which asks. A Human card is not asked about a chat at all, having none to link
to; one that was AI and has been typed back **keeps** what its plays gave it, the line simply not
being drawn — the id is a record of a conversation that happened, and typing a card is not a reason
to lose it.

**The card carries the same way in**, as a speech mark in its bottom-right corner, left of the
[knob](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#on-success): a click opens the conversation in the Conversations panel, and the flow node is
not selected on the way — a board being read that way is not a board asking for the editor. It is on
a played card only, there being nothing to open on any other. The two marks sit together on purpose:
one is the chat, the other is what becomes of it.

