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

**Decision:** the Word export offers the same store themes as the PDF menu:
`kiao-user-config/pdf-themes/*.json`, read through `loadPdfThemes` each time
the menu opens, with the neutral export always available. The toolbar keeps its
one-click neutral button; an arrow beside it opens the theme list, so the
existing Word scenario is untouched. The exporter applies only the theme's
palette to native OOXML formatting — body text, heading colors, link color
(winning over headings, as in print), quotation border, table header fill,
code fill and rule color. Supported notations are `#rgb`, `#rrggbb`, `black`
and `white`; any other entry falls back to the neutral style on its own. A
theme's arbitrary CSS and header HTML stay PDF-only.

**Why:** one branding file serves both exports with no rebuild and no new
store folder or worker synchronization. A full CSS translation to OOXML does
not exist, so 00068's reason stands for `css` and `headerHtml` — only the
palette, whose entries already name print colors, maps onto native Word
properties without guessing.

**Refactor notes.** Partially supersedes 00068: its "neutral native style, no
Word theme" clause becomes "neutral by default, palette themes on choice". The
rest of 00068 — browser-only native generation, SVG/PNG dual embedding,
sequential progress, no partial document — is unchanged.

**Verification:** `wordThemes.test.ts` (notation parsing, per-entry fallback),
`generateMarkdownDocx.test.ts` (themed paint, neutral output unchanged),
`WordExportMenu.test.tsx` (one-click neutral, theme choice). `markdown-docx.spec.ts`
keeps its assertions; its recovery test moves the mouse off the error toast first,
since the wider toolbar group leaves the resting cursor under it and a hovered toast
never fades. `markdown-word-themes.spec.ts` downloads with a picked theme
and reads its heading color back from the ZIP.
