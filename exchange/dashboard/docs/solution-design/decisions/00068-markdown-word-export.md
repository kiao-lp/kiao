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

**Decision:** the Markdown toolbar calls the editor body's `downloadDocx`. It captures the controlled `value`, including unsaved edits, and passes it to the `@cms-core` exporter. Rendering does not require a mounted preview. All resources stay in memory until one DOCX blob downloads. No assets folder or conversion service is created.

The parser uses GFM and the preview's `kiao:diagram` passes. Diagram code nodes become image nodes in place, preserving order. `prepareDiagramSvg` shares the static-export renderers, Mermaid queue, `prepareSvg` and intrinsic sizing. Rendering is light regardless of theme. PlantUML uses the configured render server during generation; its SVG is embedded.

The lazy-loaded docx library generates native OOXML paragraphs, heading styles, list numbering, tables, hyperlinks, code and embedded images. It sits behind `@cms-core` in the shell's lazy graph; plugins need no new import. No HTML altChunk is used.

Every SVG image carries a DrawingML PNG relationship and an `asvg:svgBlip` relationship to the SVG part. Office 2019+ reads the SVG; older readers and LibreOffice use the PNG. Text is editable; diagrams stay vector pictures. Layout fidelity and vector editing in readers are not promised.

Resources load via the authenticated store client or browser fetch. SVG references and CSS URLs are embedded, HTML labels become SVG text, computed styles are captured in an isolated light document. Intrinsic fractional dimensions set the Word extent. Pictures shrink into A4's content area. Raster previews render at twice display size.

Generation is sequential with phase reporting. Invalid diagrams, inaccessible resources, unsupported active HTML and unembeddable SVG dependencies stop the download with a diagnostic. No partial document is produced. Concurrent clicks are guarded. Network and remote fetches have a 30-second bound.

PDF stays separate. Word uses a neutral native style; PDF CSS has no OOXML translation.

**Verification:** `markdown-docx.spec.ts` inspects the downloaded ZIP, native text, SVG/PNG relationships, references, order and dimensions. PlantUML uses deterministic fixtures, including an HTTP failure.
