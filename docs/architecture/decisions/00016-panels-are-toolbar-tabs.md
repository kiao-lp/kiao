---
id: "00016"
title: "every panel is a tool bar tab the document places, not a fixture of the layout"
status: accepted
date: 2026-08-26
tags: ["dashboard", "layout", "panels"]
components: ["dashboard"]
paths: []
symbols: ["dashboard-view-state.json", "LayoutContent", "TopBanner", "BARS", "toolBars"]
triggers: ["new panel", "panel placement", "Show menu", "column on/off", "FileNavigationBarCmp", "stacked bars"]
supersedes: []
superseded_by: []
---

# 00016 — every panel is a tool bar tab the document places, not a fixture of the layout

**Decision:** Dashboard's chrome is a top bar over three columns, and everything that is not the open
document — browsing the store, Git, the Claude chat, a plugin's panel — is a **tab** the user puts
in the top bar, the left column or the right column, or takes out of the layout entirely. The
placement is chosen from a **Show** sub-menu of the top banner's tools dropdown: one entry per tab,
each opening on that same picture of the app, with the rectangle the tab is in greyed. Clicking
another rectangle moves it there; clicking its own takes it out. A bar offers its strip of tab icons
only from two tabs on, and a bar nothing is placed in is not drawn. Each column is switched on and
off by the button at the end of the banner it sits at.

**What it replaced.** Two hard-coded fixtures. The file navigation was a bar with a three-state
button cycling horizontal → vertical → hidden, rendered by every plugin's main view as
`<FileNavigationBarCmp/>`; the lateral toolbar was a single right-hand panel with its own visible
flag. Two mechanisms, two vocabularies, and the navigation could only ever be in the two places its
own enum named.

**Why.** The screen is the scarce resource and which panel deserves it depends on the document, not
on what the framework decided when the panel was written. Making placement one uniform notion
collapses the two mechanisms into one and buys the moves neither had: the navigation tree down the
*right* column, Git across the top, a panel dismissed without hiding its neighbours. It also takes
the layout out of the plugins — a main view now renders `<LayoutContent>` and `<TopBanner/>` and
nothing else, where each one used to place the navigation bar by hand.

**Where it is remembered.** Which tab is in which bar is per document, in `dashboard-view-state.json`
like the scroll offset and the zoom. A document that has never been arranged inherits **the
arrangement last chosen**, written app-wide beside it: without that, clicking a file in the
navigation tree would take the tree away, since the document being opened has no arrangement of its
own and the tab would fall back to the top bar it ships in. A document that *has* been arranged
keeps its own whatever is done elsewhere. Whether a column is on, and how wide it is, is app-wide
only — those describe the window, not the document.

**The one tab that knows where it is.** `render` is handed the bar it landed in, so the file
navigation is the open folder's entries on one line across the top and the whole store as a tree
down a column. That is what lets the old three-state button be a single tab moved around a grid,
with nothing of the feature lost.

**Anticipated, not built.** A side may later hold several bars stacked vertically. Hence a placement
names a *bar* rather than a side, `BARS` is a list rather than three constants, and a column's width
belongs to the side rather than to a bar — a split column is still one column. Splitting the left
one is one entry in `BARS` plus the stacking; nothing else asks how many there are.
