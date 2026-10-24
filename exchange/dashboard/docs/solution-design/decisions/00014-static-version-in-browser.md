---
id: "00014"
title: "a `.src.md`'s static version is generated in the browser, not by an action"
status: accepted
date: 2026-08-24
tags: ["dashboard", "markdown", "diagrams", "static"]
components: ["dashboard"]
paths: []
symbols: ["markdown-renderer/static", "prepareSvg", "intrinsicSize.ts"]
triggers: ["static version", ".src.md", "export SVG", "blank labels", "foreignObject", "mermaid size"]
supersedes: []
superseded_by: []
---

# 00014 — a `.src.md`'s static version is generated in the browser, not by an action

**Decision:** **Generate static version** on a `.src.md` is a Dashboard contextual-menu entry that
does the work in the tab — drawing each diagram with the renderers already loaded, writing one SVG
per diagram into a sibling `<name>.assets/` folder and the document beside the source with `.src`
removed. The engine is `markdown-renderer/static`; worker is not involved beyond storing the
files. **Why:** the declared extension point for "an operation a client may run on a file" is the
action manifest, and this looks exactly like one. But an action is a URL, and the provider would
have to draw mermaid, archdia, archtools-graph and PlantUML *headlessly*, behind a JSDOM shim that
approximates text metrics because there is no layout engine to ask. The browser has one, and has
all four renderers loaded already. Deployment settles it: `KIAO_WORKER_ACTIONS_PATH` is set
in `config/prod` alone, so an action-shaped implementation would be absent from the Docker image,
the Windows standalone and `bin/local-start-kiao.sh` — every place a document is actually written.
The consequence to accept: generating needs an open tab.

**What the convention buys.** `foo.md` is the output of `foo.src.md` by name alone — no index, no
manifest, no state to keep in step — so a source and its static version are renamed, moved and
copied together by anything that moves files, `LinkFixer` included. Regeneration overwrites; the
tail of an asset folder is left behind when a document loses diagrams, which is a stale file and
never a wrong one. Nothing is deleted, deliberately: every delete runs `fixAfterDelete` across the
store, and a generated picture is not worth a link-fixing pass over everything.

**The two traps found in the doing**, both in what an SVG means outside the page that drew it. A
`<foreignObject>` holds HTML, which a browser lays out only for an SVG that is part of a document —
an `<img>` is not one, so every archdia, graph and mermaid label would have come out blank;
`prepareSvg` already flattened them to native `<text>` for the clipboard, and that is why it is
shared rather than reimplemented. And mermaid draws for a page: `width="100%"` and no height, which
in an `<img>` is no intrinsic size at all, so the picture stretched to the viewer's width at ten
times the intended text size. `intrinsicSize.ts` takes both from the viewBox.
