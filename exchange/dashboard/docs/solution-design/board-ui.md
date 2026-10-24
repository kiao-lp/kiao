# Dashboard — board UI solution design

Part of the [Dashboard solution design](./README.md). Source paths below are relative to
`exchange/dashboard/src/`; the [global interaction design](/docs/solution-design/interactions.md)
describes the service boundaries.

**A board has its own URL and panel.** `/boards/major` opens the board in the **Board** panel;
`/boards` opens the full list there. The **Boards** panel lists the boards alongside the document.
The Board panel starts in the central area, and Show can move it to another area or hide it.
Documents keep their own Document tab in the central area. Opening a board keeps the document
mounted; opening a document leaves the board, its selection and controls available.

That needed a mechanism Dashboard did not have. Everything in it is a file — the URL is a store path,
and the plugin claiming that path's type draws it — and a board has no path. So the plugin
contract grew **`appRoutes`**: a plugin may claim a URL prefix and draw what is under it
(`cms-core/app-routes`). A route's optional `panel` identifies the toolbar tab to reveal. Its renderer
then runs beside the document to select the board, while routes without a panel replace the
document with their page. cms-core learns a prefix, a component and a panel id; it does not learn
what a board is. The claimed prefix
is not resolved against the file store (or `/boards/major` would become a phantom document), and the
way *in* is the Boards panel and the links it lists.

**The board has its own stack.** Expanded node editors and template forms opened from the board
cover its panel. Document tools such as search results and Git diffs use the document's stack.
The board state and controls live in app-level providers, so changing document types or moving
the Board tab does not close the board.

**A handle, not an id.** The URL carries the slug, and a rename does not move it: a bookmark and a
pasted link name the board, and `major` says which board while a uuid says nothing to the person
reading it.

**What a gesture does.** The board's rules are pure functions
(`plugins/hybridflow-ui/boardOps.ts`). A gesture runs the pure operation locally — so a drag lands
under the hand — and sends **the call that makes it true**, the two given together (`boardWrites.ts`). Nothing diffs
two boards to work out which endpoint to call: deriving it back out of a before-and-after is how a
write becomes a delete-and-create on the day two of them overlap.

**Being told rather than asking.** A request is held by the service until something on this board
changes, so a card a run just marked redraws in the time a notification takes. A re-read is a
**three-way merge** and not a replacement — `mergeBoardContent`, still tested: a run marks a card while
a person is typing in another, and the mark must arrive without taking the keystrokes with it.

**The client mints ids.** A card's id comes from the browser — which is what lets
the card be drawn the instant it is made and what lets pasted cards keep the chains among them. The
service honours a well-formed one and refuses a malformed one rather than substituting another that
nothing on screen names.

**What the store still holds for a board.** An image pasted into a card, and a card archived out of
it: both are files, and both go in the folder named after the board's **handle** — `boards/major`
(`boardFolder`, `boardRoute.ts`). A handle and not a title, so renaming a board does not orphan the
images its cards already link to.

**The rectangles are computed, not placed.** A workflow holds a name and nothing else — no spot of
its own — so the board draws each round the cards that name it, with a small padding and room on
top for the label (`workflowBounds.ts`), the way an archdia container fits its own. A pull on one
carries its members through the same spot drag as a pull on a card (`aimedAt` answers a rectangle
with its members); a click inside one but outside any card opens it in the workflow panel, which is
a name and nothing else, like the rectangle. A rectangle with nothing on screen draws nothing, and
one its last delete emptied goes with its cards — a shape nobody can pick up again is not kept.
