---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-24
tags: ["worker", "go", "packaging", "dependencies"]
triggers: ["new worker package", "import cycle", "driver boundary", "code cohesion", "where to put code", "new package", "internal/", "second binary", "app.Run", "turns.Engine", "playback.TurnExecutor", "turns.RunObserver"]
supersedes: []
superseded_by: []
---

# 00060 — Worker groups code into cohesive packages within families.

## Context and Problem Statement

The runner grew to 69 production files in one package. The flat layout obscured ownership
and dependencies between protocols, drivers and lifecycles.

## Considered Options

* Group code into cohesive packages within one worker module, binary and process.
* Keep the flat package layout.

## Decision Outcome

Chosen option: "Group code into cohesive packages within one worker module, binary and process",
because explicit package APIs separate responsibilities while preserving external contracts.

Keep `files`, `hybridflow-runner` and `toolbox` as service families with small façades.
`app` composes the process and alone wires families. Split shared `core` into focused
packages; within families, group implementation, models, tests and resources by responsibility.

HTTP adapters depend on services. Agent contracts and execution do not import concrete
drivers or WebSocket. Playback uses `TurnExecutor`; execution calls `RunObserver` for
reverse notifications. Shared snapshot models avoid a package cycle.

Commands, HTTP/WebSocket contracts, environment and persisted formats remain stable;
migration checksums are preserved.

### Consequences

* Bad, because crossing internal boundaries requires explicit APIs and integration tests
  assemble several packages. Embedded resources and staging follow resource ownership.

### Confirmation

Dependency tests enforce the boundaries.

## More Information

The [code map](../build-code-map.md) records ownership;
[components](../components.md) describes composition, state and runtime ports.
