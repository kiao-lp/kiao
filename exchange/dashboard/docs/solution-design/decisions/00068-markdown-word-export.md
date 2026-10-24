---
id: "00068"
title: "Markdown exports native Word content with embedded SVG diagrams in the browser"
status: accepted
date: 2026-10-15
tags: ["markdown", "docx", "svg", "export"]
components: ["dashboard"]
paths: ["exchange/dashboard/src/kit/MarkdownEditor", "exchange/dashboard/src/cms-core/markdown"]
symbols: ["exportMarkdownToDocx", "prepareDiagramSvg", "standaloneWordSvg"]
triggers: ["Word export", "DOCX", "SVG fallback", "editable document"]
supersedes: []
superseded_by: ["00069"]
---

# 00068 — Markdown exports native Word content with embedded SVG diagrams in the browser

**Decision:** the shared Markdown toolbar calls the editor body's `downloadDocx` command. It
captures the controlled `value`, including edits awaiting autosave, and passes it to the public
`@cms-core` exporter. Rendering does not depend on a mounted preview. All resources remain in
memory until one DOCX blob is downloaded; no assets folder or conversion service is created.

The Markdown parser uses GFM and the preview's `kiao:diagram` restoration/hiding passes, so
ordinary fences, nested fences, tildes, longer fences and wrapped diagrams follow its semantics.
Diagram code nodes are replaced in place by image nodes, preserving their order among paragraphs,
lists and tables. `prepareDiagramSvg` shares the static exports' existing renderers, Mermaid
queue, `prepareSvg` and intrinsic sizing. Rendering is light regardless of Dashboard's theme.
PlantUML uses the configured render server only during generation; its fetched SVG is embedded.

The lazy-loaded [docx](https://docx.js.org/api/classes/index.ImageRun.html) library generates native
OOXML paragraphs, heading styles, list numbering, tables, hyperlinks, code and embedded images.
It lives behind `@cms-core` and is bundled into the shell's lazy module graph, so plugins need no
new bare import or import-map entry. No HTML altChunk is used: it depends on the reader importing
HTML, and does not reliably yield an editable document across Word and LibreOffice.

**SVG and compatibility.** Every SVG image has both an ordinary DrawingML PNG relationship and
an `asvg:svgBlip` relationship to the actual SVG media part. Microsoft's
[SVG extension](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2019.drawing.svg.svgblip)
is available in Office 2019 and later. Older readers can use the PNG, and LibreOffice versions
that do not consume this extension have the same compatibility image. The SVG remains packaged
and referenced in either case. This does not promise identical reader layout or vector editing:
the document text is editable, diagrams remain vector pictures. Runtime generation uses only
browser facilities already shipped with KIAO, without a Word/LibreOffice conversion server.

Resources are loaded through the host's authenticated store client (document-relative images
use the host's image folder) or browser fetch for absolute/data URLs. SVG image references and
CSS URLs are embedded, HTML labels become SVG text, and computed paint, font and geometry styles
are captured in an isolated light document. The SVG has explicit intrinsic dimensions; those
fractional dimensions, rather than rounded browser image dimensions, determine the Word extent.
Pictures shrink proportionally into A4's content area, with space for the containing paragraph.
Raster previews are generated at twice the displayed size, avoiding giant temporary canvases.

**Failures and cost.** Generation is sequential and reports its current diagram, image and
packaging phase. Invalid diagrams, inaccessible resources, unsupported active/visual HTML and
SVG dependencies that cannot be embedded stop the download with an explicit diagnostic. There
is no partial-success document missing a picture. Concurrent clicks are guarded. Network rendering
and remote resource fetches are bounded to 30 seconds. Browser rendering, SVG preparation, PNG
fallbacks and ZIP packing cost CPU/memory in proportion to the document; the DOCX dependencies
are loaded only when needed.

**PDF stays separate.** The PDF menu, theme files, no-store reads and worker synchronization
contract remain unchanged. Word uses a neutral native style; arbitrary PDF CSS has no automatic
OOXML translation and is not offered as a Word theme.

**Verification:** `markdown-docx.spec.ts` inspects the downloaded ZIP, native Word text, SVG/PNG
relationships and content types, document references, order, dimensions and ratios. PlantUML
responses are intercepted deterministic fixtures, including an HTTP failure. It exercises unsaved
source without a preview, all five languages, accents, lists, tables, code and store images.
The PDF themes and static-version scenarios run alongside it. `E2E_BUILT=1` on the ordinary e2e
runner serves the compiled assembly with the same worker/proxies, exercising the real import map;
build before running it, never concurrently.
