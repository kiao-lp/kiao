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

**Decision:** **Generate static version** runs in the browser tab. It renders each diagram with the loaded renderers, writes one SVG per diagram to `<name>.assets/` and the document beside the source with `.src` removed. The engine is `markdown-renderer/static`. The worker only stores the files. Generation requires an open tab.

Generation uses the browser layout engine and the loaded Mermaid, ArchDia, graph and PlantUML renderers. A server action requires headless rendering without a layout engine. `KIAO_WORKER_ACTIONS_PATH` is set only in `config/prod`, so an action is absent from the Docker image, Windows standalone and `bin/local-start-kiao.sh`.

`foo.md` is the output of `foo.src.md` by name alone. Source and output rename, move and copy together, including via `LinkFixer`. Regeneration overwrites outputs. Stale assets remain; no delete runs a store-wide link fix.

SVG traps: `<foreignObject>` HTML does not lay out inside an `<img>`, so `prepareSvg` flattens labels to `<text>`. Mermaid emits `width="100%"` with no height, so `intrinsicSize.ts` reads intrinsic size from the viewBox.
