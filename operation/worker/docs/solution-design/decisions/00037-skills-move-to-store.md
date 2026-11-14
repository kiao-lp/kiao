---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-14
tags: ["skills", "store", "agents", "worker"]
triggers: ["skill not loading", "agent home skills", "staged Muse skills", "marker", "untrusted workspace", "strace", "new skill", "edit a skill", "~/.claude/skills", "digest mismatch", "reference/kiao-skills", ".kiao-skill", "KIAO_WORKER_HARNESS_*_SKILLS_PATH", "--add-dir"]
supersedes: []
superseded_by: []
---

# 00037 — Worker installs bundled skills into edited store.

## Context and Problem Statement

Agent-home skills are hard to inspect and their installation depends on which CLI is present.
Supported CLIs also discover project skills in different directories.

## Considered Options

* Install bundled skills into both store-local agent skill directories.
* Install each CLI's skills in its agent home.

## Decision Outcome

Chosen option: "Install bundled skills into both store-local agent skill directories",
because store files are visible to the owner and discoverable independently of CLI installation.

Worker installs `reference/kiao-skills` into `<store>/.agents/skills` for Codex and Muse,
and `<store>/.claude/skills` for Claude. Claude reads only `.claude/skills`, through each turn's
`--add-dir`, including with `--setting-sources user`; Muse prefers `.agents/skills`
when both directories name a skill.

The base catalogue is embedded, giving every build target the same skills without staging.
Format skills are edited only in catalogue masters; development skills remain in
`.agents/skills/`. Generated `SKILL.md` footers name their master.

Each `.kiao-skill` records source and written-tree digests. Synchronization restores
edited managed copies and reports the master path. Unmarked directories are never
overwritten or removed; deleting the marker adopts a copy.

Muse's intentionally untrusted staged workspace cannot load project skills. Its staged
user configuration therefore links each managed store skill beside personal skills;
only marker-bearing skills travel this way.

### Confirmation

Installed CLI discovery was checked with strace.

## More Information

The first startup after this move removes only marked skills from `~/.claude/skills`,
`~/.codex/skills` and `$XDG_CONFIG_HOME/muse/skills`.
`KIAO_WORKER_HARNESS_*_SKILLS_PATH` is no longer read; remaining settings receive a
startup warning. Additional assembly catalogues use the same ownership and installer through
[runtime sources](/docs/solution-design/decisions/00054-runtime-skill-sources.md).
