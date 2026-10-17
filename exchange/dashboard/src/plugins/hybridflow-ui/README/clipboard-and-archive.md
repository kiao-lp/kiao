[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know how cards, ids, chains and chats are held.

# Copy, cut, paste, clone, move and archive

## Copy, cut, paste and clone

Right-clicking a card offers **Copy … as JSON** and **Cut … as JSON**, and right-clicking the canvas
where no card is offers **Paste …**, through the system clipboard. The point of it is **another
instance of KIAO**: two boards in two stores have no server in common, so a flow node worth doing in
both travels as text a person can copy. Between two boards of *this* store the gesture is
[Move to…](#move-to-another-board) instead, which keeps what the clipboard must drop.

**A copy takes the cards picked out**, by [the same rule every other gesture
follows](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#several-cards-at-once): aimed at one of several marked cards it takes them all, aimed at an
unmarked one it takes that card alone. So the thing carried between two stores is the handful of
tickets somebody chose, and the whole handful pastes back in one gesture at the other end.

What goes on the clipboard is the board's own shape, pretty-printed, wrapped in one line saying
what it is:

```json
{ "kind": "kiao-flow-node", "version": 1, "flowNode": { … } }
{ "kind": "kiao-flow-nodes", "version": 1, "flowNodes": [ … ] }
```

**One card writes the singular wrapper**, even now that there is a plural one: a copy made here is
then a copy any instance can paste, whatever it was built before, and the plural form is only ever
written where it says something the singular cannot.

Reading is forgiving in the same way the board is: a bare flow node object and a bare JSON *array*
of flow node objects are accepted, so JSON written by hand or asked of a turn can be pasted straight
onto a board. A copy wrapped `kiao-workflow-flow-node` pastes as it always did, and a bare object
carrying a `flowNodes` array reads as nothing: pasting a card for its header would drop every card
it carried.

**A paste always mints new ids.** The copy is of what a flow node *is*, never of which flow node it
is: a clipboard is a thing that pastes twice, and two flow nodes sharing an id would be one flow
node as far as every id-keyed operation on the board is concerned. It also makes pasting into the
board a flow node was copied from an ordinary duplication.

Which is why a **chain travels with whatever carries both its ends**. `onSuccess` names a flow node
by id, and the ids change on the way in: a set of cards copied together carries both ends of the
chains among them, so those are rewritten with the ids their flow nodes are given — three chained
tickets picked out of a board are worth carrying between two
stores as what they are. A chain naming a card the clipboard does not hold — a flow node copied on
its own, or the far end of one that was not marked — arrives with nothing after it, there being no
id it could be given that would mean anything here. **What it says about its chat** comes with it
either way — the mode and the box both: that is the card's own statement about how it ends, not the
chain's, and a card that shortens its conversation does so wherever it is pasted.

**A `chat` never travels; a `status` does.** The chat is a conversation of *this* instance, named by
an id that means nothing in another, and two cards pointing at one conversation because one was
copied from the other is not what either of them says — so a pasted flow node arrives with none and
is played into one of its own. The status is what the flow node says about itself, like the body
that holds the answer it was marked done for, so it comes across as it is. The **criteria** and
the **complexity** travel with it, for the same reason: they are the task's own words about its
work.

**A managed agent travels as far as the store that keeps it.** `settings.agent` is an id, and an id
means something where the thing it names is: the paste reads it against the agents **this** store
keeps and holds on to it where one of them answers to it. So a card cut from one board and pasted
onto another of the same store is still that agent's to play — which is the ordinary way a ticket
moves boards, and the agent is the last thing about it that should need saying twice — while a card
pasted into another instance arrives with none, to be picked from the agents that store keeps. An
agent deleted since the copy goes the same way as a foreign one: a card naming an id nothing answers
to reads as [playable](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#playing-flow-nodes) and is not. A **runner pin** is read the same way
against the runners this store keeps, and dropped where none answers to it. The engine of a card
written before managed agents stays either way, being a word rather than a reference — the same
difference as a [tag](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md#tags) and a chat. The lists are **read** at the paste rather than taken off
what is on screen: a board opened a moment ago is still reading its agents, and a card pasted into
that moment would lose the one it was assigned for no reason but the timing.

What says which class version a card was made from and which rectangle groups it stays behind too:
both are ids of *this* board, so a pasted card arrives unlinked and ungrouped — inside the
rectangle it was pasted into, where one was aimed, like a card made there.

Everything here reports what happened. The clipboard is the one thing on the page the application
cannot see: reading it can be refused outright by the browser, and what comes back may be somebody's
shopping list, so a paste that found nothing says so rather than doing nothing. A copy of one card
is named by its title and a copy of several is counted — six titles in a toast is a paragraph nobody
reads, and the count is what is being checked anyway. A paste of several is counted too: the cards
land as a block with the first one open in the panel, and the count is what says the other five are
there rather than somewhere off the edge of the canvas. A paste of one says nothing, the card being
right there under the pointer.

The **Paste** item counts nothing, and names the thing instead. What the clipboard holds cannot be
read until the click — the browser has a permission to ask about first — so an item that promised a
number would be a menu guessing at something it has no way of knowing.

### Cut

**Cut … as JSON** is that copy, and then the cards off the board. It takes the cards a
Copy would take, by the same rule, and writes the same clipboard text: what is cut on one board is
pasted on any other, and on this one.

**The clipboard first, and the cards only if it took them.** The write can be refused outright — it
is a permission, and permissions are refused — and a cut that removed the cards anyway would be the
one gesture here able to lose work. So a refused write leaves the board exactly as it was and says
so.

It **asks nothing first**, where a delete asks: what a cut wrote is a paste away, and a dialog on
every cut would be a dialog on the ordinary way of moving a card between two boards. The one
question it does ask is the [delete's about a chat](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing) — a conversation the board is left
with nothing naming. A cut is no exception for going somewhere: the chat is the one thing the
clipboard does not carry, so the card pasted at the other end names that conversation no more than
this board does.

### Move to another board

**Move to…** is the gesture for a ticket on the wrong board of *this* store: the submenu lists
every board but this one, and the cards it takes — by the same rule a Copy follows — are created
there first and taken off here after. In that order, and only in that order: a create that fails
says so and the cards stay where they are.

A move is a copy that keeps what a copy between two instances must drop. The **chat** is a
conversation of this store and means the same on the board the cards land on, and the **agent** is
an id this store keeps — so both travel, and no question is asked about a conversation left with
nothing naming it: it moved with the cards. What does not travel is the **place**: the cards
arrive unplaced and the receiving board lays them out, and the chains among them are rewritten with
the new ids while a chain naming a card left behind is taken off. Classes move the same way, with
every version beneath them. See `flowNodeMove.ts` and `flowNodeClassMove.ts`.

### Clone

**Clone flow node** is the copy wanted on the board already open: a second card just like this one,
filed directly under it and opened, without the clipboard in the middle. A card is often written
once and wanted three times — the same ask against another folder, the same checklist for the next
release — and copying it out to text and back in to do that is two gestures and a permission prompt
for something that never leaves the board.

What it carries is what the card says about itself: its title, its description, its tags, its
settings and where it stands. It gets an **id of its own** and
**no chat**, for the reasons a paste does — but unlike a flow node pasted on its own it **keeps its
chain**: the card `onSuccess` names is on this very board, so a step duplicated in the middle of a
chain still leads where the step it was copied from leads.

One card, marks or no marks. The copy goes under the card the menu was opened on, which is the card
the gesture named; the marked set belongs to the drag, the Delete, the Copy and the Cut. See
`boardOps.cloneFlowNode`.

## Archiving

**A finished card leaves the shown board by flipping a boolean.** Archiving sets `archived` on the
card: it stays stored, hidden everywhere with the links to and from it, and never playable while
hidden. No file is written and nothing is deleted. The Archive button sits beside Delete in the flow
node panel, and *Archive node* beside *Delete* in the card's menu.

**Hidden everywhere means everywhere.** Archived cards are drawn nowhere — not on the canvas, not in
the tag chips, not in the successor picker, not in the panel. A link naming an archived card is
stored but not drawn, so a board mixing archived and live cards shows no arrow to or from an
archived one, and nothing breaks: the chain ends where the hidden card would have been.

**The chat stays where it is.** The card still names it, so archiving never asks whether it goes
too — unlike delete, which asks where the card was the last one naming it.

