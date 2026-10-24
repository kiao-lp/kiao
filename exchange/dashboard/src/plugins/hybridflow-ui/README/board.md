[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know cards, chains, spots and the tag filter.

# The board

A board is one canvas: every card where somebody put it, and an arrow from each card to the one it
hands on to. It answers *what runs after what* — a chain of six flow nodes laid out on a canvas is a
line, and the whole order of a board is read without opening anything.

```
   ┌───────────┐        ┌───────────┐        ┌───────────┐
   │ Write the │───────▶│ Review it │╌╌╌╌╌╌╌▶│ Good night│
   │ plan      │        │           │        │  ⏻        │
   └───────────┘        └───────────┘        └───────────┘
        solid: the chat is handed on      dashed: it is not
```

## Where a card sits, and who decides

The place is **on the card, in the document** — `"spot": { "x": 320, "y": 160 }`, beside the
settings. Nothing about this board lives outside its file: a chain is a field on a card, and an
arrangement of a board is worth exactly as much as the chains it arranges. Kept in a browser it
would be lost to the next machine, the next store and the next person; kept here it is copied,
pasted, committed and reviewed like the rest of the board.

**Absent means never placed**, which is what every card of every board never laid out
says — so no document needs rewriting to be read. A card is placed **the first time it is drawn**,
in one write, and from then on nothing moves unless somebody moves it:

- The opening layout **follows the chains**: a row per chain, left to right along it, so a board
  never laid out already shows its workflows as lines rather than as a heap.
- Cards already placed are left where they are, and new ones start **under** them. That is what
  keeps the first card dragged out of the opening layout from shoving the other thirteen aside, and
  a card made tomorrow from landing on somebody's arrangement.
- Computing the place afresh on every render instead would be a board whose unplaced cards shuffle
  themselves whenever a card is added. A place written down is a place that stays.

**The runner carries the field and reads none of it**, exactly as it carries the tags: a run
rewrites the board to mark a card, and a field it did not know about would be a field
the play quietly deleted (`board_content.go`). A board somebody spent a minute arranging is not a
thing to lose to the first flow node played on it.

**A pasted card arrives unplaced.** A place is a place on *that* canvas among *those* cards, so
carrying it over would drop the card exactly on top of whatever the receiving board keeps there —
including, pasting into the board it was copied from, on top of the card it is a copy of. A
**cloned** card does keep one, nudged clear of the card it was made from: that is the offset every
duplicate anywhere makes, and it is what says which of the two is the new one.

## The gestures

Everything a card does — the click that opens its panel, the double-click that
opens the large editor, the right-click menu, the Play, the chat mark, Ctrl-click to mark
it, Delete to take it off:

- **A press anywhere on the card moves it across the canvas**, and it follows the pointer while it does. Every
  other drag in this application leaves everything still and draws a line where the drop would land,
  because what is being aimed at is a *gap between two things*; here the drop lands where the card
  is, so the card has to be where it is going to be. The arrows redraw with it, once a frame, which
  is the one question the gesture is asking. A marked card carries the marked set, by one distance,
  so a group arrives in the shape it left in.

**The canvas carries a menu of its own**, on a right-click anywhere no card is: the five kinds of
card, the four kinds of class — a class is reusable words, and a gateway holds none —
**Instantiate class…** — the instantiable classes and the workflow
classes of every board — and **Paste**, made at the point the pointer is on. A canvas has nowhere
to put a box to type a title into, so the gesture that makes a card here is the one a file manager
makes a file with — and it names the **kind** rather than taking a title, the kind being the one
thing a card cannot be given afterwards without retyping what it was made as. The card arrives
untitled, at the point it was asked for, and it opens in the panel, which is where it is named. An
empty canvas says so where its cards would be: *No card to lay out — right-click to make one.*

The knob draws a chain to another card, the same gesture and the same hook (`useLinkDrag`) — which
is drawing the arrow you are looking at.

## The arrows

One per card that names another after it, drawn in the board's **one relation layer**: above the
[workflow backgrounds](/exchange/dashboard/src/plugins/hybridflow-ui/README/classes-and-workflows.md#workflows)
and under the cards. Within one workflow, across workflows, grouped or not, every arrow is drawn
there — belonging to a workflow never clips one. Each stroke takes the pointer while the empty
sheet passes it through to the rectangle or the board underneath, so a hovered arrow reads its
title; a chain being drawn across the canvas reads its target through the strokes it crosses.

They run **edge to edge along the line between the two cards' middles**, so a chain drawn downwards
leaves the bottom of its card and one drawn back to the left leaves the left side — nothing anywhere
says which way a board is supposed to run. The edges are the cards' real ones: heights are measured
off the document (`useCardHeights`), a card of a title alone and one carrying three tags, a status
line and a row of chips differing by half their height.

**Solid where the chat is carried on** — `continue`, which forks it — and **dashed where it is
not**: the line is broken exactly where the conversation is. A chain naming a
card the tag filter is holding back is a chain with one end, and is not drawn.

