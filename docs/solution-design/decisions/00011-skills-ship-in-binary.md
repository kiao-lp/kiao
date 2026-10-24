---
id: "00011"
title: "the DCMS skills ship inside the worker binary"
status: accepted
date: 2026-08-23
tags: ["skills", "worker", "agents"]
components: ["worker", "kiao-skills"]
paths: ["reference/kiao-skills"]
symbols: ["agents/claude_skills.go", ".kiao-skill", "--setting-sources"]
triggers: ["new skill", "edit a skill", "~/.claude/skills", "skill not loading", "digest mismatch", "marker"]
supersedes: []
superseded_by: ["00052"]
---

# 00011 — the DCMS skills ship inside the worker binary

**Decision:** the Claude Code skills that teach a turn the DCMS document formats moved out of
`.claude/skills/` into `reference/kiao-skills/`, a Go module that embeds itself with
`//go:embed all:*`. The worker depends on it and installs them into `$HOME/.claude/skills` at
startup (`agents/claude_skills.go`), keyed on a `.kiao-skill` marker holding a digest of what it wrote.
`.claude/skills/` keeps only what is about developing this repository — `verify` and `hexarch`. **Amended 2026-10-05:** the repo skills moved to `.agents/skills/`, and `.claude/skills/` now holds only discovery entries — every dev skill but `verify`, which AGENTS.md points at by path.

**Why:** a skill in `.claude/skills` reached exactly one person, working inside one checkout. The
service spawns the CLI with `--setting-sources user`, so the project scope is not read at all — the
skills were doing nothing for anyone editing a store, which is every use of KIAO that is not this
repository. The user scope is the one place both processes agree on, `$HOME` being shared by the
service and the CLI it spawns.

Embedded rather than staged beside the binary because kiao starts four ways — the VPS unit,
`bin/local-start-kiao.sh`, the `kiao` executable and the Docker image — and a staged directory
would need a copy step and a path in each, which is four chances to ship a stale skill or none.
`migrations` is staged that way and has to be: it is Node scripts run by `node`. Skills are static
text nothing but the CLI reads, so they can travel in the binary, and then the set installed is
always the set the build was made with.

The marker is what makes writing into someone's home acceptable. `graph` and `strategy` are names
anybody might have used; a directory without a marker was not written here, so it is reported and
left alone, and deleting the marker is how an installed skill is adopted. Only a marked directory is
ever rewritten or removed.

**The cost of the move** is that the skills are no longer where anyone looks for them. A session
asked to change one goes to `~/.claude/skills/` — the generated copy — and an edit there achieves
nothing, silently. Three things answer that, at the three places the mistake is made: `CLAUDE.md`
and a `README.md` left in `.claude/skills/` (since moved to `.agents/skills/` with the skills) for a session working in this checkout, and, for a turn
running over some unrelated store with no access to this repository at all, a comment appended to
the installed `SKILL.md` naming its source. The marker records a second digest for the same reason —
the tree as written, not just the version it came from — so that an edit made in place is undone at
the next start and reported with the source path, rather than surviving until the skill's text
happens to change and being discarded then, months later, with nothing said.

## Refactor notes

Install target moved to the edited store (00052), which removes these home installs on first start. Embedding in the binary still holds.
