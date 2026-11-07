---
id: "00045"
title: "what the gate reads, what it renders, and what a reviewer may cut out"
status: accepted
date: 2026-09-08
tags: ["import-gate", "review", "redaction"]
components: ["dashboard"]
paths: []
symbols: ["textPath", "CSS Custom Highlight API", "#text=", "[...]"]
triggers: ["render markdown review", "mark element", "redaction", "obfuscate", "import as text", ".md import", "rapport.pdf.md"]
supersedes: []
superseded_by: []
---

# 00045 — what the gate reads, what it renders, and what a reviewer may cut out

**Decision:** every readable file passes the gate. A review file carries a `textPath`: its converted index, itself when text, empty for unreadable binaries. Reader and Safe-import gate use that set.

Markdown renders as a document. Findings paint as ranges via the CSS Custom Highlight API, because the rendered DOM belongs to React. Scan, offsets and redaction operate on the Markdown source. Paint maps source to rendering by text. A finding split across elements paints as one range; a finding altered by rendering stays in the navigator unpainted.

**Import as text** applies only to converted files. The index lands in the file's place, named for the source document (`rapport.pdf.md`). The original is not moved.

**Redaction** replaces the current finding with `[...]` in the staged text before import. The decision is kept with review decisions and written to staging before any move. Redacting a text file changes the imported file. Redacting a converted index leaves the binary original unchanged; *Import as text* is the choice when the original must go.
