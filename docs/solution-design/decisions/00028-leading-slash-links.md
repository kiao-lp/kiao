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

# 00028 — Stored links use leading slashes; rewrites respect token boundaries.

## Context and Problem Statement

Names such as `docs`, `config` and `units` occur in prose, source paths, shell snippets,
stack traces and external URLs. Replacing their substrings during a move corrupts text
that was never a store reference.

## Considered Options

* Recognize leading-slash store links with token boundaries.
* Replace path substrings throughout documents.

## Decision Outcome

Chosen option: "Recognize leading-slash store links with token boundaries", because that
syntax identifies references while relative Markdown retains its own meaning.

`linkfix.go` and [migrations/lib/link-fix.js](/migrations/lib/link-fix.js) rewrite those
tokens, including raw and percent-encoded spellings and child suffixes.

A link is a document's reference; paths belong to the wire, router and `FileDto.path`.
Use `storeLinkOf` / `storePathOf` in `kiao-worker/utils.ts` for conversion.
Markdown destinations without a leading slash resolve against their containing document.

### Consequences

* Bad, because bare paths in prose are not automatically repaired.

Migration selection must also inspect document shape and honor `.kiao-files`; recognizing
a link does not authorize a tree-wide rewrite. Applied scripts remain immutable under the
[migration contract](/migrations/README.md).
