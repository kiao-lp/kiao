[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know cards, chains, templates and rectangles.

# Node classes and workflows

## Node classes

**A node class is the reusable card.** A card written once and wanted again — the same review
against another folder, the same checklist for the next release — is filed as a class, and
instantiating the class makes flow nodes from it. A class is never played: it sits on the canvas
beside the cards, chained to the next class, and what is played are the instances.

What a class holds is what every instance shares: the title, the kind, the tags, the chain to the
next class — and, for an AI class, how an instance's tool calls are answered and which runner it is
pinned to; for a Scheduler class, the preset datetime its instances start from. Beside it the class
editor keeps a **note** — what the class is for, when to instantiate it, what its instances assume
— asked of every kind of class and copied to no instance. What a class is *not* asked is the design
as much as what it is: no folder, no effort, no chat, no status. Its description lives in its
versions instead.

**A version is the words, under a successive number.** The description, what done means, whether
the body is a [template](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md#flow-node-templates) the instantiation fills in rather than copies — and,
on an AI class's versions, the default agent. Only a **draft** may be changed: a published version
is shown read-only, being what stays said. A new version starts from the one being read, which is
what successive versions are, and a version somebody changed their mind about is deleted while it is
still a draft. Only the latest version that is not a draft is used when the class is instantiated;
the others are past versions kept for statistics.

**Whether the class is offered is a tick.** `instantiable` is off unless ticked: the Instantiate
submenu of the canvas menu lists the ticked classes of every board, grouped by board, beside the
workflow classes. A class nobody ticked is still instantiated as the successor of one that is —
the chain is followed wherever it leads. A class card's own right-click menu offers
**Instantiate...** regardless of that tick, placing the nodes below the class on the same board.
The class list is refreshed whenever a canvas, workflow or class context menu opens.

**The canvas menu instantiates flow nodes at the point right-clicked.** The class and its successors, each
from its latest published version, until nothing is named, a class that has gone, or a class
already in the chain. Where a version is in template mode its template is filled in first — one
panel per version, in chain order, in the same instantiation panel a flow node template is written
from — and cancelling anywhere along the way makes nothing. A class with nothing published cannot
be instantiated, and the refusal is the service's to word. An instance carries the **link** to the
version it was made from — the class and the version, by the words the board shows — and breaking
it disconnects the flow node from its class and changes nothing else about it.

A class is made the way a card is — the canvas menu names a kind for it too — or **converted**
from a task, from the card's own menu: the first version's words are the card's, frozen at
creation. Classes chain among themselves and never across to flow nodes, move boards with every
version beneath them, and are grouped in rectangles of their own — see
[Workflows](#workflows).

## Workflows

**A workflow is a name round a set of cards.** The board draws it as a rectangle round its members,
with the name on top; at most one per card. It holds nothing else — no spot of its own, no chain,
no status — because its bounds are computed from the cards that name it: dragging a card redraws
the rectangle, and dragging the rectangle moves the cards. The members say which one they are in.
The rectangle is the back layer of the board: the [arrows](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md#the-arrows)
draw above it and the cards above them, so grouping cards never hides what joins them.

A rectangle is filed from the card menu's **Create** — round the cards the gesture was aimed at —
and arrives unnamed: the Workflow panel it opens is where it is named, a name being all a rectangle
has. A card made, pasted or instantiated inside one is grouped in it, like every element of it.
Taking the rectangle off ungroups its cards, which stay where they are; deleting the last member
takes the empty rectangle with it.

**A workflow class is the same, for classes**: a name round a set of node classes, filed from a
class card's menu, edited in the same panel. Instantiating one makes a workflow from its members —
member order, members only, their templates filled in first like any other instantiation.

