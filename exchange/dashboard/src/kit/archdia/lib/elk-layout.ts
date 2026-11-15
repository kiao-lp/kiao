/**
 * ELK-based Sugiyama layout engine for compound graphs.
 *
 * Converts a DiagramScene (render model) into an ArchDiaLayout (storage model)
 * using elkjs's "layered" algorithm with compound graph support.
 *
 * This module is the bridge between "what exists" (scene) and "where it goes"
 * (layout). It is called ONLY when auto-layout is needed (no existing layout
 * block in the file).
 */
import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import {
    ArchDiaLayout,
    ComponentPosition,
    DiagramScene,
} from './archdia-model';
import { estimateNodeWidth, getNodeHeight } from './component-sizing';

// === Constants ===

const CONTAINER_PADDING = 40;

// === Public API ===

export interface ElkLayoutOptions {
    width?: number;
    height?: number;
}

/**
 * Compute a Sugiyama (layered) layout for the given diagram scene.
 * Returns an ArchDiaLayout ready for storage.
 */
export async function computeElkLayout(scene: DiagramScene, options?: ElkLayoutOptions): Promise<ArchDiaLayout> {
    const elk = new ELK();

    const w = options?.width ?? DEFAULT_LAYOUT_WIDTH;
    const h = options?.height ?? DEFAULT_LAYOUT_HEIGHT;

    const graph = buildElkGraph(scene);
    const result = await elk.layout(graph);

    return extractLayout(result, w, h);
}

/**
 * Compute positions for newly-added components while keeping existing
 * ones fixed. Uses ELK's fixed-position support to anchor known nodes.
 */
export async function computeIncrementalLayout(
    scene: DiagramScene,
    existingLayout: ArchDiaLayout,
    newKeys: string[],
): Promise<ArchDiaLayout> {
    const elk = new ELK();

    // If there are no existing components, just do a full layout
    const existingCount = Object.keys(existingLayout.positions).length;
    if (existingCount === 0) {
        return computeElkLayout(scene);
    }

    const targetWidth = existingLayout.size.width;
    const targetHeight = existingLayout.size.height;

    // Use ELK with fixed node positions for existing elements
    const graph = buildElkGraph(scene, existingLayout.positions);

    // Attempt the layout with interactive/fixed mode hints
    graph.layoutOptions = {
        ...graph.layoutOptions,
        'elk.layered.crossingMinimization.semiInteractive': 'true',
        // Optional: 'elk.layered.nodePlacement.strategy': 'INTERACTIVE'
    };

    const result = await elk.layout(graph);
    const fullLayout = extractLayout(result, targetWidth, targetHeight);

    // Merge existing positions with new ones computed by ELK
    const mergedPositions = { ...existingLayout.positions };
    for (const key of newKeys) {
        if (fullLayout.positions[key]) {
            mergedPositions[key] = fullLayout.positions[key];
        }
    }

    return {
        size: existingLayout.size,
        positions: mergedPositions,
    };
}


// === Internal: Build ELK graph ===

