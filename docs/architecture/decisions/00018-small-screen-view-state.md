---
id: "00018"
title: "a small screen keeps its view state in a document of its own"
status: accepted
date: 2026-08-26
tags: ["dashboard", "layout", "mobile"]
components: ["dashboard", "worker"]
paths: []
symbols: ["dashboard-view-state.json", "dashboard-view-state-small.json", "viewStateDocFor", "files/configdocs.go"]
triggers: ["phone layout", "small screen", "768px", "columns closed on desktop", "user-agent sniffing"]
supersedes: []
superseded_by: []
---

# 00018 — a small screen keeps its view state in a document of its own

**Decision:** the view state config document is chosen by viewport width at load —
`dashboard-view-state.json` above 768 px, `dashboard-view-state-small.json` at 768 px and below
(`viewStateDocFor`, allow-listed in `files/configdocs.go` beside its sibling). **Why:** the same store is
browsed from a phone and from a desktop, and what this document holds *is* the layout: which
columns are switched on, how wide they are, which tab sits in which bar. A phone has room for one
column and closes the rest; writing that into the shared document closed them on the desktop too,
and the desktop's answer was just as wrong on the phone — each visit undid the last one's
arrangement of the very same files. Two documents let each screen keep its own.

**Width, not the device.** No user-agent sniffing and no touch heuristic: 768 px is the breakpoint
the stylesheets already lay out for, so the document that is chosen and the layout it describes
always agree. A desktop window dragged narrow gets the small-screen layout from the CSS, and now
gets the state written for it too — which is the point, not a side effect.

**Chosen once, at load.** The provider reads the width when it mounts and keeps that document for
the session. Switching mid-resize would mean re-seeding every mounted pane from a document it has
never read, which is exactly the paint-the-default-first flicker view state exists to avoid; the
next load picks up the right one. Everything else is unchanged — same shape, same per-file keying,
same debounce, same re-read-before-write merge, which now simply happens per document.
