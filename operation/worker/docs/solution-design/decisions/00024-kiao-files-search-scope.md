---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-03
tags: ["store", "search", "scope", "worker"]
triggers: ["slow search", "node_modules", "target/", "vendor/", "declared folder", "delete scope", "500 entries", "kiaoScopeAt", "/search", "/listRecursive", "skipMachineryDir", "[search]", "[migration]"]
supersedes: []
superseded_by: []
---

# 00024 — Search scope bounds read-only walks; named folder walked.

## Context and Problem Statement

Search and recursive delete previews can become unusable when automatic walks enter network
mounts or large generated trees. `.kiao-files` already declares exclusions for rewriting passes.

## Considered Options

* Add a `[search]` scope while honoring explicitly targeted folders.
* Name the shared traversal scope `[traverse]`.
* Exempt only the targeted directory path without dropping its covering patterns.

## Decision Outcome

Chosen option: "Add a `[search]` scope while honoring explicitly targeted folders", because
the name is discoverable and automatic exclusions must not prevent inspecting a named target.
An unknown section is silently unused, making the expected section name significant.

`[search]` bounds both `/search` walks—index refresh and scan—and `/listRecursive`
delete previews. Patterns before any section also apply, so existing declarations such as
`node_modules` work without edits. `skipMachineryDir` still excludes `.git` and the
state directory even with an empty declaration.

Explicitly targeting an excluded folder, such as `vendor/`, walks it in full.
`kiaoScopeAt` drops patterns covering that target for this walk; exempting only the
directory path would still exclude its children. Other patterns remain active inside it.
This matches the existing `p != rootAbs` behavior.

### Consequences

* Bad, because a declared directory below the target is listed in delete scope without
  descending into it: the directory will be deleted, but its children are not enumerated.
* Bad, because declared files are not searched; seeded dot-file exclusions now work
  alongside dot-directory exclusions.
