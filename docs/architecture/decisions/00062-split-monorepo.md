---
id: "00062"
title: "this tree is the base half of a split monorepo"
status: accepted
date: 2026-10-03
tags: ["repo", "monorepo", "split"]
components: ["repo"]
paths: ["pub", "perso"]
symbols: ["VITE_OIDC_AUTHORITY", "example.com", "/pub/"]
triggers: ["personal code in pub", "outward reference", "hostname", "standalone repo", "subtree split", "old monorepo path"]
supersedes: []
superseded_by: []
---

# 00062 — this tree is the base half of a split monorepo

**Decision:** this tree (`pub/`) holds the base KIAO — DCMS (the file/content feature of
Dashboard + the files service in worker), hybridflow (the workflow/agent UI + the
hybridflow-runner in worker + hybridflow-store), the reference libraries and skills they build
on, the file-store migrations, the e2e suite and the tooling that builds the Docker image and
the installed executable — with everything needed to develop and ship it, and nothing personal
or server-specific. It lives
inside a monorepo whose other half (`perso/`) holds personal products building on it, and it is
meant to stand alone as its own repository one day.

Three rules hold until then:

1. **This tree never points outside itself.** No path, no hostname, no personal name, no
   default that only makes sense on one person's machine. A secured Dashboard names its realm
   at build time (`VITE_OIDC_AUTHORITY`); a prod worker requires its issuer and JWKS URIs;
   example hosts are `example.com`.
2. **Absolute store links carry the `/pub/` prefix** while this tree lives in the monorepo,
   per rule 4 of the 2026-09-14 entry. Standing alone is a subtree split plus `s|/pub/|/|`
   over links.
3. **Entries above this one predate the split.** They were written in the monorepo; where
   they name paths or deployments outside this tree, that is history, not a reference to
   follow.

**Why:** a tree that cannot be built, run or read without one person's server and files is
not one that can be handed to the community. The split also says where the base is
developed: in the open, with the personal products building against it.

**The cost accepted:** one decision log stays historical. `decisions-kiao.md` predates the
split and its entries name the old monorepo paths, the author's own deployment and personal
plugin projects; it is append-only, so those entries stand as written and this entry is the
lens to read them through.

## Refactor notes

Refactor note (2026-10-12): the two monolith logs were split verbatim into this index plus one file per decision; entries 'stand as written' in the detail bodies, and git history keeps the originals. New decisions follow the README convention, not append-at-bottom.
