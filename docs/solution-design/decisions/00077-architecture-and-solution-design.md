---
id: "00077"
title: "architecture is solution-agnostic; solution designs follow system ownership"
status: accepted
date: 2026-10-24
tags: ["docs", "repo", "conventions", "solution-design"]
components: ["docs", "repo"]
paths: ["docs/architecture", "exchange/dashboard/docs/solution-design", "operation/worker/docs/solution-design", "operation/hybridflow-store/docs/solution-design"]
symbols: ["architecture", "solution design", "docs/solution-design"]
triggers: ["where to write architecture", "implementation review", "implementation guidance", "container design", "standalone repository", "documentation links"]
supersedes: ["00049", "00062"]
superseded_by: ["00079"]
---

# 00077 — architecture is solution-agnostic; solution designs follow system ownership

**Global directory superseded by [00079](./00079-direct-solution-design-and-reference-packages.md).**
The ownership and standalone-link rules below still apply; global solution designs now live
directly in `docs/solution-design/`.

**Decision:** reserve **architecture** for solution-agnostic documentation. Use **solution
design** for documentation specific to a solution, supporting implementation reviews or
providing implementation guidance.

Centralize architecture in [docs/architecture](/docs/architecture/README.md). Store global
solution designs involving multiple systems in
[docs/architecture/solution-design](/docs/solution-design/README.md).
Store a system-specific solution design in its corresponding container, under
`.../docs/solution-design`, and reference its local index from the central solution design index.
Keep cross-container contracts and interactions in the global area even when one container
performs most of the work.

Decision records follow the same placement rule. The
[shared index](./README.md) maintains one chronological ID sequence and links to records at
their owning locations. Keep historical decision bodies and IDs; record replacements through
supersession metadata and refactor notes.

All references in this base repository resolve within it when opened independently. Use
document-relative links or repository-root paths, with no enclosing monorepo prefix and no
traversal outside the base repository.

**Why:** readers need to distinguish implementation-independent responsibilities from concrete
implementation choices. Container ownership keeps detailed guidance near the code, while the
central index keeps global relationships and local designs discoverable.

**The cost accepted:** move implementation-specific pages and their diagram assets, update
inbound links and contributor guidance, and maintain one index across local decision directories.

## Refactor notes

This replaces 00049's terminology, centralized container shelves and prefix-dependent links.
It replaces only rule 2 of 00062, which required a monorepo prefix in absolute store links;
the self-contained base distribution and its outward-reference restriction remain in force.
