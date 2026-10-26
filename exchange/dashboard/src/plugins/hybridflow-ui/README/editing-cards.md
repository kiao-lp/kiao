[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know the board shape, the four card kinds and the chain.

# Editing cards

## Editing

Clicking a card opens the flow node in its tool bar panel: a **title** box, [where it stands and
which chat it was played in](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md#status-and-chat), the [settings](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md#settings), and a CodeMirror on the
**body**. They are fields of one flow node, so each is written on its own and nothing has to be
parsed back apart. A card the canvas menu makes opens the same way — a kind picked there is a flow
node to be written, and the panel is where the writing happens. That is also the one
place two openings can name the same flow node, a new flow node going in at the end, so the board
counts its openings (`openingId`) rather than leaving the panel to compare ids.

A **Value** card shows its title with a database symbol. Its JSON is edited in CodeMirror in
both the panel and the large editor. Both share the same draft, including incomplete JSON;
only valid JSON is written to the board, and local write echoes preserve the draft's formatting.

**The card it makes is of the kind picked** — and an AI card arrives on the store's first agent,
with `bypassPermissions` where that agent's platform publishes that mode. The canvas menu is where
work to be handed to an agent gets made, and a card arriving Human was three answers away from being
played every time; arriving AI, the card that is somebody's own to do is one answer away from being
that instead. The two it is deliberately *not* given are the **effort** and the **folder**: two
answers written and two asked leaves the card one short line of work from being playable, and
unplayable until somebody does it — what the turn costs and where it writes are not things to happen
to a store. See `newFlowNodeSettings` and `usePlayDefaults`.

A card made there arrives untitled — the menu picked a kind, not a name — so the panel it opens
takes the focus into the title box, and the next keystroke names it without a click first. The wish
is put on the board (`titleCaret`) rather than acted on where it is made, because the panel is a
tool-bar tab that may not even be mounted — and the panel places it only where the wish names the
flow node it is showing, a panel opened by any other gesture having no business stealing the focus.

The panel's **Archive** and **Delete** are the two ways off the shown board —
the same two the card's menu opens. Both ask before they act. Delete then asks, where that card was
the last thing on the board naming a **chat**, whether the conversation goes with it
(`useFlowNodeRemoval`, shared with the card menu's [Cut](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#cut) as well: a chat does not care which
of the gestures happened, only that nothing on the board names it any more). Archiving never asks:
the card stays stored and still names its chat.

What the two do with the card is the whole difference: Delete throws it away, and
[Archive](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#archiving) hides it everywhere by flipping a boolean.

**The central area.** The panel is as wide as the tool bar tab holding it, which is no width for a flow
node with sub-headings and tables in it. The expand button beside Delete opens the same flow node in
`FlowNodeEditorPanel`, as the markdown editor a `.md` file gets — source and live preview side by
side, folding, the Insert menu, PDF export — with the **title on the first row**, on a row of its
own and the width of it, and three rows between it and the panes: what kind of card it is and what
plays it (the [type](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types), and behind it the agent, the effort, the permission mode or
a Scheduler's datetime, what becomes of the conversation, and the way into the chat it was played
in), where it stands (the status, beside the flow node it hands on to), and where it is (the folder,
with the writing tools keeping the end of that row). An AI card carries one more row of its own:
[what it spent](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#what-an-ai-card-spent).

That last row is last because of what shares it: a toolbar reads as belonging to whatever it
touches, and what its buttons act on is the editor below them rather than the settings they would
otherwise be sitting among.

Every control is the same control in both faces, written once in `FlowNodeControls` and arranged
twice: the panel stacks them in a panel's width — the transition mode beside the flow node that
comes next, the compact box under them — and the large editor lays them across rows that cut through
those groups — which is why they are components of their own rather than parts of the three editors
the panel arranges.

**Double-clicking the card** opens it there straight away: a flow node written rather than glanced
at is opened to be written, and going through the panel first to press a button is a step that says
nothing. It is one opening, not two — the first click of the double-click is the ordinary one, and
the editor is handed the flow node that click opened.

**Each gesture asks for one surface**: a click shows the panel, a double-click the large editor and
not the panel, which would be the same flow node in a panel's width beside an editor that already
has it. They begin with the same click, and the browser says which gesture it was only after the
second one, so the panel is what the click holds back (`PANEL_AFTER_CLICK_MS`, in `Board`): a click
that turns out to be the first of two takes its panel back with it. The card is selected as it is
clicked either way — the wait is on the panel alone, and none of it is felt where the panel is
already up.

**A file dragged into the body becomes a link to it** — `[cadre.md](/units/abc/cadre.md)`, at the
point it was dropped — in the panel's editor and in the large editor's alike. A flow node is mostly
about files, and naming one by hand is copying a path across the window; the link is the store's own
form, so it opens from the preview like any other.

**An image pasted into the body is saved and linked**, in both editors too: the file goes where the
dialog says — the board's folder by default — and `![shot.png](/boards/major/shot.png)` goes in at
the caret, from the store root, because a card has no document for a relative link to resolve
against. A screenshot is half of what a flow node about a screen is, and the panel is the box it is
usually pasted into, so it may not be the one that swallows it. The image is a **file of the
store** rather than an upload of its own, which is what a board months old needs: it is copied,
moved and searched like any other file, it renders in the large editor's preview, and it is still
there when the flow node is played. What a played flow node then hands its turn is that file, named
where it really is — see [Playing flow nodes](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#playing-flow-nodes).

Whether it is open is the **board's** state (`expanded` on the context) rather than the panel's,
which is what having two openers costs: the panel's own button is no longer the only way in. It
closes on every opening — `select` puts it away, and the opening that asked for it turns it back on
— because it is an editor of the flow node it was opened on, and a card clicked while it hangs about
would find it showing the wrong one.

It covers **the board and nothing else**: it is a panel on the central area's stack
(`CentralStack-ctx`, pushed by `ExpandedFlowNode`), filling that area and stopping there. A board is
a thing being worked *from* — the navigation bar leads out of it, the played chat is watched in its
own panel, and the flow node panel beside it shows the same flow node — so an editor of one flow
node has no business taking the window with it, and none blocking the chrome around it either: there
is no mask and no focus trap. What it hides is what it is an editor of.

It is **pushed where it is shown**, by `ExpandedFlowNode` beside the board, rather than by the panel
that opens it. The panel is a tool-bar tab: hiding the right column unmounts it, and an editor
filling the middle of the screen has no business closing with a bar it is not in. Beside
the board rather than inside it, too — the board shows a spinner while it is read again, which
is what a run's write is answered with, and a run marking a card must not close an editor somebody
is typing in.

It is the same flow node there, not a copy of it: both faces write through the same calls, and the
draft they type into is one draft held above them by `FlowNodeEditing-ctx`. There is nothing to
apply and nothing to lose, closing is closing, and the panel shows what was typed in the large
editor the moment that editor goes — as the large editor shows what was typed in the panel while the
panel's tab was hidden.

**From a template.** Both faces carry, on the line above the description, the **template** the
description is written from — a select of the store's flow node templates and the button that
instantiates the one it names. See [Flow node templates](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md#flow-node-templates).

**Reopening.** The board reads when it opens and holds nothing once it is closed:
leaving it drops what it held, and coming back reads it afresh — a played turn may well have
rewritten it meanwhile.

Cards move by drag, across the canvas, following the pointer to where they are let go. A mouse
drag starts anywhere on the card; a finger on it belongs to the scrolling canvas.

### Several cards at once

**<kbd>Ctrl</kbd>-click marks a card** — <kbd>Cmd</kbd> where that is the key — and the marked cards
are the ones the *next gesture* acts on: dragging any one of them carries them all,
<kbd>Delete</kbd> — *Suppr* on a French keyboard — takes them all off, **Copy** puts them all on
the clipboard and **Cut** does both, and **Move to…** files them on another board. A second
Ctrl-click un-marks a card, Esc gives the whole set back, and any plain click
starts again from one card. A board is
arranged by hand, and arranging is done in armfuls: five cards moved aside on a Friday were five
drags, five confirmations and five chances to drop one in the wrong place.

**One rule, on every gesture: what is aimed at a marked card is about every marked card, and what is
aimed at an unmarked one is about that card alone.** So a drag begun on a card that is not marked
moves that card and gives the marks up — the gesture has said which card it means, and marks left
standing would be cards the next Delete took without being asked for. The card's own menu
follows the same rule and **says so**: its Delete reads *Delete 3 flow nodes* where three are
marked, and its Copy *Copy 3 flow nodes* and its Cut *Cut 3 flow nodes*, because a menu offering to
do something to "the flow node" on a card plainly picked out with two others is a menu that lies
about what the click does. The Copy says it for a second reason: a clipboard is written out of
sight, and the count in the item is the only description of it there is before it is pasted in
another store. The Cut says it for both — it writes that clipboard, and the cards it names are
leaving the board.

**Marking is not opening.** The flow node panel goes on showing whatever flow node was open: picking
out five cards must not be five flow nodes opened and five editors reloaded on the way, and the box
somebody is typing in is not a thing a click elsewhere on the board throws away. The two are drawn
the same all the same — one shade for "this gesture is about these cards" — because to the eye they
*are* one thing, and a board that shaded them differently would be teaching a distinction the next
click undoes.

Two limits, both deliberate. A mark on a card the [tag filter](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md#tags) is hiding is left out of every
gesture: a group drag would otherwise carry off a card nobody could see, and a delete would take one
without ever having shown it. [Archiving](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#archiving) is one card at a time — and so is [Clone](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#clone), which files its copy under the card the menu was opened on.

**What it costs the board is one edit**, not one per card: `removeFlowNodes` and
`insertFlowNodes` in `boardOps` take a list, so several cards deleted or pasted together land
as a single write and the board is never caught holding half of a deletion. A delete of
several asks once and **names them** in the question, because a count is not something a hand can
check itself against and those cards are about to be gone; the chats they orphan are asked about
once too, however many.

**Where the cards are is asked of the document**, at pointer time, and never
remembered — `boardDom`. The two drags a board has (moving a card, drawing a
chain) both aim at something under the pointer, and a register the elements write themselves into
through a ref cannot answer that here: a card sits inside an antd `Dropdown` for
its context menu, and that wrapper composes the ref once and never renews it. The register would
therefore hold the place each card had *when it mounted*, and a board is rearranged all day — so once
anything had moved, a chain would land on the wrong card until the page was reloaded. Asking the
document is never out of date.

## What a card shows

A board is **read** far more often than it is edited, and mostly without opening anything: forty
cards, and the questions asked of them are *which of these is mine*, *what is this
one about*, and *what is that one going to run*. The card answers all three without being opened.

**The title line says which of the two kinds of work it is**, in the place the card is played
from. An [AI](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types) card carries the ordinary Play triangle, and a **Human** card, which nobody
plays, wears a person in that same slot as a mark rather than a button. An AI card without a Play
is left unmarked in that slot, because the mark at its foot already says it cannot be played.

**The three the board plays to itself are not cards.** A **Shutdown** and a **Scheduler** are drawn
as a BPMN event's circle, a **Gateway** as a BPMN gateway's diamond, with the label under the shape
— the same title, tags, state and bubbles a card wears, centred. The shape is no button: the three
are never played directly — a run reaches them through a chain — so the shape carries the kind
mark, the power symbol, the clock and the plus, and the node opens the way a card does. The ring
is the status, the colour a card wears as its stripe, and the chain knob sits at the shape's right
edge.

**Under the title are the [tags](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md#tags)**, and after them nothing but the card's state and its
bubbles. **The description is not on the card.** A card is found by its title and its tags, and what
is being asked is read where it can be read whole: the panel, or the large editor. What the card
carries is what fits on one.

**At the foot are the bubbles**: worn in the shape the tags above them are worn in — a card is filed
under words and played with words, and the eye reads a second row of something it has already learnt
the shape of. An AI card wears **its agent**; a Scheduler wears the hour it is holding for, a
Shutdown the one word it is, and a Gateway the count of its branches. A card that cannot be played
as it stands wears one mark instead of
the row, in the colour an error wears everywhere on this board.

**The agent is the only setting a settled card names**, by the name the store keeps for the id. It is
the word that says what the turn costs and how well it will think, which is the one thing about a
played card worth finding without opening it. The folder is not worn because it is the longest thing
the settings hold and says the same thing on every card of a board whose work is in one tree. The
effort and the permission mode are not worn because they are read in the panel, beside the agent,
which is where they are set. A card written before managed agents wears its model, as
it always did.

Anything **missing** is what the mark stands for — an agent, an effort, a mode, a folder, or the
hour — because that is not a setting, it is the reason the card carries no Play (`settingsChips`
in `flowNodeSettings.ts` flags each of them). The list lives in the panel instead, where each
field it names is highlighted. Above the bubbles sits the one line about **where the flow node
stands**, which the [status](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md#status-and-chat) section describes.

