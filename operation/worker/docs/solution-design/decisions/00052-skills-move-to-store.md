---
id: "00052"
title: "the DCMS skills move from the agent homes into the store"
status: accepted
date: 2026-09-14
tags: ["skills", "store", "agents"]
components: ["worker"]
paths: [".agents/skills", ".claude/skills"]
symbols: ["reference/kiao-skills", ".kiao-skill", "KIAO_WORKER_AGENT_*_SKILLS_PATH", "--add-dir"]
triggers: ["skill not loading", "agent home skills", "staged Muse skills", "marker", "untrusted workspace", "strace"]
supersedes: ["00011"]
superseded_by: []
---

# 00052 — the DCMS skills move from the agent homes into the store

**Decision:** the worker installs the bundled skills (`reference/kiao-skills`) into the store
being edited — `<store>/.agents/skills` for Codex and Muse, `<store>/.claude/skills` for Claude —
instead of into the agent homes (`~/.claude/skills`, `~/.codex/skills`,
`$XDG_CONFIG_HOME/muse/skills`). The first start after the move removes whatever the service wrote
into those homes, marker-gated so nothing else is touched; the `KIAO_WORKER_AGENT_*_SKILLS_PATH`
variables are no longer read, and a deployment that still sets one is told so at startup.

**Why two directories:** no one place is read by all three. Claude reads only `.claude/skills` —
through the `--add-dir` every turn is handed, with or without `--setting-sources user` — Codex and
Muse read `.agents/skills`, and Muse takes `.agents/skills` where both name a skill. Verified
against the installed CLIs with strace rather than taken from documentation, because the whole
change stands on it.

**Why at all:** in the agent homes the skills were invisible and one CLI's install was one CLI's
alone — a home whose CLI was absent got nothing, silently. In the store they are files like any
other: the user opens them, every agent working in the store reads them, and the install no longer
depends on which binaries happen to be on PATH. The `.kiao-skill` marker discipline is unchanged,
now per directory. The one new edge is Muse's staged turns: their workspace is untrusted on purpose,
so project skills would not load — the DCMS skills travel as user skills instead, linked per skill
into the staged configuration beside the user's own, and only a marker-bearing store skill travels.
