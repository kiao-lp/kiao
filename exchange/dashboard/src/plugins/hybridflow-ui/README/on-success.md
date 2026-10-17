[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know cards, chats, folders and the run loop.

# On success

A flow node says what is to be done **after** it: the flow node played next, and — on an AI card —
what becomes of the conversation it ran in, which is two answers: the **transition mode**, who gets
it, and **compact**, whether it is shortened first. It is `onSuccess` on the flow node, beside its
settings, and the panel edits it as two selects and a box:

```json
"onSuccess": { "flowNode": "…the next flow node’s id…", "mode": "continue", "compact": true }
```

**Naming the next flow node is the only way flow nodes are chained.** There is no other order on a
board: a play runs the card it was started on, then whatever that card names, and stops when nothing
is named.

**It names any card of the board.** That is what the select offers, and the knob's tooltip names
the flow node it hands on to (`Next: “Ship it” · forked chat`). It names a **flow node**, so a chain
survives every drag.

**It is asked of every card but a Shutdown**, whoever plays them: a chain is the order somebody wrote
the board in, and an order is worth writing down whichever kind of card is in it — a play, when there
is one, follows it as far as the cards it can take. The one card not asked is the one that ends the
board: nothing is played once the machine is off. A Gateway answers the list way — its branches,
each started when it fires — rather than the one card. This is where the chain and the chat part
company — the chain is asked of four types, and what becomes of the chat of one.

## The transition mode

**`mode` says who gets the conversation once the flow node is done**, and it has two answers:

| Value | What happens |
| --- | --- |
| `"end"` | Nothing is handed on. Whatever comes next is played in the chat it already had, or in one made for it. **The default**, and what a flow node says by saying nothing. |
| `"continue"` | This flow node's chat is **forked**, and the next flow node is played in the copy. |

The chat is what makes a chain worth more than two cards played apart: the second flow node starts
knowing what the first found out, which is the one thing a board is regularly asked for — *this*,
and then *that*, in the conversation the first one built. Written as two unchained cards, the second
knows nothing; written as one card, it is one turn, and a turn is the unit the board marks,
retries and stops on. `continue` is the third option — two flow nodes, two cards, two answers,
**one thread of thought**.

**`continue` forks.** What the next flow node is played in is a *copy* of this conversation, made
the moment this one ends: the copy carries the transcript and the agent's own session, so the flow
node after remembers everything the chain has done, while this card keeps a chat that is its own and
stops there.

A document still saying `"mode": "shutdown"` is read as `end`: a word this build has no meaning for
is somebody having answered the question, so it falls to the answer that claims nothing.

## Compact

**`compact` says whether the flow node shortens the chat it ran in when it ends well**: `/compact`,
sent into that conversation as a turn of its own, which is exactly what typing it into the chat's
own box does. Absent is false, which is what every document that has never heard of it says.

**It is a box and not a third mode**, because it answers a different question. The mode says who
gets the conversation next; this says what state the flow node leaves it in — and that is worth
saying of the last card of a chain, which hands it to nobody, as much as of the first.

**Where both are said, the chat is shortened first**, and the fork the next flow node is played in
is taken from the shortened one. That is the whole of why a long chain costs less with the box
ticked.

**Both stand on their own, and both are the flow node's rather than the chain's.** A card at the end
of a board still says what becomes of the chat it leaves behind; and a chain drawn, redrawn or taken
off leaves them exactly where they were, since what a line between two cards says is which flow node
comes next and nothing about how this one ends.

**`end` with the box unticked is the default because it is the only thing a flow node nobody plays
can honestly say.** Either of the others says the flow node is an agent's — a conversation to hand
on, or one to shorten — which is why both are drawn on an [AI card](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types) and on no
other: no other type has one, and a card typed away from AI gives them up with its settings. Within
an AI card they stay offered whatever else is missing — a mode picked before the effort is a plan,
not an error — and a card whose remaining settings cannot honour what it says is **marked**: the
same warning an unanswered setting carries, on the select, on the box and at the card's knob, with a
tooltip saying what is missing. Nothing is taken away and nothing is corrected — what was picked was
picked, and the contradiction is resolved either way round by the user. A flow node can only be
played once it names all four settings anyway, so this is the *reason* rather than a second gate.

Two older spellings are still read: a `chat` field beside a named flow node, and `"mode":
"compact"` as both answers at once. A chain naming a flow node and saying nothing at all is read as
`continue`, so the mode is **written on every chain this build writes**, while the box goes in only
when it is ticked.

**How the next flow node knows which chat it is in: it is written onto it.** Handing the chat on is
a `chat` field written on the next flow node before it is played, not a thing the loop holds in
memory — so a chain stopped halfway and started again from its second card goes back into the same
conversation.

**On success means on success.** A turn that came back an error is not a flow node that was done, so
none of the three is reached — no compaction, no fork, no next card: the flow node is marked `error`
and the play retries or stops exactly as it did before. So does a stopped turn: the chain is not an
argument against somebody pressing Stop.

**The chat is carried on only by a card that has one.** A Scheduler, a Shutdown and a Gateway speak
to nobody, so a `continue` in front of one is honoured as far as it can be: the chain carries on,
and the conversation stops there.

**One chat, one folder.** A conversation is made for a folder and keeps it, and so is a fork of one,
so a flow node being handed one must name the same folder as the flow node handing it over. It does
not, the play **stops** and says so: where a played turn writes is the one thing this board never
decides on the user's behalf. `"mode": "end"` is the way round it — nothing is handed on, so the
next flow node may run anywhere. The other two settings are the turn's rather than the
conversation's — the service takes an effort and a permission mode per prompt — so a chained flow
node states its own.

**A chain ends** where a flow node names none, where the one it names has left the board or is not a
card a run can take — an AI one missing part of the set a turn is run with, a Scheduler with no
datetime, a card somebody is to do by hand — and where it comes back round to a flow node the chain
has already played — a board is a thing people edit, and a circle would be a play with no end. Each
of those says so, since a chain configured and then not followed is worth a word.

**The chain is read off the board when the turn ends**, not off the copy the round started with: a
turn lasts minutes, and what comes next may have been rewritten in the panel while it ran.

**`/compact` goes in unadorned.** The runner leaves a bare slash command alone: a prompt carrying
attachments or images gets a note naming them, and `/compact` takes free text as its own argument,
so the note would have arrived as the instructions for the summary (`promptWithContext`). A
compaction that came back an error **stops the play** — the card asked for a shorter chat when it
was over, and carrying on regardless, forking that chat or leaving it as the record of the card, is
doing something else. It is reached only by a flow node that succeeded, so a turn tried three times
and answered once shortens its chat once.

