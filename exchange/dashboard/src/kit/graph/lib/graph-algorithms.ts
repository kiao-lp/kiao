/** Algorithms named in `graph.algorithms`. Each returns a new GraphFile. */

import { GraphFile, GraphNode } from './graph-model';

// Registry.

type AlgorithmFn = (graph: GraphFile) => GraphFile;

const ALGORITHM_REGISTRY: Record<string, AlgorithmFn> = {
    strategy: runStrategyAlgorithm,
};

// Public API.

/** In `graph.algorithms` order. */
export function runAlgorithms(graph: GraphFile): GraphFile {
    if (!graph.algorithms || graph.algorithms.length === 0) return graph;
    let result = graph;
    for (const name of graph.algorithms) {
        const fn = ALGORITHM_REGISTRY[name];
        if (fn) result = fn(result);
    }
    return result;
}

export const AVAILABLE_ALGORITHMS = Object.keys(ALGORITHM_REGISTRY);

// Strategy.

/** Propagates `benefit` backward by edge `contribution`. Levers get `profitability = computedBenefit − cost`; a node with both includes its own benefit. */
function runStrategyAlgorithm(graph: GraphFile): GraphFile {
    const { nodes, edges } = graph;

    const incomingEdges: Record<string, typeof edges> = {};
    for (const node of nodes) incomingEdges[node.id] = [];
    for (const edge of edges) {
        if (incomingEdges[edge.to]) incomingEdges[edge.to].push(edge);
    }

    const outDegree: Record<string, number> = {};
    for (const node of nodes) outDegree[node.id] = 0;
    for (const edge of edges) {
        if (outDegree[edge.from] !== undefined) outDegree[edge.from]++;
    }

    // Reverse topological order, sinks first.
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

    const nodeById: Record<string, GraphNode> = {};
    for (const node of nodes) nodeById[node.id] = node;

    // Intermediate nodes are factors: no benefit, cost or profitability.
    const isIntermediate: Record<string, boolean> = {};
    for (const node of nodes) {
        isIntermediate[node.id] = incomingEdges[node.id].length > 0 && outDegree[node.id] > 0;
    }

    const accumulated: Record<string, number> = {};
    for (const node of nodes) accumulated[node.id] = 0;

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

    const newNodes = nodes.map(node => {
        const { computedBenefit: _cb, profitability: _p, ...restValues } = node.values ?? {};
        let values: Record<string, number> = { ...restValues };

        if (isIntermediate[node.id]) {
            const { benefit: _b, cost: _c, ...withoutScope } = values;
            values = withoutScope;
        }

        const hasBenefit = (values.benefit ?? 0) > 0;
        const hasCost = (values.cost ?? 0) > 0;
        const acc = accumulated[node.id];

        if (acc > 0 || (hasBenefit && hasCost)) {
            const cb = hasBenefit && hasCost
                ? round2((values.benefit ?? 0) + acc)
                : round2(acc);
            if (cb > 0) values = { ...values, computedBenefit: cb };
        }

        if (hasCost && values.computedBenefit !== undefined) {
            values = {
                ...values,
                profitability: round2(values.computedBenefit - (values.cost ?? 0)),
            };
        }

        const finalValues = Object.keys(values).length > 0 ? values : undefined;
        const { values: _, ...rest } = node;
        return finalValues ? { ...rest, values: finalValues } : rest as GraphNode;
    });

    const leverProfitabilities: number[] = [];
    for (const node of newNodes) {
        if (!isIntermediate[node.id] && (node.values?.cost ?? 0) > 0) {
            leverProfitabilities.push(node.values?.profitability ?? 0);
        }
    }
    const minProf = leverProfitabilities.length > 0 ? Math.min(...leverProfitabilities) : 0;
    const maxProf = leverProfitabilities.length > 0 ? Math.max(...leverProfitabilities) : 0;

    const coloredNodes = newNodes.map(node => {
        const { color: _prevColor, ...rest } = node;

        if (isIntermediate[node.id]) {
            return rest as typeof node;
        }

        const hasBenefit = (node.values?.benefit ?? 0) > 0;
        const hasCost = (node.values?.cost ?? 0) > 0;

        if (hasCost) {
            const prof = node.values?.profitability ?? 0;
            return { ...rest, color: leverRedColor(prof, minProf, maxProf) };
        }

        if (hasBenefit) {
            return { ...rest, color: 'rgba(34,197,94,0.35)' };
        }

        return rest as typeof node;
    });

    return { ...graph, nodes: coloredNodes };
}

/** Min profitability maps to alpha 0.12, max to 0.75. */
function leverRedColor(profitability: number, minProf: number, maxProf: number): string {
    const t = maxProf > minProf ? (profitability - minProf) / (maxProf - minProf) : 1;
    const alpha = (0.12 + t * 0.63).toFixed(2);
    return `rgba(220,30,30,${alpha})`;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
