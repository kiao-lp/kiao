/**
 * Graph algorithms that can be activated via the `algorithms` property
 * in a .graph.json file. Each algorithm mutates node values in place
 * (immutably — returns a new GraphFile).
 */

import { GraphFile, GraphNode } from './graph-model';

// ── Algorithm Registry ──────────────────────────────────────────────

type AlgorithmFn = (graph: GraphFile) => GraphFile;

const ALGORITHM_REGISTRY: Record<string, AlgorithmFn> = {
    strategy: runStrategyAlgorithm,
};

// ── Public API ──────────────────────────────────────────────────────

/** Run all algorithms listed in `graph.algorithms` (in order). */
export function runAlgorithms(graph: GraphFile): GraphFile {
    if (!graph.algorithms || graph.algorithms.length === 0) return graph;
    let result = graph;
    for (const name of graph.algorithms) {
        const fn = ALGORITHM_REGISTRY[name];
        if (fn) result = fn(result);
    }
    return result;
}

/** Names of all registered algorithms. */
export const AVAILABLE_ALGORITHMS = Object.keys(ALGORITHM_REGISTRY);

// ── Strategy Algorithm ──────────────────────────────────────────────

/**
 * Propagate objective benefits backward through the graph to levers.
 *
 * 1. Start from objectives (nodes with `benefit` in their values).
 * 2. For each objective, dispatch its benefit to precursors (incoming
 *    edges) proportionally to the edges' `contribution` weight.
 * 3. Repeat recursively: factors dispatch their accumulated
 *    `computedBenefit` to their own precursors.
 * 4. Levers (nodes with `cost`) get `profitability = computedBenefit − cost`.
 *
 * Nodes that are both lever and objective (have both `cost` and `benefit`)
 * include their own benefit in their computedBenefit so that
 * `profitability = benefit − cost` when unconnected.
 */
