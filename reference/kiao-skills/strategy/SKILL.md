---
name: strategy
description: This skill should be used when the user asks to "create a strategy model", "model a strategy", "add an objective", "add a lever", "add a factor", "create a strategy graph", "write strategy", "edit strategy", or works with strategy modeling, lever-objective diagrams, cost-benefit contribution graphs, or strategic planning visualizations.
---

# Strategy — Lever-to-Objective Modeling

Strategy is a domain-specific layer on top of the [graph skill](../graph/SKILL.md). It models strategic decisions as a directed graph where **Levers** (actions you can take) flow through **Factors** (intermediate effects) toward **Objectives** (outcomes you want). The output is a standard `.graph.json` file rendered by the graph editor.

## Concepts

### Levers (graph sources)

Levers are actions, investments, or decisions that you control. They are the entry points of the graph — nodes with **no incoming edges**.

- Must have a `values` entry keyed `"cost"` with a **positive number** (what it costs to pull this lever)
- Must **not** have a `"benefit"` value

### Objectives (graph sinks)

Objectives are desired outcomes or goals. They are the exit points of the graph — nodes with **no outgoing edges**.

- Must have a `values` entry keyed `"benefit"` with a **positive number** (the value of achieving this objective)
- Must **not** have a `"cost"` value

### Factors (intermediate nodes)

Factors are intermediate effects, capabilities, or conditions that connect levers to objectives. They have **both incoming and outgoing edges**.

- Must **not** have any `values` — no `"cost"`, no `"benefit"`, no other values
- Use `tooltip` to explain what the factor represents if needed

### Unconnected Nodes (lever/objective)

A node with **no edges at all** is considered both a lever and an objective — it represents a self-contained action with a direct outcome.

- Must have both `"cost"` (positive) and `"benefit"` (positive) in `values`

### Edges (contributions)

Edges represent causal contributions — how one element influences another. All edges flow from levers toward objectives.

- All edges should have a `values` entry keyed `"contribution"`
- Default contribution value is **1** when not specified
- Contribution should be a positive number representing the strength of the causal link

## Graph Configuration

### Algorithms

Always include `"algorithms": ["strategy"]` at the top level. This runs the strategy back-propagation algorithm, which computes and writes the following derived values onto nodes:

| Computed key | Written on | Meaning |
|--------------|-----------|---------|
| `computedBenefit` | Factors and levers | Total benefit flowing through this node from downstream objectives, proportional to contribution weights |
| `profitability` | Levers only | `computedBenefit − cost` — positive means the lever is expected to pay off |

These fields are recomputed on every render — never write them by hand.

```json
{
  "algorithms": ["strategy"]
}
```

### Legend

Always use this legend:

```json
{
  "legend": {
    "cost": "#e05555",
    "benefit": "#44aa66",
    "contribution": "#888888"
  }
}
```

### Layout

- **Levers** at the **top** of the canvas
- **Objectives** at the **bottom**
- **Factors** in the **middle**
- Flow is **top-to-bottom**: levers -> factors -> objectives

### File Extension

Strategy models use the standard `.graph.json` extension. There is no separate file format — the strategy skill defines rules and vocabulary on top of the graph format.

## Validation Rules

When creating or modifying a strategy graph, enforce these rules:

| Rule | Check |
|------|-------|
| Levers have cost | Every source node (no incoming edges) must have `values.cost > 0` |
| Levers have no benefit | Source nodes must not have a `"benefit"` key in `values` |
| Objectives have benefit | Every sink node (no outgoing edges) must have `values.benefit > 0` |
| Objectives have no cost | Sink nodes must not have a `"cost"` key in `values` |
| Factors have no values | Intermediate nodes (both incoming and outgoing edges) must have no `values` (omit the field or use `{}`) |
| Unconnected have both | Nodes with no edges must have both `values.cost > 0` and `values.benefit > 0` |
| Edges have contribution | All edges should have `values.contribution` (default to 1 if omitted) |
| All values positive | `cost`, `benefit`, and `contribution` must all be positive numbers |
| No extra value keys | Nodes should only use `"cost"` and/or `"benefit"` as value keys; edges should only use `"contribution"` |

## Complete Example

