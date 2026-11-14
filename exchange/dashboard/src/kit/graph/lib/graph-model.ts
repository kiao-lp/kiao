/** Data model for `.graph.json`. Coordinates sit on each node; there is no separate layout layer. */

// Storage model.

export interface GraphNode {
    id: string;
    title: string;
    values?: Record<string, number>;
    x: number;
    y: number;
    /** Markdown, shown on hover. */
    tooltip?: string;
    /** CSS colour. Set by algorithms or manually. */
    color?: string;
}

export interface GraphEdge {
    from: string;
    to: string;
    values?: Record<string, number>;
}

export interface GraphFile {
    size: { width: number; height: number };
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** Value keys to display colours. */
    legend?: Record<string, string>;
    /** Algorithm names to run, e.g. `["strategy"]`. */
    algorithms?: string[];
}

// Helpers.

export function nodesToPositions(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) {
        positions[node.id] = { x: node.x, y: node.y };
    }
    return positions;
}

/** Apply a tooltip update to a single node (immutable). */
export function applyTooltipUpdate(
    nodes: GraphNode[],
    nodeId: string,
    tooltip: string | undefined,
): GraphNode[] {
    return nodes.map(node => {
        if (node.id !== nodeId) return node;
        const { tooltip: _, ...rest } = node;
        return tooltip ? { ...rest, tooltip } : rest as GraphNode;
    });
}

/** Apply a node patch (title, values, tooltip) to a single node (immutable). */
export function applyNodePatch(
    nodes: GraphNode[],
    nodeId: string,
    patch: { title: string; values?: Record<string, number>; tooltip?: string },
): GraphNode[] {
    return nodes.map(node => {
        if (node.id !== nodeId) return node;
        const updated: GraphNode = { ...node, title: patch.title };
        if (patch.values !== undefined) {
            updated.values = patch.values;
        } else {
            delete updated.values;
        }
        if (patch.tooltip !== undefined) {
            updated.tooltip = patch.tooltip;
        } else {
            delete updated.tooltip;
        }
        return updated;
    });
}

/** Apply position updates back to the nodes array (immutable). */
export function applyPositionUpdates(
    nodes: GraphNode[],
    updates: Record<string, { x: number; y: number }>,
): GraphNode[] {
    return nodes.map(node => {
        const u = updates[node.id];
        if (u) return { ...node, x: u.x, y: u.y };
        return node;
    });
}

function parseNumMap(v: any): Record<string, number> | undefined {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const m: Record<string, number> = {};
    for (const k in v) {
        if (typeof v[k] === 'number') {
            m[k] = v[k];
        } else if (typeof v[k] === 'string') {
            const num = parseFloat(v[k]);
            if (!isNaN(num)) m[k] = num;
        }
    }
    return Object.keys(m).length > 0 ? m : undefined;
}

function parseStrMap(v: any): Record<string, string> | undefined {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const m: Record<string, string> = {};
    for (const k in v) if (typeof v[k] === 'string') m[k] = v[k];
    return Object.keys(m).length > 0 ? m : undefined;
}

function parseStrArray(v: any): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const arr = v.filter((x: any) => typeof x === 'string') as string[];
    return arr.length > 0 ? arr : undefined;
}

export function parseGraphFile(json: string): GraphFile {
    const parsed = JSON.parse(json);
    return {
        size: parsed.size ?? { width: 925, height: 768 },
        nodes: (parsed.nodes ?? []).map((n: any) => ({
            id: n.id,
            title: n.title ?? n.id,
            values: parseNumMap(n.values),
            x: n.x ?? 0,
            y: n.y ?? 0,
            tooltip: typeof n.tooltip === 'string' ? n.tooltip : undefined,
            color: typeof n.color === 'string' ? n.color : undefined,
        })),
        edges: (parsed.edges ?? []).map((e: any) => ({
            from: e.from,
            to: e.to,
            values: parseNumMap(e.values),
        })),
        legend: parseStrMap(parsed.legend),
        algorithms: parseStrArray(parsed.algorithms),
    };
}

export function serializeGraphFile(file: GraphFile): string {
    return JSON.stringify(file, null, 2);
}
