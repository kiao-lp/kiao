---
id: "00078"
title: "worker groups code by cohesive responsibilities inside the existing service families"
status: accepted
date: 2026-10-24
tags: ["worker", "go", "packaging", "dependencies"]
components: ["worker"]
paths: ["operation/worker/internal"]
symbols: ["app.Run", "turns.Engine", "playback.TurnExecutor", "turns.RunObserver"]
triggers: ["new worker package", "import cycle", "driver boundary", "code cohesion", "where to put code"]
supersedes: ["00001"]
superseded_by: []
---

# 00078 — worker groups code by cohesive responsibilities

**Decision:** retain one worker module, binary and process. Keep `files`, `hybridflow-runner`
and `toolbox` as service families with small façades. Place process composition in `app` and
split shared `core` code into focused packages. Within each family, group implementation,
models, tests and resources by responsibility.

HTTP adapters depend on services. Agent contracts and turn execution do not import concrete
drivers or WebSocket. Playback calls the `TurnExecutor` port; execution receives a `RunObserver`
for the reverse notifications. Shared snapshot models prevent a package cycle.

Only `app` wires different service families. Dependency tests enforce these boundaries.
The [code map](../build-code-map.md) records ownership; [components](../components.md) records
composition, state ownership and runtime ports.

**Why:** the runner alone grew to 69 production source files in one package. Separate package
ownership makes dependencies explicit and keeps unrelated protocols and lifecycles apart.
This meets 00001's file-count trigger while preserving the installed program's commands,
HTTP and WebSocket contracts, environment variables and persisted formats.

**Cost:** internal symbols crossing package boundaries need explicit APIs; integration tests
construct components from several packages. Embedded resources and staging scripts follow
those resources' owners. Existing migrations and their checksums are unchanged.
