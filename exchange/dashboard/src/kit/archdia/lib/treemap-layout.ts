import * as d3 from 'd3-hierarchy';
import {
    ArchDiaLayout,
    ComponentPosition,
    DiagramScene,
} from './archdia-model';

interface TreeNode {
    id: string; // container id or component id
    title: string;
    isComponent: boolean;
    children?: TreeNode[];
    fitScore?: number;
}

const DEFAULT_LAYOUT_WIDTH = 925;
const DEFAULT_LAYOUT_HEIGHT = 768;

export function computeTreemapLayout(scene: DiagramScene, options?: { width?: number; height?: number }): ArchDiaLayout {
    const w = options?.width ?? DEFAULT_LAYOUT_WIDTH;
    const h = options?.height ?? DEFAULT_LAYOUT_HEIGHT;

    const { components, containers } = scene;

    // Build hierarchy
    const containerMap = new Map<string, TreeNode>();
    for (const c of containers) {
        containerMap.set(c.id, { id: c.id, title: c.label, isComponent: false, children: [] });
    }

    const rootNodes: TreeNode[] = [];

    // Add containers to parents
    for (const c of containers) {
        const node = containerMap.get(c.id)!;
        if (c.parentId && containerMap.has(c.parentId)) {
            containerMap.get(c.parentId)!.children!.push(node);
        } else {
            rootNodes.push(node);
        }
    }

    // Add components to parents
    for (const comp of components) {
        const id = comp.alias || comp.name;
        const node: TreeNode = { id, title: comp.name, isComponent: true };
        const primaryParent = comp.parentIds?.[0];
        if (primaryParent && containerMap.has(primaryParent)) {
            containerMap.get(primaryParent)!.children!.push(node);
        } else {
            rootNodes.push(node);
        }
    }

    const hasFakeRoot = rootNodes.length > 1;
    const rootData: TreeNode = hasFakeRoot ? { id: '___FAKE_ROOT___', title: '___FAKE_ROOT___', isComponent: false, children: rootNodes } : rootNodes[0];

    const root = d3.hierarchy(rootData).sum(d => {
        return d.isComponent ? 1 : 0;
    });

    const paddingInner = 12;
    const paddingOuter = 12;

    const treemap = d3.treemap<TreeNode>()
        .size([w, h])
        .paddingInner(paddingInner)
        .paddingOuter(paddingOuter)
        .paddingTop((node) => {
            if (hasFakeRoot && node.depth === 0) return 0;
            const titleStr = node.data.title || '';
            if (!titleStr || titleStr === '___FAKE_ROOT___') return 0;

            const nodeWidth = node.x1 - node.x0;
            const availableTextWidth = Math.max(20, nodeWidth - 16);
            const charsPerLine = Math.floor(availableTextWidth / 7);
            const lines = Math.max(1, Math.ceil(titleStr.length / Math.max(1, charsPerLine)));

            const desiredHeight = lines * 18 + 18;
            return Math.min(desiredHeight, (node.y1 - node.y0) * 0.75);
        });

    treemap.tile(d3.treemapSquarify);

    const treemapRoot = treemap(root) as d3.HierarchyRectangularNode<TreeNode>;
    const nodes = treemapRoot.descendants();

    const positions: Record<string, ComponentPosition> = {};

    for (const node of nodes) {
        if (node.data.isComponent) {
            positions[node.data.id] = {
                x: node.x0,
                y: node.y0,
            };
        }
    }

    // ELK layout doesn't automatically size containers as node width/height.
    // However, the renderer `computeContainerBounds` dynamically computes container bounds
    // based on leaves. Here, treemap also sizes leaves, but their widths and heights shouldn't
    // overlap with the treemap padding.
    // Wait, the renderer uses the `width` and `height` of the components to calculate minX/maxX!
    // But treemap layout sets x0 and y0 as well as x1 and y1 for the leaves, which defines width and height.
    // archdia doesn't store width/height! It just stores x/y coordinates of leaves, and renderer estimates node width based on names and properties.
    // If we just use node.x0 and node.y0, the renderer will compute its own width/height for components.
    // Ah... The prompt says: "Note that in archdia, containers automatically adapt to their content, so do not try to act on them: only the leafs should be positionned"

    return {
        size: { width: w, height: h },
        positions
    };
}
