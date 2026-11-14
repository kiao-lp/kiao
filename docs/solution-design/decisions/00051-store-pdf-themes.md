---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-15
tags: ["markdown", "pdf", "themes", "store", "worker", "dashboard"]
triggers: ["PDF theme", "print header", "custom logo", "theme synchronization", "branded export", "SyncPdfThemes", "loadPdfThemes", "PdfTheme", "printMarkdownToPdf"]
supersedes: []
superseded_by: []
---

# 00051 — Markdown PDF themes are store documents; defaults synchronized.

## Context and Problem Statement

Document branding belongs to the store and must travel with its documents. A custom theme,
including a data-URL logo, should work without a rebuild, plugin deployment or restart.

## Considered Options

* Read store-owned PDF theme documents and synchronize delivered defaults.
* Require a frontend rebuild or plugin project for custom branding.
* Seed delivered themes only once, as with import-gate rules.

## Decision Outcome

Chosen option: "Read store-owned PDF theme documents and synchronize delivered defaults",
because portable custom branding and maintained defaults have different ownership.

Each PDF-menu opening reads `kiao-user-config/pdf-themes/*.json` through the file API.
The filename is identity and `label` the menu name. Optional CSS properties, CSS text
and header HTML customize printing; placeholders insert the escaped title and current date.
Public defaults remain generic.

Worker embeds `internal/files/configuration/pdfthemes/` and synchronizes delivered
filenames at every startup, restoring missing or changed files and leaving identical files
untouched. Custom themes use other filenames and are never changed or deleted; copy a
delivered theme before customizing it.

The exporter receives a loaded theme and styles only the print tab. Diagram preparation,
heading grouping and layout stay shared. Invalid or unreadable themes are skipped;
neutral export remains available with missing configuration or an older worker.

## More Information

The [theme README](../../../operation/worker/internal/files/configuration/pdfthemes/README.md)
defines the format.
