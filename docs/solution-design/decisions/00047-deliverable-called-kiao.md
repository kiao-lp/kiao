---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-05
tags: ["deliverable", "rename", "install", "kiao-image", "kiao-executable"]
triggers: ["kiao-dcms", "-dcms suffix", "reinstall", "old config", "instance registry", "commit scope", "decisions-dcms.md", "install-kiao-executable.sh", "build-kiao-image.sh", "local-start-kiao.sh", "KIAO_DCMS_*", "KIAO_*", "kiao:latest", "decisions-kiao.md"]
supersedes: []
superseded_by: []
---

# 00047 — Deliverable called kiao: DCMS plus hybridflow extras.

## Context and Problem Statement

The executable and image contain hybridflow and shared tools as well as DCMS.
The `-dcms` suffix names only part of the deliverable and leaves the short name unused.

## Considered Options

* Name the executable, image and related build tooling `kiao`.
* Keep the `kiao-dcms` deliverable name and `-dcms` suffixes.

## Decision Outcome

Chosen option: "Name the executable, image and related build tooling `kiao`", because the
name covers the whole deliverable and supplies its short command name.

`kiao-dcms` becomes `kiao`, the image becomes `kiao:latest`, and scripts become
`install-kiao-executable.sh`, `build-kiao-image.sh` and `local-start-kiao.sh`
from their `install-dcms-executable.sh`, `build-dcms-image.sh` and
`local-start-dcms.sh` names. Directories, archives, config paths and `KIAO_*` settings
follow. The deliverable includes both [functional sets](00048-functional-sets.md),
PlantUML, `kiao-mcp`, skills and toolbox.

Upgrade is a reinstall. The installer moves user-owned toolbox and standing configuration
before retiring old directories. Until that move, the executable reads the old configuration
and instance registry so `--list` and `--stop` find earlier instances; `KIAO_DCMS_*`
remains a fallback.

The mixed-product log was renamed `decisions-dcms.md` to `decisions-kiao.md`.
DCMS's product icon and `dcms` commit scope keep their names; `kiao` scopes changes
spanning DCMS and hybridflow.