function runStrategyAlgorithm(graph: GraphFile): GraphFile {
    const { nodes, edges } = graph;

    // -- Build adjacency: incoming edges per node ---------
    const incomingEdges: Record<string, typeof edges> = {};
    for (const node of nodes) incomingEdges[node.id] = [];
    for (const edge of edges) {
        if (incomingEdges[edge.to]) incomingEdges[edge.to].push(edge);
    }

    // -- Compute out-degree (in the original graph) -------
    const outDegree: Record<string, number> = {};
    for (const node of nodes) outDegree[node.id] = 0;
    for (const edge of edges) {
        if (outDegree[edge.from] !== undefined) outDegree[edge.from]++;
    }

    // -- Reverse topological order (sinks first) via Kahn's algorithm --
    const order: string[] = [];
    const queue: string[] = [];
    const remaining = { ...outDegree };

    for (const node of nodes) {
        if (remaining[node.id] === 0) queue.push(node.id);
    }

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        order.push(nodeId);
        for (const edge of incomingEdges[nodeId]) {
            remaining[edge.from]--;
            if (remaining[edge.from] === 0) queue.push(edge.from);
        }
    }

    // -- Node lookup --------------------------------------
    const nodeById: Record<string, GraphNode> = {};
    for (const node of nodes) nodeById[node.id] = node;

    // -- Determine intermediate nodes (both incoming and outgoing edges) --
    // Intermediate nodes are factors: they are neither objectives nor levers,
    // so scope values (benefit, cost, profitability) don't belong to them.
    const isIntermediate: Record<string, boolean> = {};
    for (const node of nodes) {
        isIntermediate[node.id] = incomingEdges[node.id].length > 0 && outDegree[node.id] > 0;
    }

    // -- Accumulator for computed benefit -----------------
    const accumulated: Record<string, number> = {};
    for (const node of nodes) accumulated[node.id] = 0;

    // -- Propagate backward from objectives ---------------
    for (const nodeId of order) {
        const node = nodeById[nodeId];
        if (!node) continue;

        const benefit = isIntermediate[nodeId] ? 0 : (node.values?.benefit ?? 0);
        const valueToDispatch = benefit + accumulated[nodeId];
        if (valueToDispatch === 0) continue;

        const incoming = incomingEdges[nodeId];
        if (incoming.length === 0) continue;

        const totalContribution = incoming.reduce(
            (sum, e) => sum + (e.values?.contribution ?? 1),
            0,
        );
        if (totalContribution === 0) continue;

        for (const edge of incoming) {
            const contribution = edge.values?.contribution ?? 1;
            const share = valueToDispatch * (contribution / totalContribution);
            accumulated[edge.from] += share;
        }
    }

    // -- Write computed values back to nodes ---------------
    const newNodes = nodes.map(node => {
        // Strip previous computed values
        const { computedBenefit: _cb, profitability: _p, ...restValues } = node.values ?? {};
        let values: Record<string, number> = { ...restValues };

        // Strip scope values from intermediate nodes (factors are neither objectives nor levers)
        if (isIntermediate[node.id]) {
            const { benefit: _b, cost: _c, ...withoutScope } = values;
            values = withoutScope;
        }

        const hasBenefit = (values.benefit ?? 0) > 0;
        const hasCost = (values.cost ?? 0) > 0;
        const acc = accumulated[node.id];

        // Objectives that aren't also levers: no computedBenefit (they have benefit)
        // All other nodes with accumulated value: write computedBenefit
        if (acc > 0 || (hasBenefit && hasCost)) {
            const cb = hasBenefit && hasCost
                ? round2((values.benefit ?? 0) + acc)
                : round2(acc);
            if (cb > 0) values = { ...values, computedBenefit: cb };
        }

        // Profitability for levers (nodes with cost)
        if (hasCost && values.computedBenefit !== undefined) {
            values = {
                ...values,
                profitability: round2(values.computedBenefit - (values.cost ?? 0)),
            };
        }

        // Rebuild node (omit empty values)
        const finalValues = Object.keys(values).length > 0 ? values : undefined;
        const { values: _, ...rest } = node;
        return finalValues ? { ...rest, values: finalValues } : rest as GraphNode;
    });

    // -- Compute profitability range across all levers --
    const leverProfitabilities: number[] = [];
    for (const node of newNodes) {
        if (!isIntermediate[node.id] && (node.values?.cost ?? 0) > 0) {
            leverProfitabilities.push(node.values?.profitability ?? 0);
        }
    }
    const minProf = leverProfitabilities.length > 0 ? Math.min(...leverProfitabilities) : 0;
    const maxProf = leverProfitabilities.length > 0 ? Math.max(...leverProfitabilities) : 0;

    // -- Assign colors ----------------------------------------
    const coloredNodes = newNodes.map(node => {
        const { color: _prevColor, ...rest } = node;

        if (isIntermediate[node.id]) {
            return rest as typeof node; // default: no color
        }

        const hasBenefit = (node.values?.benefit ?? 0) > 0;
        const hasCost = (node.values?.cost ?? 0) > 0;

        if (hasCost) {
            // Lever: red intensity scaled from min (no red) to max (full red)
            const prof = node.values?.profitability ?? 0;
            return { ...rest, color: leverRedColor(prof, minProf, maxProf) };
        }

        if (hasBenefit) {
            // Objective: semi-transparent green tint (works on dark and light backgrounds)
            return { ...rest, color: 'rgba(34,197,94,0.35)' };
        }

        return rest as typeof node; // source/sink with no values: default
    });

    return { ...graph, nodes: coloredNodes };
}

/**
 * Map a lever's profitability to a red rgba tint.
 * min profitability → faint red (alpha ~0.12); max profitability → strong red (alpha ~0.75).
 * Using rgba keeps the color visible on both dark and light themed backgrounds.
 */
function leverRedColor(profitability: number, minProf: number, maxProf: number): string {
    const t = maxProf > minProf ? (profitability - minProf) / (maxProf - minProf) : 1;
    const alpha = (0.12 + t * 0.63).toFixed(2);
    return `rgba(220,30,30,${alpha})`;
}

/** Round to two decimal places. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
