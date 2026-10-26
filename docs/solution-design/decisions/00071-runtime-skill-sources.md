---
id: "00071"
title: "assemblies supply additional skill sources to the common worker at runtime"
status: accepted
date: 2026-10-18
tags: ["skills", "worker", "assembly"]
components: ["worker", "kiao-skills", "kiao"]
paths: ["reference/kiao-skills", "operation/worker/internal/hybridflow-runner/skills.go"]
symbols: ["KIAO_WORKER_SKILLS_PATH", "skills.json", ".kiao-skill", "Skill.Source"]
triggers: ["additional skills", "skill source", "assembly skill", "source conflict", "skill provenance"]
supersedes: []
superseded_by: []
---

# 00071 — assemblies supply additional skill sources to the common worker at runtime

**Decision:** base skills remain embedded in the common worker, as in 00011. An assembly may
add an absolute `KIAO_WORKER_SKILLS_PATH` directory containing `skills.json` and skill resource
trees. An empty setting uses only embedded skills. The manifest declares each skill's name,
plugin and master provenance; the assembly owns these declarations and their delivery.

The worker loads the complete embedded + additional catalogue before applying the store's plugin
selection, then uses the single installer and pruner from 00052 for both agent directories.
Neither the embedded catalogue nor its tests know the plugins of additional assemblies.

**Conflicts and errors:** duplicate names, including an attempted override of an embedded skill,
are errors. Missing, unreadable or invalid configured sources suspend the whole synchronization
with a warning; the worker continues serving the store. They must never become an empty catalogue
that prunes the last good installation. A valid manifest with an explicit empty array, removal of
an entry, or an explicitly cleared setting does withdraw additional skills. Sources are checked
again at each equipment refresh, including a Dashboard configuration save.

**Ownership and migration:** unmarked copies remain personal. Managed copies retain the two
digests and additionally compare their recorded master provenance. Moving a formerly embedded
skill into an assembly therefore updates the marker and installed footer even at identical content.

**Delivery:** an assembly replaces its whole source directory before the worker restarts. The
executable installer accepts `KIAO_EXTRA_SKILLS` and always stages `skills/skills.json`, empty in
the base assembly. The launcher keeps this expected path configured even when missing, so an
incomplete install is reported rather than interpreted as a deliberate withdrawal.

**Why:** an assembly must be able to ship its own skills with the common binary, without making
the base depend on its code or keeping a second installer whose copies the worker would prune.
This extends the catalogue only; it does not unify plugin, toolbox or resource catalogues.

The [skills README](/reference/kiao-skills/README.md) specifies the manifest and validation rules.
