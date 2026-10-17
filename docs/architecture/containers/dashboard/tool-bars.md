# Tool bars (`src/cms-core/tool-bars/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Dashboard is **a top bar over three columns, and every column is a bar**. The middle one holds
the open document, and any other tab the document puts beside it — browsing the store, Git, the
Conversations tab, a plugin's own panel — and where each tab is drawn is the user's, chosen per
document.

```
┌─────────────────────────────────────┐
│              top bar                │   ← the file navigation, by default
├────────┬──────────────────┬─────────┤
│  left  │  document + …    │  right  │   ← Git, the Conversations tab, a plugin's panel, by default
└────────┴──────────────────┴─────────┘
```

The document is a **tab pinned to the centre**
([`core/DocumentPanel.tsx`](../../../../exchange/dashboard/src/cms-core/core/DocumentPanel.tsx)): it stays in the centre whatever
the arrangement says, leads the strip, and is never taken out of the layout. By default it is the
only tab there and no strip shows; from the first tab put beside it, it has a tab of its own. That
is what a narrow screen wants: every panel moved to the centre turns the app into one column with
a chooser, instead of three columns none of which fits.

**The Show menu** is where a tab is moved. It sits in the top banner's tools dropdown
([`top-banner/ShowMenu.tsx`](../../../../exchange/dashboard/src/cms-core/top-banner/ShowMenu.tsx)) and lists every registered tab
but the pinned one — there is nothing to choose for the document, so it is not offered. Each opens
on that same picture of the app
([`tool-bars/LayoutGrid-cmp.tsx`](../../../../exchange/dashboard/src/cms-core/tool-bars/LayoutGrid-cmp.tsx)), with the rectangle
the tab is in greyed. Clicking another rectangle moves it there — bringing it back into the layout
if it had been taken out. Clicking **its own** rectangle takes it out: a panel is dismissed where it
is shown, so there is no fifth rectangle standing for nowhere, and a tab that is out is listed
dimmed.

**A bar holds as many tabs as are put in it**, and offers the strip of icons to switch between them
only from two on: one tab needs no chooser, and a bar holding the navigation alone is the width of
the app — a whole line spent saying which of one panel is showing. A bar nothing is placed in is
not drawn at all. A tab mounts when it is first looked at — except the document, which is mounted
whether the centre is showing it or not, since its editor, scroll memory and stack followers must
never depend on a tab visit.

**Each side column is switched on and off** from the end of the top banner it sits at
([`top-banner/BarToggle.tsx`](../../../../exchange/dashboard/src/cms-core/top-banner/BarToggle.tsx)) — one gesture for "give me
the screen back", distinct from arranging what the column holds. A column the open document puts
nothing in has nothing to switch, so its button is disabled rather than removed: the ends of the
banner are landmarks, and a banner whose ends move is harder to aim at. The outer edge of each
side column is its resize handle, and a width remembered from a wider screen is clamped back inside
the window, handle included, so a column can always be narrowed again. The centre is never switched
off and has neither width nor handle of its own: it takes whatever the columns leave.

**What is remembered where.** Which tab is in which bar is **per document**, like the scroll offset
or the zoom — a board wants its flow node panel, a unit wants the navigation tree, and neither
should have to be arranged again on the way back. Whether a column is switched on, and how wide it
is, is **app-wide**: those describe the window rather than the document. A document nobody has
arranged answers with each tab's own declared default, which is what makes the app open the way it
always did. The selected tab of a bar is *derived* rather than stored (`activeTabIn`), so merely
opening a document never writes to the state file — and a document that never chose in the centre
opens on the document rather than on the tab last looked at elsewhere, since inheriting that would
open files behind a panel.

**The document is where navigation lands.** Opening a file while another tab of the centre is
showing brings the document back in front — a click in the file tree that left a panel covering the
file just opened would read as a click that did nothing. The same goes for a panel pushed on the
stack, which covers the document and nothing else: the search results opened from the top banner
while the Git tab is up arrive with the document in front of them. A tab chosen by hand afterwards
is left alone in both cases.

The rules are pure functions in [`barsModel.ts`](../../../../exchange/dashboard/src/cms-core/tool-bars/barsModel.ts), which knows
nothing of React: the menu, the bars and the tests all read the same answers from it.

**Anticipated, not built:** a side may one day hold **several bars stacked vertically**. That is why
a placement names a *bar* rather than a side, why `BARS` is a list rather than four constants, and
why a column's width belongs to the side rather than to a bar — a split column is still one column.
Splitting the left one is then a single entry in `BARS`, `ToolBarsSide` stacking what it is given,
and the grid drawing one rectangle per bar of that column. Nothing else asks how many there are.
