---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-16
tags: ["markdown", "docx", "themes", "export", "svg", "dashboard"]
triggers: ["Word theme", "DOCX theme", "branded Word export", "Word theme menu", "Word export", "DOCX", "SVG fallback", "editable document", "resolveWordTheme", "WordExportMenu", "exportMarkdownToDocx", "downloadDocx"]
supersedes: []
superseded_by: []
---

# 00052 — Markdown exports native Word in browser, with store themes.

## Context and Problem Statement

Word export needs editable native text, diagrams and authenticated resources from the
current editor value, including unsaved changes. Branding should reuse store PDF themes.

## Considered Options

* Generate native OOXML in the browser and map the store theme palette to Word styles.
* Use an HTML altChunk in the Word document.
* Create export assets or a conversion service.

## Decision Outcome

Chosen option: "Generate native OOXML in the browser and map the store theme palette to Word styles",
because the browser has the loaded renderers and resources and both exports can share branding.

The toolbar calls the editor body's `downloadDocx`, passing controlled `value` to
`@kiao-dashboard-core`. The preview need not be mounted. Resources stay in memory until
one DOCX blob downloads, without an assets folder or conversion service.

GFM and the preview's `kiao:diagram` passes replace diagram code with images in order.
`prepareDiagramSvg` reuses static-export renderers, the Mermaid queue, `prepareSvg`
and intrinsic sizing. PlantUML's configured server renders its embedded SVG.
Rendering uses an isolated light document regardless of application theme.

The shell lazy-loads docx behind `@kiao-dashboard-core`; plugins need no additional import.
It produces native OOXML paragraphs, headings, numbering, tables, hyperlinks, code and images,
without HTML altChunk. Each SVG has a DrawingML PNG relationship and `asvg:svgBlip`
relationship: Office 2019+ uses SVG, older readers and LibreOffice use PNG. Text is editable;
diagrams remain vector pictures without promised layout fidelity or vector editing.

Resources use the authenticated store client or browser fetch. SVG references and CSS URLs
are embedded, HTML labels become SVG text, and computed styles are captured. Intrinsic
fractional dimensions set Word extents, pictures fit A4 content, and raster previews render
at twice display size. Sequential generation reports phases, guards concurrent clicks and
bounds network fetches at 30 seconds. Invalid diagrams, inaccessible resources, unsupported active HTML
or unembeddable dependencies stop the download with a diagnostic and no partial document.

Each theme-menu opening uses `loadPdfThemes` for `kiao-user-config/pdf-themes/*.json`.
One-click neutral export stays available; an arrow selects a theme. The existing worker
synchronization serves both exports. Only palette values map to OOXML: body, heading and link
colors (link wins), quotation border, table headers, code fill and rules. `#rgb`,
`#rrggbb`, `black` and `white` are supported; other entries fall back to neutral.
Theme CSS and header HTML remain PDF-only.

### Confirmation

`wordThemes.test.ts`, `generateMarkdownDocx.test.ts`, `WordExportMenu.test.tsx`,
`markdown-docx.spec.ts` and `markdown-word-themes.spec.ts` cover native text, image
relationships, resource failures, order, dimensions and palette mapping.
