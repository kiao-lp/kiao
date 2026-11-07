---
id: "00069"
title: "Word export offers the store PDF themes as native palette themes"
status: accepted
date: 2026-10-16
tags: ["markdown", "docx", "themes", "export"]
components: ["dashboard"]
paths: ["exchange/dashboard/src/cms-core/markdown", "exchange/dashboard/src/kit/MarkdownEditor"]
symbols: ["resolveWordTheme", "WordExportMenu", "exportMarkdownToDocx", "downloadDocx"]
triggers: ["Word theme", "DOCX theme", "branded Word export", "Word theme menu"]
supersedes: ["00068"]
superseded_by: []
---

# 00069 — Word export offers the store PDF themes as native palette themes

**Decision:** Word export offers the store PDF themes: `kiao-user-config/pdf-themes/*.json`, read via `loadPdfThemes` each time the menu opens. The neutral export is always available. The toolbar keeps its one-click neutral button; an arrow opens the theme list. The exporter applies only the theme palette to native OOXML: body text, heading colors, link color (wins over headings), quotation border, table header fill, code fill and rule color. Supported notations: `#rgb`, `#rrggbb`, `black`, `white`. Any other entry falls back to neutral alone. Theme CSS and header HTML stay PDF-only.

One branding file serves both exports. No new store folder or worker sync is needed. Only the palette maps to native Word properties.

**Refactor notes.** Partially supersedes 00068: neutral by default, palette themes on choice. Browser-only generation, SVG/PNG dual embedding, sequential progress and no partial document hold.

**Verification:** `wordThemes.test.ts`, `generateMarkdownDocx.test.ts`, `WordExportMenu.test.tsx`, `markdown-docx.spec.ts`, `markdown-word-themes.spec.ts`.
