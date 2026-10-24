---
id: "00067"
title: "Markdown PDF themes are store documents with synchronized defaults"
status: accepted
date: 2026-10-15
tags: ["markdown", "pdf", "themes", "store"]
components: ["worker", "dashboard"]
paths: ["kiao-user-config/pdf-themes", "operation/worker/internal/files/pdfthemes"]
symbols: ["SyncPdfThemes", "loadPdfThemes", "PdfTheme", "printMarkdownToPdf"]
triggers: ["PDF theme", "print header", "custom logo", "theme synchronization", "branded export"]
supersedes: []
superseded_by: []
---

# 00067 — Markdown PDF themes are store documents with synchronized defaults

**Decision:** the Markdown PDF menu reads `kiao-user-config/pdf-themes/*.json` through the
ordinary file API each time it opens. A filename identifies one theme; its `label` names the
menu choice. Optional CSS custom properties, CSS text and header HTML customize the neutral
print layout. Header placeholders insert the escaped document title and current date.
The [theme README](../../../operation/worker/internal/files/configuration/pdfthemes/README.md) is the format reference.

**Why:** a store's document branding is store content. A custom theme, including a logo embedded
as a data URL, travels as one file and becomes usable without a frontend rebuild, a plugin project
or a restart. The public distribution carries generic defaults and no organization-specific theme.

**Delivered defaults follow the build.** Worker embeds `internal/files/pdfthemes/` and
synchronizes its filenames into the store on every start, restoring missing files and replacing
changed contents. Identical files are left untouched. A custom theme uses another filename and
is never changed or removed by that pass; customizing a delivered theme starts by copying it.
This deliberately differs from the import gate's seed-once behavior: the shipped print themes
are maintained defaults, while custom themes remain the store's own documents.

**The exporter stays generic.** It receives a loaded theme object and applies its styles only to
the print tab. Diagram preparation, heading grouping and print layout remain shared by all themes.
The menu skips invalid or unreadable documents and always keeps a neutral export available, even
with an older worker or a missing configuration folder.
