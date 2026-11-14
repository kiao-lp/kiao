---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-24
tags: ["docs", "repo", "conventions", "build", "solution-design", "kiao-style", "kiao-worker", "kiao-mcp"]
triggers: ["architecture terminology", "solution design", "documentation ownership", "implementation review", "container design", "global design location", "reference package path", "standalone repository", "portable links", "file:", "build-reference.sh", "stage-kiao-mcp.sh"]
supersedes: []
superseded_by: []
---

# 00061 — Architecture, solution designs and reference packages have distinct homes.

## Context and Problem Statement

Concepts, implementation guidance and shared packages need distinct owners and entry
points. Base documentation must remain readable as an independent repository.

## Considered Options

* Separate architecture, owner-local solution designs and direct reference-package homes.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Separate architecture, owner-local solution designs and direct reference-package homes",
because guidance belongs with its owner and one authoritative copy avoids competing sources.

Reserve [architecture](/docs/architecture/README.md) for solution-agnostic documentation.
Implementation choices, reviews and guidance are solution designs: global designs live in
[docs/solution-design](/docs/solution-design/README.md); single-container designs live
beside that container's code in `docs/solution-design/`.

Dashboard designs follow the primary owner in `src/core/`, `src/kit/` or `src/plugins/`;
shared conventions and designs with several owners remain at Dashboard level. Link callers
and dependencies rather than duplicating guidance. The central index links local indexes,
which own their pages.

Container decisions stay centralized in that container's `docs/solution-design/decisions/`;
global decisions live here. The [decision index](./README.md) gives all owners one sequence.
Mark replacements superseded and link successors. Before deliberate removal, preserve
applicable rules; cleanup updates IDs, metadata and inbound references together, with Git
retaining earlier reasoning.

Base links are document-relative or repository-root paths, without a monorepo prefix or
outward traversal. Base NPM packages live directly in `reference/`:
[kiao-style](/reference/kiao-style/), [kiao-worker](/reference/kiao-worker/) and
[kiao-mcp](/reference/kiao-mcp/README.md), built in that order. Dependencies, lockfiles,
build/staging scripts, Docker and documentation use those locations.

### Consequences

* Bad, because moves also require updating diagram assets, links, contributor guidance and
  consuming assemblies. Central and local indexes must stay synchronized.
