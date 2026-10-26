---
id: "00063"
title: "the deliverable is called `kiao`: DCMS, hybridflow, kiao"
status: accepted
date: 2026-10-05
tags: ["deliverable", "rename", "install"]
components: ["kiao-image", "kiao-executable"]
paths: ["bin"]
symbols: ["install-kiao-executable.sh", "build-kiao-image.sh", "local-start-kiao.sh", "KIAO_DCMS_*", "KIAO_*", "kiao:latest", "decisions-kiao.md"]
triggers: ["kiao-dcms", "-dcms suffix", "reinstall", "old config", "instance registry", "commit scope", "decisions-dcms.md"]
supersedes: []
superseded_by: ["00064"]
---

# 00063 — the deliverable is called `kiao`: DCMS, hybridflow, kiao

**Decision:** the executable, the image and the scripts that build them drop the `-dcms`
suffix — `kiao-dcms` becomes `kiao`, `install-dcms-executable.sh` becomes
`install-kiao-executable.sh`, `build-dcms-image.sh` becomes `build-kiao-image.sh`,
`local-start-dcms.sh` becomes `local-start-kiao.sh`, the image is `kiao:latest`, and the
directories, archives, config paths and `KIAO_*` variables follow. Three names, three
things: **DCMS** is document management, frontend and backend — Dashboard and the
worker; **hybridflow** is agentic workflow management, frontend and backend — the boards
UI and the hybridflow-store; **kiao** is the one deliverable containing both and more —
the PlantUML renderer, the `kiao-mcp` servers, the skills, the toolbox.

**Why:** the deliverable stopped being DCMS alone the day the boards moved into it, and
every name wearing `-dcms` has said the wrong thing since — an executable that starts a
hybridflow-store, an image carrying PostgreSQL, a document set describing boards under a
DCMS title. The suffix also spent the short name: `kiao` is what is typed ten times a
day, and it named nothing.

**The upgrade is a reinstall.** The installer retires the old directories after moving
what in them is the user's — the toolbox, the standing config — and the new executable
reads the old config and the old instance registry until that move, so `--list` and
`--stop` still see instances it did not start. The old `KIAO_DCMS_*` variables are
honoured as fallbacks. This log moves with the rename: its entries were never DCMS-only —
boards, runs and the image beside Dashboard and worker — so `decisions-dcms.md` becomes
`decisions-kiao.md`. What names a product rather than the deliverable keeps its name:
the DCMS product icon, the `dcms` commit scope for a change spanning Dashboard and worker
— with `kiao` beside it for one spanning DCMS and hybridflow.

## Refactor notes

Product wording amended by 00064 (functional sets). Names and upgrade path unchanged.
