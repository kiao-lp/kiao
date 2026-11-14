---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-08
tags: ["import-gate", "review", "redaction", "dashboard"]
triggers: ["render markdown review", "mark element", "redaction", "obfuscate", "import as text", ".md import", "rapport.pdf.md", "textPath", "CSS Custom Highlight API", "#text=", "[...]"]
supersedes: []
superseded_by: []
---

# 00032 — Gate scans readable text, renders markdown, redacts staging.

## Context and Problem Statement

Review and safe import need the same set of readable text. Markdown findings must remain
tied to source offsets while React owns the rendered DOM and redaction happens before import.

## Considered Options

* Scan readable source text, render Markdown and redact staged text.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Scan readable source text, render Markdown and redact staged text", because
reading, finding offsets and import decisions then use the same source.

Every readable file passes the gate. Its `textPath` names the converted index, the file
itself for text, or nothing for an unreadable binary.

Markdown renders normally; CSS Custom Highlight API ranges paint findings without changing
React's DOM. Source text drives scans, offsets and redaction. Text matching maps findings
to the rendering: ranges can cross elements, while findings changed by rendering remain
in the navigator without paint.

**Redaction** writes `[...]` over the finding in staged text before any move, retaining
that decision with the review. A text-file redaction changes the imported file; redacting
a converted index leaves the binary intact.

**Import as text** is available only for converted files. It imports the index under the
source name, such as `rapport.pdf.md`, and does not move the original binary.