function buildElkGraph(
    scene: DiagramScene,
    fixedPositions?: Record<string, ComponentPosition>
): ElkNode {
    const { components, containers, relations } = scene;

    // Index containers by id for parent lookup
    const containerMap = new Map<string, ElkNode>();

    // Create container nodes (in order, to handle nesting)
    for (const container of containers) {
        const node: ElkNode = {
            id: container.id,
            labels: [{ text: container.label }],
            layoutOptions: {
                'elk.padding': `[top=${CONTAINER_PADDING + 20},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
            },
            children: [],
            edges: [],
        };
        containerMap.set(container.id, node);
    }

    // Nest containers inside their parents
    for (const container of containers) {
        if (container.parentId && containerMap.has(container.parentId)) {
            containerMap.get(container.parentId)!.children!.push(
                containerMap.get(container.id)!,
            );
        }
    }

    // Create component (leaf) nodes
    const componentNodes: ElkNode[] = components.map(comp => {
        const id = comp.alias || comp.name;
        const fixedPos = fixedPositions?.[id];

        const node: ElkNode = {
            id,
            labels: [{ text: comp.name }],
            width: estimateNodeWidth(comp.name, comp.members, comp.stereotype),
            height: getNodeHeight(comp.type, comp.members, comp.name),
        };

        if (fixedPos) {
            node.x = fixedPos.x;
            node.y = fixedPos.y;
            node.layoutOptions = {
                'elk.position': `(x=${fixedPos.x}, y=${fixedPos.y})`,
            };
        }

        return node;
    });

    // Place component nodes into their parent containers
    const rootChildren: ElkNode[] = [];

    for (let i = 0; i < components.length; i++) {
        const comp = components[i];
        const node = componentNodes[i];

        const primaryParent = comp.parentIds?.[0];
        if (primaryParent && containerMap.has(primaryParent)) {
            containerMap.get(primaryParent)!.children!.push(node);
        } else {
            rootChildren.push(node);
        }
    }

    // Add top-level containers (those without a parent)
    for (const container of containers) {
        if (!container.parentId || !containerMap.has(container.parentId)) {
            rootChildren.push(containerMap.get(container.id)!);
        }
    }

    // Build edges
    const edges: ElkExtendedEdge[] = relations.map((rel, i) => ({
        id: `e${i}`,
        sources: [rel.from],
        targets: [rel.to],
        labels: rel.label ? [{ text: rel.label }] : undefined,
    }));

    return {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.layered.spacing.nodeNodeBetweenLayers': '80',
            'elk.spacing.nodeNode': '40',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.direction': 'DOWN',
        },
        children: rootChildren,
        edges,
    };
}

// === Internal: Extract layout from ELK result ===

export const DEFAULT_LAYOUT_WIDTH = 925;
export const DEFAULT_LAYOUT_HEIGHT = 768;

/** Padding around the fitted content (px on each side). */
const FIT_PADDING = 20;

function extractLayout(result: ElkNode, targetWidth: number, targetHeight: number): ArchDiaLayout {
    const positions: Record<string, ComponentPosition> = {};
    const nodeSizes: Record<string, { w: number; h: number }> = {};

    function walk(node: ElkNode, offsetX: number, offsetY: number) {
        const isLeaf = !node.children || node.children.length === 0;

        if (node.id !== 'root' && isLeaf) {
            positions[node.id] = {
                x: (node.x ?? 0) + offsetX,
                y: (node.y ?? 0) + offsetY,
            };
            nodeSizes[node.id] = {
                w: node.width ?? 0,
                h: node.height ?? 0,
            };
        }

        const childOffsetX = (node.id !== 'root' ? (node.x ?? 0) : 0) + offsetX;
        const childOffsetY = (node.id !== 'root' ? (node.y ?? 0) : 0) + offsetY;

        for (const child of node.children ?? []) {
            walk(child, childOffsetX, childOffsetY);
        }
    }

    walk(result, 0, 0);

    // Fit content into the target viewport: scale down if needed, then center.
    const ids = Object.keys(positions);
    if (ids.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of ids) {
            const p = positions[id];
            const s = nodeSizes[id];
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + s.w);
            maxY = Math.max(maxY, p.y + s.h);
        }

        const contentW = maxX - minX;
        const contentH = maxY - minY;
        const availW = targetWidth - FIT_PADDING * 2;
        const availH = targetHeight - FIT_PADDING * 2;

        // Translate only — never scale. Nodes are drawn at their natural size,
        // so shrinking the spacing alone would make boxes overlap. Content
        // larger than the viewport simply overflows it; consumers report the
        // ideal size back through onSizeChange (or "fit to content").
        const offsetX = FIT_PADDING + Math.max(0, (availW - contentW) / 2) - minX;
        const offsetY = FIT_PADDING + Math.max(0, (availH - contentH) / 2) - minY;

        for (const id of ids) {
            const p = positions[id];
            positions[id] = {
                x: Math.round(p.x + offsetX),
                y: Math.round(p.y + offsetY),
            };
        }
    }

    return {
        size: { width: targetWidth, height: targetHeight },
        positions,
    };
}
