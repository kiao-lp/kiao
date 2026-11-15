---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# ArchDia solution design

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md). The plugin owns file integration;
`@kiao-dashboard-kit/archdia` owns parsing, models, layout and reusable editing/rendering components.
See the [plugin guide](../../../../plugins/archdia-edit/README.md) for the format and
[extension guide](archdia-extending.md) for language changes.

## Directory Layout

| Source | Responsibility |
| --- | --- |
| `src/plugins/archdia-edit/index.tsx`, `MainView.tsx` | Matcher, lazy view, toolbar callbacks and per-file view state |
| `src/plugins/archdia-edit/hooks/useArchDiaState.ts` | Loading, scene extraction and persistence |
| `src/kit/archdia/lib/archdia-model.ts` | Storage and render types |
| `src/kit/archdia/lib/archdia-parser.ts` | Typed blocks, serialization, descriptions and layout reconciliation |
| `src/kit/archdia/lib/diagram-source.ts`, `c4-source.ts` | PlantUML/C4 extraction |
| `src/kit/archdia/lib/diagram-import.ts`, `mermaid-source.ts` | PlantUML and Mermaid import |
| `src/kit/archdia/lib/elk-layout.ts`, `plantuml-layout.ts`, `treemap-layout.ts` | Layout algorithms |
| `src/kit/archdia/lib/relation-geometry.ts`, `container-bounds.ts` | Curves, intersections and derived container geometry |
| `src/kit/archdia/components/` | Editor, source editor, toolbar, SVG renderer and styles |

Paths are relative to Dashboard. Import the kit through
[its public facade](../../index.ts).

## Storage and render models

| Model | Contents | Persistence |
| --- | --- | --- |
| `ArchDiaFile` | Source blocks, optional descriptions and layout | Serialized as typed blocks separated by `\n===\n` |
| `ArchDiaLayout` | Canvas `size`, leaf `positions` and optional relation `bends` | LAYOUT block |
| `DiagramScene` | Components, containers and relations extracted from combined sources | Derived; never serialized |

Positions use aliases, or names when no alias exists, with `{ x, y, width?, height? }`.
Containers derive bounds from children. Bends use `[dx, dy]` offsets from default relation
centers, keyed `from->to`, then `from->to#2`, `#3` for repeated directed pairs. Relabeling
keeps a bend; moving endpoints carries it along.

## Data I/O & State Management

[useArchDiaState](../../../../plugins/archdia-edit/hooks/useArchDiaState.ts) uses `useWorkerClient` directly. It reads text, parses source blocks, extracts a combined scene, then parses layout against that scene. It normalizes and saves on load when no `\n===\n` separator is present. It does not use the shared disk-sync hook; polling and conflict handling differ from other editors.

Source changes reconcile positions before writing. Layout, descriptions and raw-file edits
serialize through `serializeArchDiaFile` and `client.update`. `MainView` bridges host theme
variables and stores `ArchDiaViewState` under the `archdia` scope.

## The Parsing Pipeline

1. Read `---`-delimited block headers separated by `===`; optional body fences are unwrapped.
2. Collect PLANTUML blocks in order and concatenate them for extraction. DESCRIPTIONS bodies
   concatenate; later LAYOUT blocks override earlier positions, bends and supplied size.
3. If no usable layout exists, compute ELK layout. Reconcile positions for new leaves and prune
   stale positions and bends while preserving existing placement.
4. Render the extracted scene with the resulting layout.

Serialization emits source blocks, optional descriptions and one layout, each with a fenced
body. `parseArchDiaSources` reads source metadata without computing layout, for extraction UI.

## Layout Engine (`lib/elk-layout.ts`)

ELK uses the layered algorithm and compound children: containers become parent nodes, leaves
receive estimated sizes, and relations become source/target edges. Incremental placement adds
new leaves without rearranging existing ones. Imported PlantUML can instead use source-order
and directional ranking; treemap is another explicit layout action. Layout actions preserve
relation bends. See [layout behavior](../ProjectDesc.md).

## UI & Rendering

The SVG renderer combines `DiagramScene` with `ArchDiaLayout`. Containers draw behind relations,
then components; element keys use aliases or names. Styles use ArchDia theme variables bridged
by Dashboard. The SVG `viewBox` follows layout dimensions.

Each relation is a quadratic Bézier through its center. Straight relations have a collinear
center; repeated pairs fan apart. Curve direction determines border intersections. A bend
handle drags the center and double-click resets it. A transparent **14 px** hit stroke makes
thin relations targetable and exposes their tooltip and handle.

Interactive classes (`archdia-draggable`, `archdia-editable`, `archdia-relation-bendable`)
are emitted only when matching callbacks exist. Hover accents and handles therefore appear
in editing views and stay absent in read-only rendering and export.
