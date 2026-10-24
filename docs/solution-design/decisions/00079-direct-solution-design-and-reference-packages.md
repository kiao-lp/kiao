---
id: "00079"
title: "global solution designs and base NPM packages live directly under docs and reference"
status: accepted
date: 2026-10-24
tags: ["docs", "repo", "conventions", "build"]
components: ["docs", "repo", "kiao-style", "kiao-worker", "kiao-mcp"]
paths: ["docs/solution-design", "reference/kiao-style", "reference/kiao-worker", "reference/kiao-mcp"]
symbols: ["file:", "build-reference.sh", "stage-kiao-mcp.sh"]
triggers: ["global design location", "reference package path", "repository layout", "NPM file dependency", "build paths"]
supersedes: ["00077"]
superseded_by: []
---

# 00079 — global solution designs and base NPM packages live directly under docs and reference

**Decision:** place global solution designs in [docs/solution-design](/docs/solution-design/README.md),
beside [docs/architecture](/docs/architecture/README.md). Keep container-specific designs beside
their code, as defined by [00077](./00077-architecture-and-solution-design.md).

Place the base NPM packages directly in `reference/`: [kiao-style](/reference/kiao-style/),
[kiao-worker](/reference/kiao-worker/) and [kiao-mcp](/reference/kiao-mcp/README.md).
Build them in that order. Local `file:` dependencies, lockfiles, build and staging scripts,
Docker paths and documentation links use these locations.

**Why:** the folder layout reflects the distinction between architecture and solution design
and gives each shared package a direct place in the reference zone.

**The cost accepted:** relocate the directories and diagram assets, recalculate relative links,
and update every consumer in the base distribution and its external assemblies.

## Refactor notes

This replaces only 00077's global directory placement. Its documentation ownership,
shared decision index and standalone-link rules remain in force. Earlier decision bodies
retain their original paths; their navigable links and path metadata use current destinations.
