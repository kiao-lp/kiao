---
name: graph
description: This skill should be used when the user asks to "create a graph", "modify a .graph.json file", "add a node to the graph", "add an edge", "create a directed graph", "write graph", "edit graph", or works with .graph.json files, archtools graph format, node-and-edge diagrams, or graph visualizations.
---

# Graph — Directed Node-and-Edge Diagrams

Graph is a JSON format for directed graphs with explicitly positioned nodes, named numeric values (displayed in legend colors), and directed edges. Files use the `.graph.json` extension. The visual editor renders nodes as rounded rectangles on an SVG canvas with arrowhead edges between them.

## File Format

A `.graph.json` file is a JSON object with four top-level fields: `size`, `legend`, `nodes`, and `edges`.

```json
{
  "size": { "width": 925, "height": 768 },
  "legend": { "cost": "#ff0000", "benefit": "#4488ff" },
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `size` | object | Yes | Canvas dimensions |
| `size.width` | number | Yes | Canvas width in pixels |
| `size.height` | number | Yes | Canvas height in pixels |
| `legend` | object | No | Maps value keys to display colors (CSS color strings) |
| `nodes` | array | Yes | Array of node objects |
| `edges` | array | Yes | Array of directed edge objects |
| `algorithms` | array | No | List of algorithm names to run on the graph (mutates node values) |

### Node Object

```json
{
  "id": "api",
  "title": "API Gateway",
  "values": { "cost": 100, "benefit": 125 },
  "x": 350,
  "y": 50,
  "tooltip": "Handles all incoming traffic"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier, used in edge `from`/`to` references |
| `title` | string | Yes | Display name shown on the node box |
| `values` | object | No | Map of named numeric values displayed below the title (e.g. `{ "cost": 100, "benefit": 125 }`) |
| `x` | number | Yes | X position on the SVG canvas (pixels) |
| `y` | number | Yes | Y position on the SVG canvas (pixels) |
| `tooltip` | string | No | Markdown tooltip shown on hover |
| `color` | string | No | Background color for the node box (CSS color string, e.g. `"#4ade80"` or `"rgb(255,128,128)"`). Can be set manually or computed by algorithms (see below). |

### Edge Object

```json
{
  "from": "api",
  "to": "auth",
  "values": { "cost": 10, "benefit": 15 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Source node ID |
| `to` | string | Yes | Target node ID |
| `values` | object | No | Map of named numeric values displayed on the edge |

Edges are **directed** — rendered with an arrowhead pointing from `from` to `to`.

### Legend Object

The optional `legend` maps value keys to CSS color strings. When present, each value in nodes and edges is rendered in its corresponding color.

```json
{
  "legend": { "cost": "#ff0000", "benefit": "#4488ff" }
}
```

Values whose key has no legend entry are displayed in the default muted color.

## Rendering Details

### Node Sizing

- **Default width**: 160px (minimum 100px, grows based on title/value text length)
- **Default height**: 50px (without values), 70px (with values)
- **Border radius**: 8px (rounded rectangles)
- **Title font size**: 15px
- **Value font size**: 12px
- Multiple values are shown as a `·`-separated row below the title, each in its legend color
- Width is estimated from character widths with 40px padding

### Edge Rendering

- Edges are drawn as paths with arrowheads (SVG markers)
- **Multiple edges** between the same pair of nodes are supported — they curve to avoid overlap
- **Self-loops** are supported (edges where `from` equals `to`)
- Edge values are displayed as labels on the path

### Canvas

- Default canvas size: 925 x 768 pixels
- Content padding: 40px around the bounding box of all nodes

## Positioning

All positions are **explicit** — stored directly with each node as `x`/`y` coordinates. There is no automatic layout engine. When creating a graph, you must assign sensible positions to all nodes.

### Positioning Guidelines

- Use a **top-to-bottom** or **left-to-right** flow that matches the graph's logical direction
- Space nodes at least **150-200px apart** vertically and horizontally to avoid overlap
- Group related nodes spatially (e.g., databases at the bottom, entry points at the top)
- Keep positions within the canvas `size` bounds
- Consider edge routing — nodes that are connected should be relatively close

## Complete Example

```json
{
  "size": {
    "width": 925,
    "height": 768
  },
  "legend": {
    "cost": "#ff0000",
    "benefit": "#4488ff"
  },
  "nodes": [
    {
      "id": "api",
      "title": "API Gateway",
      "values": { "cost": 100, "benefit": 125 },
      "x": 350,
      "y": 50,
      "tooltip": "Test"
    },
    {
      "id": "auth",
      "title": "Auth Service",
      "values": { "cost": 40, "benefit": 55 },
      "x": 100,
      "y": 200
    },
    {
      "id": "users",
      "title": "User Service",
      "x": 350,
      "y": 200
    },
    {
      "id": "orders",
      "title": "Order Service",
      "values": { "cost": 60, "benefit": 80 },
      "x": 671,
      "y": 228
    },
    {
      "id": "db-users",
      "title": "Users DB",
      "values": { "cost": 25, "benefit": 30 },
      "x": 200,
      "y": 400
    },
    {
      "id": "db-orders",
      "title": "Orders DB",
      "values": { "cost": 35, "benefit": 45 },
      "x": 661,
      "y": 422
    },
    {
      "id": "cache",
      "title": "Cache",
      "values": { "cost": 80, "benefit": 110 },
      "x": 350,
      "y": 550
    },
    {
      "id": "queue",
      "title": "Message Queue",
      "values": { "cost": 50, "benefit": 65 },
      "x": 461,
      "y": 300
    }
  ],
  "edges": [
    { "from": "api", "to": "auth", "values": { "cost": 10, "benefit": 15 } },
    { "from": "api", "to": "users", "values": { "cost": 30, "benefit": 40 } },
    { "from": "api", "to": "orders", "values": { "cost": 20, "benefit": 25 } },
    { "from": "auth", "to": "db-users", "values": { "cost": 5, "benefit": 8 } },
    { "from": "users", "to": "db-users", "values": { "cost": 15, "benefit": 20 } },
    { "from": "orders", "to": "db-orders", "values": { "cost": 12, "benefit": 18 } },
    { "from": "orders", "to": "queue", "values": { "cost": 8, "benefit": 10 } },
    { "from": "users", "to": "cache", "values": { "cost": 25, "benefit": 35 } },
    { "from": "orders", "to": "cache", "values": { "cost": 18, "benefit": 22 } },
    { "from": "queue", "to": "users", "values": { "cost": 3, "benefit": 5 } }
  ]
}
```

## Algorithms

The optional top-level `algorithms` array lists named algorithms to run on the graph. Each algorithm reads node and edge values and writes computed values back to nodes (immutably — the original fields are preserved; computed fields are added or replaced).

```json
{
  "algorithms": ["strategy"]
}
```

Algorithms run in the order listed. They are executed server-side whenever the graph is rendered.

### Available Algorithms

#### `strategy`

Propagates objective benefits backward through the graph to levers, computing how much benefit each intermediate node and lever can expect to receive given its contribution weights.

**How it works:**

1. Starts from **objectives** — nodes whose `values.benefit > 0`
2. Dispatches each objective's benefit to its precursor nodes (incoming edges), proportionally by each edge's `values.contribution` weight (defaults to 1)
3. Repeats recursively through factor nodes, accumulating benefit at each step
4. Writes computed values back to nodes:
   - `computedBenefit` — the total benefit flowing through a factor or lever (rounded to 2 decimal places)
   - `profitability` — `computedBenefit − cost`, written only on lever nodes (nodes with `values.cost`)

**Computed value keys added to nodes:**

| Key | Written on | Formula |
|-----|-----------|---------|
| `computedBenefit` | Factors and levers (when > 0) | Sum of weighted benefit from downstream nodes |
| `profitability` | Levers only (nodes with `cost`) | `computedBenefit − cost` |

These computed fields are stripped and recomputed on every render — never edit them by hand.

## Editing Guidelines

### Creating a New `.graph.json` File

1. Start with the `size` object — use `925 x 768` as default or choose dimensions appropriate for the number of nodes
2. Define a `legend` if you want colored values — keys are the value names, values are CSS colors
3. Define all nodes with unique `id` values, short `title` strings, and explicit `x`/`y` positions
4. Use `values` only when there are meaningful numeric metrics to display (e.g., `{ "cost": 100, "benefit": 125 }`)
5. Use `tooltip` for markdown descriptions that add context without cluttering the diagram
6. Define directed edges connecting nodes by their IDs
7. Use `values` on edges only when the numbers are meaningful (e.g., `{ "throughput": 50, "latency": 12 }`)

### Modifying an Existing `.graph.json` File

1. **Adding a node**: Add a node object to the `nodes` array with a unique `id` and position that fits the existing layout — check nearby nodes to avoid overlap
2. **Adding an edge**: Add an edge object to the `edges` array referencing existing node IDs
3. **Removing a node**: Remove the node object from `nodes` and remove **all edges** that reference its `id` in `from` or `to`
4. **Removing an edge**: Remove the edge object from the `edges` array
5. **Changing a node title or values**: Update the field directly on the node object
6. **Repositioning a node**: Update its `x` and `y` values — consider whether connected nodes should also be adjusted
7. **Resizing the canvas**: Update `size.width` and/or `size.height` — ensure all node positions remain within bounds

### Common Mistakes to Avoid

- **Duplicate node IDs** — every node must have a unique `id`
- **Edges referencing non-existent node IDs** — both `from` and `to` must match existing node `id` values
- **Orphaned edges after node deletion** — always remove edges that reference a deleted node
- **Overlapping nodes** — ensure sufficient spacing (at least 150px) between nearby nodes
- **Nodes outside canvas bounds** — all `x`/`y` positions should fall within `size.width`/`size.height`
- **Using non-number values** — all entries in `values` must be numbers
- **Legend key mismatch** — keys in `legend` should match the keys used in `values` for coloring to work
- **Missing `x`/`y` positions** — unlike archdia, graph has no auto-layout; every node needs explicit coordinates
