# Architecture

## Baseline overview

### 1. [Services and functions](./views/Functions.md)

Answers two questions, one diagram each: which container provides which external service, and
which container performs which internal function.

### 2. [Container flows](./views/Flows.md)

### 3. [Deployment](./views/Deployment.md)

## [Containers](./containers/README.md)

One folder per C4 container — an independently deployable unit — holding the documents that concern
that container alone. What spans two of them stays in the sections below.

### [worker — what a conversation folder holds](./containers/worker/conversation-folder.md)

The two files under `.kiao-config/conversations/<id>/`, field by field — then what a turn does
that leaves no trace in them, split into what the conversation should hold and what wants a trace
of its own.

### [worker — tour muse bloqué](./containers/worker/muse-quiet-turn.md)

Ce qui se passe quand `muse` ne dit plus rien : l'avis à 2 min puis toutes les minutes avec le compteur de relances, la relance à 8 min, et le fork avec reprise au deuxième blocage — le run continuant dès que la tâche est terminée.

### [worker — components](./containers/worker/components.md)

The five libraries and the program, in seven small views: static structure, HTTP
surface, runtime reads, callbacks, network outside, machine outside, and where
state lives.

### [hybridflow-store](./containers/hybridflow-store/README.md)

The boards and the cards on them, in PostgreSQL — the index, with the hexagonal layout. Then
one document per subject:

- [the schema](./containers/hybridflow-store/schema.md) — why the boards left the store for
  PostgreSQL, the tables as a class diagram, and the migration history;
- [the board UI](./containers/hybridflow-store/board-ui.md) — the board's URL, the gestures, and
  what the browser mints, merges and keeps;
- [interactions](./containers/hybridflow-store/interactions.md) — how Dashboard, worker and
  this service meet around one card, and on what credential;
- [configuration and deployment](./containers/hybridflow-store/deployment.md) — the environment
  variables, and where the service runs in each environment.

### [dashboard — plugins at runtime](./containers/dashboard/plugins-runtime.md)

What a plugin is, the manifest contract, which plugin opens a file, the derived
registries, loading, runtime enablement, and the skill half.

### [dashboard — plugin selection, build and delivery](./containers/dashboard/plugins-assembly.md)

How the plugin set is chosen, compiled and shipped: the catalogue, the shared
surface, the plugin and shell builds, the checks, the dev server, and the
dropped projects.

### [dashboard — plugin rules and precedents](./containers/dashboard/plugins-rules.md)

Where to place new behaviour, and what each rule cost to learn: the decision
checklist and the incidents behind it.

## Cross-container mechanisms

### [File actions](./file-actions.md)

The extension point for operating on a file from the server: the run from
right-click to refresh, the three contracts (manifest, applicability,
provider), why that shape, what exists, and when it is not an action.

## Decision records

### [Index](./decisions/README.md)

One small index plus one detail file per decision, in one chronological numbering —
repo-wide conventions (where an architecture document is written, the tooltip rule,
the monorepo split) and structural kiao decisions (DCMS, hybridflow, the image and
executable they ship as). Read the index fully; open a detail file when its triggers
match the task.

## Target architectures

### [What a Kiao build delivers](./kiao-delivered-resources.md)

One catalogue for the four kinds of resource a kiao build hands over — plugins, MCP servers,
skills and runtimes — and the dependency graph that today stops at the MCP corner.

## Zones

- **Exchange**: interface with external systems
- **Operation**: manage shared business logic
- **Reference**: standardize and centralize
