/**
 * Compute container bounds from children positions at render time.
 *
 * Processes containers bottom-up so nested containers are sized
 * before their parents. Returns a bounding rect for each container.
 */
import {
    ComponentPosition,
    DiagramComponent,
    DiagramContainer,
} from './archdia-model';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, estimateNodeWidth, getNodeHeight } from './component-sizing';

/** Margin around children inside a container. */
const MARGIN_TOP = 32;   // extra room for the container label
const MARGIN_SIDE = 16;
const MARGIN_BOTTOM = 16;

/** Margins for trust boundary containers (half the normal size). */
const TRUST_MARGIN_TOP = 8;
const TRUST_MARGIN_SIDE = 8;
const TRUST_MARGIN_BOTTOM = 8;

/**
 * Margins for deployable perimeters — wider than a container's, so the perimeter is drawn
 * outside the functional grouping it cuts across and its label clears the label underneath.
 * A trust boundary can do without the room: it draws no label at all.
 */
const DEPLOYABLE_MARGIN_TOP = 56;
const DEPLOYABLE_MARGIN_SIDE = 30;
const DEPLOYABLE_MARGIN_BOTTOM = 30;

// === Public API ===

export interface ContainerRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Compute the bounding rect of every container from the positions
 * of their children (components + nested containers).
 *
 * @param containers  All containers in the scene.
 * @param components  All components in the scene.
 * @param positions   Component-only positions (from ArchDiaLayout).
 * @returns           A rect for each container, keyed by container id.
 */
export function computeContainerBounds(
    containers: DiagramContainer[],
    components: DiagramComponent[],
    positions: Record<string, ComponentPosition>,
): Record<string, ContainerRect> {
    const result: Record<string, ContainerRect> = {};

    const componentById = new Map<string, DiagramComponent>();
    for (const comp of components) {
        componentById.set(comp.alias || comp.name, comp);
    }

    // Build a map: containerId → list of direct child ids
    const childrenOf = new Map<string, string[]>();
    for (const c of containers) {
        childrenOf.set(c.id, []);
    }

    for (const comp of components) {
        const compKey = comp.alias || comp.name;
        for (const pid of (comp.parentIds ?? [])) {
            if (childrenOf.has(pid)) {
                childrenOf.get(pid)!.push(compKey);
            }
        }
    }
    for (const cont of containers) {
        if (cont.parentId && childrenOf.has(cont.parentId)) {
            childrenOf.get(cont.parentId)!.push(cont.id);
        }
    }

    // Topological order: process leaf containers first.
    // A container is "ready" when all its child containers are already computed.
    const processed = new Set<string>();
    const queue = [...containers];
    let safety = queue.length * queue.length + 1;

    while (queue.length > 0 && safety-- > 0) {
        const cont = queue.shift()!;

        // Check if all child containers are already resolved
        const children = childrenOf.get(cont.id) ?? [];
        const childContainerIds = containers
            .filter(c => c.parentId === cont.id)
            .map(c => c.id);

        if (childContainerIds.some(id => !processed.has(id))) {
            // Not ready yet — push back
            queue.push(cont);
            continue;
        }

        // Gather bounding box of all direct children
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const childId of children) {
            // Child could be a component (in positions) or a container (in result)
            const pos = positions[childId] ?? result[childId];
            if (!pos) continue;

            let w: number;
            let h: number;

            if (result[childId]) {
                w = result[childId].width;
                h = result[childId].height;
            } else {
                const comp = componentById.get(childId);
                w = comp ? estimateNodeWidth(comp.name, comp.members, comp.stereotype) : DEFAULT_NODE_WIDTH;
                h = comp ? getNodeHeight(comp.type, comp.members, comp.name) : DEFAULT_NODE_HEIGHT;
            }

            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + w);
            maxY = Math.max(maxY, pos.y + h);
        }

        const stereotype = cont.stereotype?.toLowerCase();
        const [marginTop, marginSide, marginBottom] =
            stereotype === 'trust' ? [TRUST_MARGIN_TOP, TRUST_MARGIN_SIDE, TRUST_MARGIN_BOTTOM]
                : stereotype === 'deployable' ? [DEPLOYABLE_MARGIN_TOP, DEPLOYABLE_MARGIN_SIDE, DEPLOYABLE_MARGIN_BOTTOM]
                    : [MARGIN_TOP, MARGIN_SIDE, MARGIN_BOTTOM];
        if (minX === Infinity) {
            // No positioned children — give a minimal rect
            result[cont.id] = { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
        } else {
            result[cont.id] = {
                x: minX - marginSide,
                y: minY - marginTop,
                width: (maxX - minX) + marginSide * 2,
                height: (maxY - minY) + marginTop + marginBottom,
            };
        }

        processed.add(cont.id);
    }

    return result;
}
