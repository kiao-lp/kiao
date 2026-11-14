---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-12
tags: ["docs", "decisions", "madr", "dashboard", "worker"]
triggers: ["new decision", "decision metadata", "MADR", "decision skill", "parseDecision", "pluginOf"]
supersedes: ["00065"]
superseded_by: []
---

# 00067 — Decision records use MADR and its optional native metadata.

## Context and Problem Statement

Adopting MADR 4.0.0 requires consistent authoring guidance and Dashboard reading.
Keeping the custom `decision` namespace alongside MADR would retain a second format.

## Considered Options

* Use MADR with optional native metadata and retain useful catalogue extensions.
* Keep the custom namespaced decision model and a parser for both formats.

## Decision Outcome

Chosen option: "Use MADR with optional native metadata and retain useful catalogue extensions",
because one format aligns authoring and display without discarding recorded information.

The [kiao-adr skill](/reference/kiao-skills/kiao-adr/SKILL.md) is the format and authoring
reference. It keeps MADR and portable catalogue extensions in separate specifications
so repository-specific conventions do not become requirements of the format.

Decisions reads absent optional fields as empty and ignores unknown extensions and the
former `decision` namespace. Invalid YAML still permits heading/filename display.
Source configuration, filters, sorts, opening and dragging retain their behavior.

The common installer synchronizes `kiao-adr` into `.agents/skills` and `.claude/skills`
independently of the enabled plugins. It replaces the earlier managed `madr` skill.
Repository conversion is manual; no file-store migration or conversion script is delivered.

### Confirmation

Parser tests cover optional metadata, bare records, invalid headers and document-status
separation. Browser tests cover the table, filtering, sorting, opening and dragging.
Worker tests cover replacement of the earlier skill in both agent directories and
availability with and without the Decisions plugin.

## More Information

Supersedes [ADR-00065](00065-decision-statement-owner.md).
The [upstream MADR templates](https://github.com/adr/madr/tree/4.0.0/template) define the
underlying standard.
