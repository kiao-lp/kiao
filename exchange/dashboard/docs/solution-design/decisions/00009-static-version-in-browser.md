---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-24
tags: ["dashboard", "markdown", "diagrams", "static"]
triggers: ["static version", ".src.md", "export SVG", "blank labels", "foreignObject", "mermaid size", "markdown-renderer/static", "prepareSvg", "intrinsicSize.ts"]
supersedes: []
superseded_by: []
---

# 00009 — Static .src.md versions generate in browser tab.

## Context and Problem Statement

Static versions need the browser layout engine and loaded diagram renderers. A server
action would require headless rendering and an assembly-provided action manifest, which
base builds do not supply by default.

## Considered Options

* Generate the static version in the open browser tab.
* Generate the static version through a server action.

## Decision Outcome

Chosen option: "Generate the static version in the open browser tab", because the tab
already has the layout engine and Mermaid, ArchDia, graph and PlantUML renderers.

**Generate static version** uses `markdown-renderer/static` to write each diagram as an SVG
in `<name>.assets/` and a document beside the source with `.src` removed. Worker stores
the files; generation requires an open tab.

`foo.src.md` and its output `foo.md` are associated by name. They rename, move and copy
together, including through `LinkFixer`. Regeneration overwrites outputs. Stale assets
remain so deletion does not trigger a store-wide link fix.

## More Information

`prepareSvg` flattens `<foreignObject>` HTML labels to SVG `<text>`, since HTML does not
lay out inside an `<img>`. For Mermaid's `width="100%"` without a height,
`intrinsicSize.ts` derives intrinsic dimensions from the viewBox.
