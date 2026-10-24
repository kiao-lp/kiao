# Tool bars (`src/cms-core/tool-bars/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Dashboard has **left, central and right panel areas**. The middle one holds
the open document, and any other tab the document puts beside it — browsing the store, Git, the
Conversations tab, a plugin's own panel — and where each tab is drawn is the user's, chosen per
document.

```
┌────────┬──────────────────┬─────────┐
│  left  │  document + …    │  right  │
└────────┴──────────────────┴─────────┘
```

The document is a **tab pinned to the centre**
([`core/DocumentPanel.tsx`](../../src/cms-core/core/DocumentPanel.tsx)): it stays in the centre whatever
the arrangement says, leads the strip, and is never taken out of the layout. Other tabs can be
placed beside it. Every panel moved to the centre turns the app into one column with
a chooser, instead of three columns none of which fits.

**The Show menu** is where a tab is moved. It sits in the top banner's tools dropdown
([`top-banner/ShowMenu.tsx`](../../src/cms-core/top-banner/ShowMenu.tsx)) and lists every registered tab
but the pinned one — there is nothing to choose for the document, so it is not offered. Each opens
on that same picture of the app
([`tool-bars/LayoutGrid-cmp.tsx`](../../src/cms-core/tool-bars/LayoutGrid-cmp.tsx)), with the rectangle
the tab is in greyed. Clicking another rectangle moves it there — bringing it back into the layout
if it had been taken out. Clicking **its own** rectangle takes it out: a panel is dismissed where it
is shown, and a tab that is out is listed dimmed.

The grid contains the left column, one to three central areas, and the right column. The
**Central areas** menu chooses the count. Reducing it moves panels from removed areas to the
first central area. Saved placements in a removed bar fall back to the tab's default.

**A bar holds as many tabs as are put in it.** Its strip shows when it holds multiple tabs or its
active tab has controls. Tabs stay on the left; the active tab's `additionalPanels` appear on the
right. Main views pass the document's controls through `LayoutContent.additionalPanels`.
`TopBanner` holds application controls, including its own zoom slider and menu contributions.

A single tab without controls needs no strip. An empty bar is not drawn. A tab mounts when it is
first looked at — except the document, which is mounted
whether the centre is showing it or not, since its editor and stack followers must
never depend on a tab visit.

**Each side column is switched on and off** from the end of the top banner it sits at
([`top-banner/BarToggle.tsx`](../../src/cms-core/top-banner/BarToggle.tsx)) — one gesture for "give me
the screen back", distinct from arranging what the column holds. A column the open document puts
nothing in has nothing to switch, so its button is disabled rather than removed: the ends of the
banner are landmarks, and a banner whose ends move is harder to aim at. The outer edge of each
side column is its resize handle, and a width remembered from a wider screen is clamped back inside
the window, handle included, so a column can always be narrowed again. The centre is never switched
off and has neither width nor handle of its own: it takes whatever the columns leave.

**What is remembered where.** Which tab is in which bar is **per document**, like the panes or
the zoom — a board wants its flow node panel, a unit wants the navigation tree, and neither
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

The rules are pure functions in [`barsModel.ts`](../../src/cms-core/tool-bars/barsModel.ts), which knows
nothing of React: the menu, the bars and the tests all read the same answers from it.

**Anticipated, not built:** a side may one day hold **several bars stacked vertically**. That is why
a placement names a *bar* rather than a side, why `BARS` is a list, and
why a column's width belongs to the side rather than to a bar — a split column is still one column.
Splitting the left one is then a single entry in `BARS`, `ToolBarsSide` stacking what it is given,
and the grid drawing one rectangle per bar of that column. Nothing else asks how many there are.
