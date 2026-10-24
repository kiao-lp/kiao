/**
 * Edge path calculation utilities shared between diagram packages.
 *
 * Given edges and node positions/sizes, computes SVG path data
 * for rendering — handles single, multiple, and self-loop edges.
 */

import { getRectIntersection } from './geometry';

export interface EdgeEndpoint {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface EdgePathResult {
    /** SVG path `d` attribute. */
    d: string;
    /** Position for the edge label. */
    labelX: number;
    labelY: number;
}

/**
 * Compute the SVG path for a single edge between two rectangles.
 * Handles straight, curved (multiple edges), and self-loop cases.
 *
 * @param from          Bounding rect of the source node.
 * @param to            Bounding rect of the target node.
 * @param indexInGroup  Zero-based index within edges sharing the same node pair.
 * @param groupSize     Total number of edges sharing this node pair.
 * @param isSelfLoop    Whether from and to are the same node.
 * @param fromKey       Key of the from node (for stable curve direction).
 * @param toKey         Key of the to node.
 */
export function computeEdgePath(
    from: EdgeEndpoint,
    to: EdgeEndpoint,
    indexInGroup: number,
    groupSize: number,
    isSelfLoop: boolean,
    fromKey: string,
    toKey: string,
): EdgePathResult {
    const c1X = from.x + from.width / 2;
    const c1Y = from.y + from.height / 2;
    const c2X = to.x + to.width / 2;
    const c2Y = to.y + to.height / 2;

    if (isSelfLoop) {
        const loopBaseSize = 40 + indexInGroup * 20;
        const exitX = c1X + 10;
        const exitY = from.y;
        const entryX = from.x + from.width;
        const entryY = c1Y + 10;
        const cx1 = exitX;
        const cy1 = exitY - loopBaseSize;
        const cx2 = entryX + loopBaseSize;
        const cy2 = entryY;
        const labelX = 0.125 * exitX + 0.375 * cx1 + 0.375 * cx2 + 0.125 * entryX;
        const labelY = 0.125 * exitY + 0.375 * cy1 + 0.375 * cy2 + 0.125 * entryY;
        return {
            d: `M ${exitX} ${exitY} C ${cx1} ${cy1} ${cx2} ${cy2} ${entryX} ${entryY}`,
            labelX: labelX + 6,
            labelY: labelY - 6,
        };
    }

    const [origX1, origY1] = getRectIntersection(
        [c2X, c2Y], [c1X, c1Y],
        [from.x, from.y, from.width, from.height],
    );
    const [origX2, origY2] = getRectIntersection(
        [c1X, c1Y], [c2X, c2Y],
        [to.x, to.y, to.width, to.height],
    );

    if (groupSize <= 1) {
        return {
            d: `M ${origX1} ${origY1} L ${origX2} ${origY2}`,
            labelX: (origX1 + origX2) / 2,
            labelY: (origY1 + origY2) / 2 - 6,
        };
    }

    // Multiple edges — offset with quadratic Bezier curve
    const offsetFactor = indexInGroup - (groupSize - 1) / 2;
    const offsetAmount = offsetFactor * 40;
    const isForward = fromKey < toKey;
    const actualOffset = isForward ? offsetAmount : -offsetAmount;

    const dx = c2X - c1X;
    const dy = c2Y - c1Y;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / length;
    const py = dx / length;
    const midX = (c1X + c2X) / 2;
    const midY = (c1Y + c2Y) / 2;
    const ctrlX = midX + px * actualOffset * 2;
    const ctrlY = midY + py * actualOffset * 2;

    const [x1, y1] = getRectIntersection(
        [ctrlX, ctrlY], [c1X, c1Y],
        [from.x, from.y, from.width, from.height],
    );
    const [x2, y2] = getRectIntersection(
        [ctrlX, ctrlY], [c2X, c2Y],
        [to.x, to.y, to.width, to.height],
    );

    return {
        d: `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`,
        labelX: 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2,
        labelY: 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2 - 6,
    };
}

/**
 * Group edges by node pair (sorted keys), so multi-edge handling works.
 */
export function groupEdgesByPair<E extends { from: string; to: string }>(
    edges: E[],
): Map<string, E[]> {
    const groups = new Map<string, E[]>();
    for (const edge of edges) {
        const keys = [edge.from, edge.to].sort();
        const pairKey = keys.join('::');
        let group = groups.get(pairKey);
        if (!group) {
            group = [];
            groups.set(pairKey, group);
        }
        group.push(edge);
    }
    return groups;
}
