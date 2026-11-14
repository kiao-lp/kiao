---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-18
tags: ["skills", "worker", "assembly", "kiao-skills", "kiao"]
triggers: ["additional skills", "skill source", "assembly skill", "source conflict", "skill provenance", "KIAO_WORKER_SKILLS_PATH", "skills.json", ".kiao-skill", "Skill.Source"]
supersedes: []
superseded_by: []
---

# 00054 — Assemblies supply extra skill sources at runtime.

## Context and Problem Statement

Assemblies need their own skills with the common worker. Putting them in the base creates
outward dependencies; a second installer competes with worker's managed-copy pruning.

## Considered Options

* Extend the embedded catalogue with an assembly-supplied runtime skill source.
* Make the base catalogue depend on assembly skills and plugins.
* Maintain an independent installer for assembly skills.

## Decision Outcome

Chosen option: "Extend the embedded catalogue with an assembly-supplied runtime skill source",
because one installer can own both catalogues while assemblies own their additions.

Base skills remain embedded as in [ADR-00037](/operation/worker/docs/solution-design/decisions/00037-skills-move-to-store.md).
An absolute `KIAO_WORKER_SKILLS_PATH` supplies `skills.json` and resource trees,
declaring names, plugins and master provenance. An empty setting uses embedded skills alone.
Worker loads both catalogues before plugin filtering and uses one installer and pruner
for both agent directories. Base code and tests need no assembly-plugin knowledge.

Duplicate names, including embedded overrides, are errors. Missing, unreadable or invalid
sources suspend synchronization with a warning while worker serves the last good installation.
A valid empty array, removed entry or explicitly cleared setting withdraws additional skills.
Equipment refresh, including Dashboard configuration saves, rechecks sources.

Unmarked copies remain personal. Managed copies compare master provenance as well as both
digests, so a move from embedded to assembly sources updates markers and footers even when
text is identical.

Assemblies replace the whole source directory before restart. `KIAO_EXTRA_SKILLS` makes
the executable installer stage `skills/skills.json`, empty in the base assembly.
The launcher keeps the expected path configured even if missing so incomplete delivery
cannot masquerade as withdrawal. This extends skills only, leaving plugin, toolbox and
resource catalogues separate.

## More Information

The [skills README](/reference/kiao-skills/README.md) defines the manifest and validation.
