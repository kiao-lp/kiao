---
id: "00064"
title: "DCMS and hybridflow are functional sets, not container pairs"
status: accepted
date: 2026-10-05
tags: ["dcms", "hybridflow", "concepts"]
components: ["dashboard", "worker", "hybridflow-store"]
paths: []
symbols: ["hybridflow-runner", "files", "toolbox"]
triggers: ["DCMS meaning", "hybridflow meaning", "container vs feature", "commit scope", "runner homeless", "boards UI ownership"]
supersedes: ["00063"]
superseded_by: []
---

# 00064 — DCMS and hybridflow are functional sets, not container pairs

**Decision:** **DCMS** names the file and content management feature — the file-oriented
views of Dashboard plus the `files` service inside worker — and **hybridflow** names the
workflow and agent feature — the boards and conversations UI of Dashboard plus the
`hybridflow-runner` inside worker plus the hybridflow-store. Both are usage names for a
functional set spanning several containers; neither is a container, and neither container
belongs to either whole. Dashboard hosts DCMS views and hybridflow views; worker hosts the
`files` backend, the `hybridflow-runner` engine and the `toolbox` they share; only the
hybridflow-store sits wholly inside one set. The entry above that says "Dashboard and the
worker" and "the boards UI and the hybridflow-store" is read through this one.

**Why:** the concepts moved on. The agent engine grew inside worker — conversations, turns,
the play loop — and it is hybridflow's, not DCMS's; the boards UI and the conversations UI
grew inside Dashboard, and they are hybridflow's too. Saying "dashboard + worker" for DCMS
left the runner homeless and claimed the boards UI for the wrong feature. The functional
reading puts every part where it belongs, and leaves the containers — dashboard, worker,
hybridflow-store — as what they are: processes with lifetimes, not features. The commit
scopes follow: `dcms` spans the DCMS halves, `hybridflow` spans the hybridflow parts,
`kiao` spans both.

## Refactor notes

Amends the product wording of 00063 only ('Dashboard and the worker' becomes the functional reading).
