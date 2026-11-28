---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-08
tags: ["links", "fixer", "store", "migrations", "worker", "dashboard", "kiao-worker"]
triggers: ["rename rewrote prose", "bare path", "contents[].path", "V007", "relative markdown link", "template::", "unit::", "migration rewrite", "substring replace", "assets/", "stack trace in note", "shell snippet rewritten", "linkfix.go", "link-fix.js", "buildPathPattern", "storeLinkOf", "storePathOf", "V009__absolute-internal-links.js", "docTypeVersion", "absoluteOnly"]
supersedes: []
superseded_by: []
---

# 00028 — DCMS link repair respects token boundaries.

## Context and Problem Statement

Names such as `docs`, `config` and `units` occur in prose, source paths, shell snippets,
stack traces and external URLs. Replacing their substrings during a move can corrupt
unrelated text.

## Considered Options

* Recognize DCMS links at token boundaries.
* Replace path substrings throughout documents.

## Decision Outcome

Chosen option: "Recognize DCMS links at token boundaries", because that
syntax identifies references while relative Markdown retains its own meaning.

`linkfix.go` and [migrations/lib/link-fix.js](/migrations/lib/link-fix.js) rewrite those
tokens, including raw and percent-encoded spellings and child suffixes.

The [DCMS concept catalog](../../architecture/data/dcms-concept-catalog.md) distinguishes
DCMS links from file API paths and document-relative Markdown destinations.

### Consequences

* Bad, because bare paths in prose are not automatically repaired.

Migration selection must also inspect document shape and honor `.kiao-files`; recognizing
a link does not authorize a tree-wide rewrite. Applied scripts remain immutable under the
[migration contract](/migrations/README.md).
