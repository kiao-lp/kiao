# ArchDia plugin solution design

This document details the internal workings of the `archdia-edit` plugin, optimized for developers and Agentic AIs working on this repository.

Part of the [Dashboard solution design](../README.md). The plugin source lives under
`exchange/dashboard/src/plugins/archdia-edit/`; paths below are relative to that source directory.
See [Extending ArchDia](./archdia-extending.md) for implementation guidance.

## Directory Layout

```text
src/plugins/archdia-edit/
├── index.tsx                         # Entry point (fileConfigFor match)
├── hooks/
│   └── useArchDiaState.ts            # File loading, parsing, and auto-save state logic
├── lib/
│   ├── archdia-model.ts              # Core TypeScript interfaces (storage + render models)
│   ├── archdia-parser.ts             # String manipulation to split/join the .arch.md format
│   ├── diagram-source.ts             # DSL extractors (e.g., PlantUML regex extractor)
│   ├── relation-geometry.ts          # The curve a relation is drawn as, and the centre it passes through
│   └── elk-layout.ts                 # ELK-based Sugiyama layout engine (compound graphs)
├── components/
│   └── ArchDiaSvgRenderer.tsx        # Pure React component for rendering the SVG canvas
└── styles.css                        # Plugin-specific styling (utilizes CMS CSS variables)
```

## Storage and render models

The codebase enforces a clear separation between **what exists** and **where it's placed**:

### Storage Model (persisted in JSON block)

Defined in `archdia-model.ts` as `ArchDiaLayout`. Stores **only positional data**:
- `size` — Canvas dimensions.
- `positions` — `Record<string, ComponentPosition>` mapping element keys (alias or name) to `{ x, y, width?, height? }`.
- `bends` — `Record<string, [dx, dy]>` mapping relation keys (`from->to`, with `#2`, `#3` … telling
  apart several written the same way round between the same pair) to where their centre has been
  moved, as an offset from where the relation would put it itself. Absent when every relation runs
  straight.

This is the content of the second block (after `\n---\n`) in `.arch.md` files. It captures:
1. Results of the last automated layout run.
2. Any manual position adjustments by the user.

It **never** stores diagram structure (components, containers, relations).

### Render Model (computed at runtime)

Defined in `archdia-model.ts` as `DiagramScene`. Holds the full diagram structure:
- `components` — Named elements extracted from PlantUML.
- `containers` — Packages/groups extracted from PlantUML.
- `relations` — Edges between elements extracted from PlantUML.

This is **always re-derived from the PlantUML source** on every load. It is **never persisted**.

The SVG renderer combines both models: the scene tells it *what to draw*, the layout tells it *where to draw it*.

## Data I/O & State Management

Unlike the plugins that open a file as a document (which use `useDocumentFileSync`), `archdia-edit` manages text-based files.

- It uses the generic `useWorkerClient()` hook to fetch the raw `WorkerClient`.
- In `hooks/useArchDiaState.ts`, it calls `client.getFileText(path)`.
- **Auto-layout on creation:** If the fetched text lacks the `\n---\n` layout delimiter, the hook runs the ELK layout engine to compute initial positions, then persists the layout via `client.update(path, serializedText)`.

## The Parsing Pipeline

When a file string is loaded, it flows through two layers:

1. **Scene Extraction (`lib/diagram-source.ts`)**:
   The PlantUML source is passed to a `DiagramSourceExtractor` which produces a `DiagramScene`:
   - Components (named elements with optional aliases and parent containers)
   - Containers (packages, with nesting support)
   - Relations (edges with optional labels)

2. **Layout Parsing (`lib/archdia-parser.ts`)**:
   The `parseArchDiaFile` function slices the document at the `---` delimiter and parses the JSON into an `ArchDiaLayout`.
   - If no layout block exists, it calls the ELK layout engine to auto-generate positions.
   - If the layout exists, it ensures every element in the scene has a position entry (grid-placing only new ones).

## Layout Engine (`lib/elk-layout.ts`)

Uses **elkjs** with the `layered` (Sugiyama) algorithm and `hierarchyHandling: INCLUDE_CHILDREN` for compound graph support.

- Containers → ELK parent nodes with `children`
- Components → ELK leaf nodes (width estimated from label length)
- Relations → ELK edges with `sources`/`targets`
- Returns an `ArchDiaLayout` with computed positions for all elements.

## UI & Rendering

The `ArchDiaSvgRenderer` is a pure component relying on standard React+SVG.

- **Theme Compliance**: Uses dashboard CSS variables via `className`s defined in `styles.css`.
- **Coordinates**: The SVG `viewBox` uses the exact dimensions from the layout.
- **Rendering order**: Containers (back) → Relations (middle) → Components (front).
- **Node Keys**: SVG elements are keyed by the element's `alias` (preferred) or `name`.
- **Relations**: each is one quadratic Bézier through its centre — the control point follows from
  the two ends and the centre, so the curve passes through wherever the centre is put. Unbent, the
  centre lands on the straight line and the curve is that line. Where an end meets its element is
  decided by the curve rather than by the straight line, so the border is met twice: once towards
  the other element, then again towards the curve that gave.
- **Bending**: when `onBendsChange` is passed, every relation carries a handle at its centre. It is
  dragged by the same start-move-commit plumbing that moves elements, and a double-click on it
  straightens the relation. An export passes no callback, so it draws no handles.
- **Reaching for a relation**: a curve drawn 1.2px wide is not a target, so every relation also
  carries `.archdia-relation-hit` — the same path, stroked 14px in nothing. That band is what
  catches the pointer, what the tooltip is reached by, and what lights up to say the relation
  answers to a hand; the handle at the centre comes out with it, and is itself catchable a few
  pixels off its middle through a transparent stroke of its own.
- **Saying what can be touched**: the pointer reaching a component, a container or a relation
  rings it in the accent colour, as the mindmap tints a note it is over. Every one of those rules
  hangs off a class the renderer only writes when it was handed a callback —
  `archdia-draggable`, `archdia-editable`, `archdia-relation-bendable` — so a diagram being read,
  or exported, has nothing lighting up under a pointer that could not have moved it.
