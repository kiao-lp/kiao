# Static versions (`plugins/markdown-edit/StaticVersionPlugin.tsx`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A **`.src.md`** is an ordinary markdown document — `markdown-edit` opens it like any other — that
declares its own generated output. Its contextual menu carries **Generate static version**, which
draws every diagram in it, writes one SVG per diagram into a sibling `<name>.assets/` folder, and
writes the document beside the source with `.src` taken out. In that copy a diagram is an
`![…](<../../../../exchange/dashboard/docs/solution-design/name>.assets/01-mermaid.sv>)`, so the file reads in anything that reads markdown — GitHub, an
IDE preview, a plain browser — with no renderer of its own.

The convention is the whole contract: no index, no manifest, no state to keep in step, so a source
and its static version survive being renamed, moved or copied by anything that moves files. The
source is only ever read; a generation writes `<name>.md` and the asset folder, overwriting what
was there — regenerating is the normal case, and `foo.md` is by construction the output of
`foo.src.md`.

- **`staticVersion.ts`** — the path arithmetic, and nothing else: `.src.md` → output, asset folder.
- **`cms-core/markdown/static`** — the engine (`generateStaticMarkdown`). Pure in the sense that
  matters: it is handed markdown and hands back markdown plus a list of pictures, so the plugin
  decides where they go. `fences.ts` walks the document as CommonMark does rather than matching
  fences independently, which is what keeps a diagram *quoted inside a longer fence* an example
  instead of replacing it. `intrinsicSize.ts` gives each picture a width and height taken from its
  viewBox — mermaid emits `width="100%"`, which means nothing to an `<img>` and leaves the diagram
  stretched to whatever width the viewer offers.
- A diagram that fails to draw keeps its fenced source in the output and is named in the toast. A
  hole would lose the content, and a baked-in error page would hide the loss behind something that
  looks deliberate.

**Why not a server file action.** It is the same menu group and it *is* an action on a file, but
the renderers it needs — mermaid, archdia, graph, and the PlantUML server the preview
already talks to — are loaded and correct in this tab. A provider would have to reproduce all four
headlessly — behind a JSDOM shim, with no layout engine to ask for text metrics — and be deployed
beside every worker. A provider service exists nowhere today, so the entry would be
missing from the Docker image and `bin/local-start-kiao.sh` — every place a
document is actually written. See `exchange/dashboard/docs/solution-design/decisions/00014-static-version-in-browser.md`.