A company deciding how to improve customer satisfaction:

```json
{
  "size": { "width": 925, "height": 700 },
  "algorithms": ["strategy"],
  "legend": {
    "cost": "#e05555",
    "benefit": "#44aa66",
    "contribution": "#888888"
  },
  "nodes": [
    {
      "id": "hire-support",
      "title": "Hire Support Staff",
      "values": { "cost": 200 },
      "x": 100, "y": 50,
      "tooltip": "Recruit and train 5 new support agents"
    },
    {
      "id": "build-selfserve",
      "title": "Build Self-Service Portal",
      "values": { "cost": 150 },
      "x": 400, "y": 50,
      "tooltip": "Knowledge base + ticket tracking for customers"
    },
    {
      "id": "improve-monitoring",
      "title": "Improve Monitoring",
      "values": { "cost": 80 },
      "x": 700, "y": 50,
      "tooltip": "Better alerting and dashboards for production issues"
    },
    {
      "id": "faster-response",
      "title": "Faster Response Time",
      "x": 200, "y": 250,
      "tooltip": "Reduce average first-response time to under 1 hour"
    },
    {
      "id": "fewer-incidents",
      "title": "Fewer Incidents",
      "x": 600, "y": 250,
      "tooltip": "Reduce production incidents by catching issues earlier"
    },
    {
      "id": "customer-satisfaction",
      "title": "Customer Satisfaction",
      "values": { "benefit": 500 },
      "x": 250, "y": 500,
      "tooltip": "Increase NPS from 30 to 50"
    },
    {
      "id": "reduce-churn",
      "title": "Reduce Churn",
      "values": { "benefit": 300 },
      "x": 600, "y": 500,
      "tooltip": "Reduce monthly churn rate from 5% to 3%"
    }
  ],
  "edges": [
    { "from": "hire-support", "to": "faster-response", "values": { "contribution": 3 } },
    { "from": "build-selfserve", "to": "faster-response", "values": { "contribution": 2 } },
    { "from": "build-selfserve", "to": "fewer-incidents", "values": { "contribution": 1 } },
    { "from": "improve-monitoring", "to": "fewer-incidents", "values": { "contribution": 3 } },
    { "from": "faster-response", "to": "customer-satisfaction", "values": { "contribution": 4 } },
    { "from": "faster-response", "to": "reduce-churn", "values": { "contribution": 2 } },
    { "from": "fewer-incidents", "to": "customer-satisfaction", "values": { "contribution": 2 } },
    { "from": "fewer-incidents", "to": "reduce-churn", "values": { "contribution": 3 } }
  ]
}
```

In this example:
- **Levers** (top): "Hire Support Staff" (cost: 200), "Build Self-Service Portal" (cost: 150), "Improve Monitoring" (cost: 80)
- **Factors** (middle): "Faster Response Time", "Fewer Incidents" — no values, just causal links
- **Objectives** (bottom): "Customer Satisfaction" (benefit: 500), "Reduce Churn" (benefit: 300)

## Interaction Guidelines

### Vocabulary

When discussing strategy models with the user, use the strategy vocabulary:

| Say | Instead of |
|-----|-----------|
| Lever | Source node |
| Objective | Sink node |
| Factor | Intermediate node |
| Cost | Source value |
| Benefit | Sink value |
| Contribution | Edge value |

### Clarification

When a user describes their strategy, help them by:

1. **Identifying levers vs. objectives** — ask "Is this something you *do* (lever) or something you *want* (objective)?"
2. **Surfacing missing factors** — if a lever connects directly to an objective, ask whether there are intermediate effects worth modeling
3. **Quantifying values** — ask about relative costs and benefits if the user hasn't specified them
4. **Checking completeness** — are there levers with no path to any objective? Objectives no lever can reach?

### Explaining the Model

When asked to explain a strategy graph:

1. Start with the **objectives** — what the strategy aims to achieve and their relative benefit values
2. Describe the **levers** — what actions are available and their costs
3. Trace the **paths** — how each lever contributes to objectives through factors
4. Highlight **high-leverage paths** — where small costs lead to large benefits through strong contributions
5. Flag **gaps** — objectives with weak lever support, or expensive levers with low contribution paths
