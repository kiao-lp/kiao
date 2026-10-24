/**
 * The layout PlantUML itself would have produced.
 *
 * PlantUML draws through Graphviz `dot`: a layered (Sugiyama) drawing where
 * every relation steps from one rank to the next, packages are clusters that
 * stay contiguous, and declaration order decides what ends up left of what.
 * ELK's `layered` algorithm is the same family, so this module drives it with
 * dot's parameters and supplies what dot reads from the source but the scene
 * does not carry: the reading direction, and the arrow hints (`-up->`,
 * `-right->`, C4's `Rel_Neighbor`) that pin two elements onto one rank.
 *
 * The aim is recognition rather than pixel equality — someone importing a
 * PlantUML diagram should find the same things in the same places — and, unlike
 * the other layouts, this one also sets the document bounds: the result is
 * sized so the whole diagram is inside the visible area from the first render.
 */
import {
    ArchDiaLayout,
    ComponentPosition,
    DiagramComponent,
    DiagramContainer,
    DiagramRelation,
    DiagramScene,
} from './archdia-model';
import { computeContainerBounds } from './container-bounds';
import { estimateNodeWidth, getNodeHeight } from './component-sizing';
import { extractPlantUmlDirection, PlantUmlDirection } from './diagram-source';
import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';

// === Constants ===

/**
 * dot's own spacing, in the points PlantUML renders at: `nodesep` 0.25in
 * between neighbours on a rank, `ranksep` 0.5in between ranks.
 */
const NODE_SPACING = 36;
const RANK_SPACING = 72;

/** Free space between the content and the edges of the document. */
const DOCUMENT_PADDING = 24;

// === Public API ===

export interface PlantUmlLayoutOptions {
    /** Document width to fill; grown when the diagram needs more. */
    width?: number;
    /** Document height to fill; grown when the diagram needs more. */
    height?: number;
}

/** Document size used when the caller has no preference of its own. */
export const PLANTUML_LAYOUT_WIDTH = 925;
export const PLANTUML_LAYOUT_HEIGHT = 768;

/**
 * Lay a scene out the way PlantUML would have drawn it.
 *
 * @param scene    What the source declares — components, containers, relations.
 * @param source   The PlantUML source itself, read for its layout directives.
 * @param options  Document size to aim for; the result grows past it rather
 *                 than letting the diagram fall outside the visible area.
 */
export async function computePlantUmlLayout(
    scene: DiagramScene,
    source: string,
    options?: PlantUmlLayoutOptions,
): Promise<ArchDiaLayout> {
    const direction = extractPlantUmlDirection(source);
    const order = declarationOrder(source, scene);
    const groups = buildRankGroups(scene, order);

    const graph = buildDotGraph(scene, direction, order, groups);
    const laid = await new ELK().layout(graph);

    const positions = separatePackages(readGroupPositions(laid, groups, direction, sizeIndex(scene)), scene, direction);

    return fitDocument(positions, scene, {
        width: options?.width ?? PLANTUML_LAYOUT_WIDTH,
        height: options?.height ?? PLANTUML_LAYOUT_HEIGHT,
    });
}

// === Declaration order ===

/**
 * Where each element is declared, as a line number.
 *
 * dot lays a rank out in the order the nodes were declared, and PlantUML feeds
 * it the source top to bottom — so this ordering is most of what decides which
 * element ends up leftmost. The declaration of an element is taken to be the
 * first line naming it: a source cannot mention an element it has not reached.
 */
function declarationOrder(source: string, scene: DiagramScene): Map<string, number> {
    const keys = [
        ...scene.components.map(component => component.alias || component.name),
        ...scene.containers.map(container => container.id),
    ];
    // The label carries the declaration when the element has no alias of its own.
    const labels = new Map<string, string>([
        ...scene.components.map(component => [component.alias || component.name, component.name] as const),
        ...scene.containers.map(container => [container.id, container.label] as const),
    ]);

    const order = new Map<string, number>();
    const lines = source.split('\n');

    for (let line = 0; line < lines.length; line++) {
        for (const key of keys) {
            if (order.has(key)) continue;
            if (mentions(lines[line], key) || mentions(lines[line], labels.get(key) ?? key)) {
                order.set(key, line);
            }
        }
    }

    // Anything never matched keeps the order it came out of the extractor in.
    keys.forEach((key, index) => {
        if (!order.has(key)) order.set(key, lines.length + index);
    });

    return order;
}

/** Whether a line names an element — as a whole word, so `Go` is not found inside `Google`. */
function mentions(line: string, key: string): boolean {
    const index = line.indexOf(key);
    if (index < 0) return false;
    const isWordChar = (char: string | undefined) => char !== undefined && /\w/.test(char);
    return !(isWordChar(line[index - 1]) && isWordChar(key[0]))
        && !(isWordChar(line[index + key.length]) && isWordChar(key[key.length - 1]));
}

// === Rank groups ===

/**
 * Elements pinned side by side on one rank.
 *
 * `A -right-> B`, `A -left-> B` and C4's `Rel_Neighbor` all tell dot not to
 * push the target onto the next rank. ELK has no same-rank constraint, so the
 * members are laid out as a single node and shared back out afterwards — which
 * is what a rank is anyway.
 */
interface RankGroup {
    id: string;
    /** Member keys, in the order they are to be drawn along the rank. */
    members: string[];
}

/** A relation whose hint keeps both ends on one rank. */
function isSameRankHint(relation: DiagramRelation): boolean {
    return relation.rankHint === 'left' || relation.rankHint === 'right' || relation.rankHint === 'none';
}

function buildRankGroups(scene: DiagramScene, order: Map<string, number>): RankGroup[] {
    const components = new Map(scene.components.map(component => [component.alias || component.name, component]));

    // Every element starts alone on its rank; hinted relations merge two of them.
    const groupOf = new Map<string, RankGroup>();
    for (const key of components.keys()) {
        groupOf.set(key, { id: key, members: [key] });
    }

    for (const relation of scene.relations) {
        if (!isSameRankHint(relation)) continue;

        const from = groupOf.get(relation.from);
        const to = groupOf.get(relation.to);
        if (!from || !to || from === to) continue;

        // `left` and `right` say which side to take; `norank` says only that
        // the two share a rank, and a rank reads in declaration order.
        const declaredFirst = (order.get(from.members[0]) ?? 0) <= (order.get(to.members[0]) ?? 0);
        const [first, second] = relation.rankHint === 'left' ? [to, from]
            : relation.rankHint === 'right' ? [from, to]
            : declaredFirst ? [from, to] : [to, from];

        const merged: RankGroup = { id: from.id, members: [...first.members, ...second.members] };
        for (const key of merged.members) groupOf.set(key, merged);
    }

    return [...new Set(groupOf.values())];
}

function parentOf(component: DiagramComponent | undefined): string | undefined {
    return component?.parentIds?.[0];
}

// === The dot-shaped ELK graph ===

function buildDotGraph(
    scene: DiagramScene,
    direction: PlantUmlDirection,
    order: Map<string, number>,
    groups: RankGroup[],
): ElkNode {
    const sizes = sizeIndex(scene);
    const groupByMember = new Map(groups.flatMap(group => group.members.map(member => [member, group] as const)));

    // A rank group is one node to ELK: long enough to hold its members side by
    // side along the rank, which runs across the reading direction.
    const nodes: ElkNode[] = groups.map(group => {
        const members = group.members.map(member => sizes.get(member)!);
        const along = members.reduce((total, size) => total + (direction === 'LR' ? size.height : size.width), 0)
            + NODE_SPACING * (members.length - 1);
        const across = Math.max(...members.map(size => (direction === 'LR' ? size.width : size.height)));

        return {
            id: group.id,
            width: direction === 'LR' ? across : along,
            height: direction === 'LR' ? along : across,
        };
    });

    // The graph is flat: dot ranks straight through a package, so a cluster
    // must not become a node of its own — it would take a rank to itself and
    // push everything the source put beside it out of line. What holds a
    // package together is the order instead: laid out one after another, its
    // members stay contiguous within every rank, and the packages themselves
    // keep one order throughout the diagram.
    const sourceOrder = nestedSourceOrder(scene, order);
    const groupOrder = new Map(groups.map(group =>
        [group.id, Math.min(...group.members.map(sourceOrder))]));
    nodes.sort((left, right) => groupOrder.get(left.id)! - groupOrder.get(right.id)!);

    return {
        id: 'root',
        layoutOptions: dotLayoutOptions(direction),
        children: nodes,
        edges: buildEdges(scene.relations, groupByMember),
    };
}

/**
 * Where an element sits in the source, read as a path: the packages enclosing
 * it, outermost first, then the element itself — each by the line it was
 * declared on. Sorting on it is what nests the diagram, since two elements of
 * one package share a prefix and so end up next to each other.
 */
function nestedSourceOrder(scene: DiagramScene, order: Map<string, number>): (key: string) => number {
    const parents = new Map(scene.containers.map(container => [container.id, container.parentId]));
    const componentByKey = new Map(scene.components.map(component => [component.alias || component.name, component]));

    const path = (key: string): number[] => {
        const steps: number[] = [];
        for (let id = parentOf(componentByKey.get(key)); id; id = parents.get(id)) {
            steps.unshift(order.get(id) ?? Infinity);
        }
        return [...steps, order.get(key) ?? Infinity];
    };

    // The paths become one comparable number, so ELK's model order — simply
    // the position in this list — carries the nesting with it.
    const sorted = [...componentByKey.keys()]
        .map(key => ({ key, path: path(key) }))
        .sort((left, right) => comparePaths(left.path, right.path));

    const index = new Map(sorted.map((entry, position) => [entry.key, position]));
    return (key: string) => index.get(key) ?? Infinity;
}

function comparePaths(left: number[], right: number[]): number {
    for (let step = 0; step < Math.max(left.length, right.length); step++) {
        const difference = (left[step] ?? -1) - (right[step] ?? -1);
        if (difference !== 0) return difference;
    }
    return 0;
}

/** dot's own parameters, in ELK's vocabulary. */
function dotLayoutOptions(direction: PlantUmlDirection): Record<string, string> {
    return {
        'elk.algorithm': 'layered',
        'elk.direction': direction === 'LR' ? 'RIGHT' : 'DOWN',
        'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
        // What keeps the source's own order visible in the result.
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        // Crossing minimisation runs, as it does in dot, but a departure from
        // the order the source was written in is counted against it exactly as
        // an edge crossing would be — which is what keeps the declaration order
        // legible in the result without laying the diagram out blind to it.
        'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '1',
        'elk.spacing.nodeNode': `${NODE_SPACING}`,
        'elk.layered.spacing.nodeNodeBetweenLayers': `${RANK_SPACING}`,
        'elk.spacing.componentComponent': `${RANK_SPACING}`,
        'elk.spacing.edgeNode': `${NODE_SPACING / 2}`,
        'elk.spacing.edgeEdge': '16',
    };
}

/**
 * The relations, as ranking constraints.
 *
 * An `-up->` runs against the reading direction, so it is handed to ELK
 * reversed; a relation inside a rank group has nothing left to constrain and
 * is dropped, its two ends being one node by then.
 */
function buildEdges(relations: DiagramRelation[], groupByMember: Map<string, RankGroup>): ElkExtendedEdge[] {
    const edges: ElkExtendedEdge[] = [];

    for (const relation of relations) {
        const from = groupByMember.get(relation.from);
        const to = groupByMember.get(relation.to);
        if (!from || !to || from === to) continue;
        if (isSameRankHint(relation)) continue;

        const reversed = relation.rankHint === 'up';
        edges.push({
            id: `e${edges.length}`,
            sources: [reversed ? to.id : from.id],
            targets: [reversed ? from.id : to.id],
        });
    }

    return edges;
}

/**
 * The size every component will be drawn at, keyed by element key. The
 * renderer sizes boxes from their own text, so the layout has to agree with it
 * — what is laid out is what gets drawn.
 */
function sizeIndex(scene: DiagramScene): Map<string, { width: number; height: number }> {
    return new Map(scene.components.map(component => [
        component.alias || component.name,
        {
            width: estimateNodeWidth(component.name, component.members, component.stereotype),
            height: getNodeHeight(component.type, component.members, component.name),
        },
    ]));
}

// === Reading the result back ===

/** Absolute position of every rank-group node ELK laid out. */
function readGroupPositions(
    laid: ElkNode,
    groups: RankGroup[],
    direction: PlantUmlDirection,
    sizes: Map<string, { width: number; height: number }>,
): Record<string, ComponentPosition> {
    const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();

    const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
        const x = (node.x ?? 0) + offsetX;
        const y = (node.y ?? 0) + offsetY;
        if (node.id !== 'root') {
            boxes.set(node.id, { x, y, width: node.width ?? 0, height: node.height ?? 0 });
        }
        for (const child of node.children ?? []) {
            walk(child, node.id === 'root' ? offsetX : x, node.id === 'root' ? offsetY : y);
        }
    };
    walk(laid, 0, 0);

    // Share each group's box back out among its members, along the rank.
    const positions: Record<string, ComponentPosition> = {};

    for (const group of groups) {
        const box = boxes.get(group.id);
        if (!box) continue;

        let along = 0;
        for (const member of group.members) {
            const size = sizes.get(member) ?? { width: 0, height: 0 };
            // Members are centred across the rank, the way dot lines a rank up.
            positions[member] = direction === 'LR'
                ? { x: Math.round(box.x + (box.width - size.width) / 2), y: Math.round(box.y + along) }
                : { x: Math.round(box.x + along), y: Math.round(box.y + (box.height - size.height) / 2) };
            along += (direction === 'LR' ? size.height : size.width) + NODE_SPACING;
        }
    }

    return positions;
}

// === Package bands ===

/** Clear space left between two packages standing side by side. */
const PACKAGE_SPACING = 24;

/**
 * Pull the outermost packages apart until none of them overlaps another.
 *
 * A rank runs through packages and past them, so nothing stops the widest rank
 * of one package from reaching under its neighbour — the ranking knows about
 * elements, not about the boxes drawn around them. dot answers this by giving
 * every cluster a band of its own across the rank axis, and so does this: the
 * packages keep the order the layout gave them, and each one that would
 * trespass is pushed clear, taking whatever stands beyond it along.
 */
function separatePackages(
    positions: Record<string, ComponentPosition>,
    scene: DiagramScene,
    direction: PlantUmlDirection,
): Record<string, ComponentPosition> {
    const outermost = scene.containers.filter(container => !container.parentId);
    if (outermost.length < 2) return positions;

    // The band runs across the reading direction: side by side under a top to
    // bottom diagram, stacked under a left to right one.
    const across = direction === 'LR' ? 'y' : 'x';
    const extent = direction === 'LR' ? 'height' : 'width';

    const boxes = computeContainerBounds(scene.containers, scene.components, positions);
    const bands = outermost
        .map(container => ({
            members: descendantsOf(container.id, scene),
            start: boxes[container.id]?.[across] ?? 0,
            size: boxes[container.id]?.[extent] ?? 0,
        }))
        .filter(band => band.members.size > 0)
        .sort((left, right) => left.start - right.start);

    // Each package moves as one piece, keeping what the ranking gave it; only
    // packages that would trespass move at all, and only far enough to clear.
    let frontier = -Infinity;
    const shifted = bands.map(band => {
        const start = Math.max(band.start, frontier);
        frontier = start + band.size + PACKAGE_SPACING;
        return { ...band, shift: start - band.start };
    });

    if (shifted.every(band => band.shift === 0)) return positions;

    const placed: Record<string, ComponentPosition> = {};
    for (const [key, position] of Object.entries(positions)) {
        const band = shifted.find(candidate => candidate.members.has(key))
            // What is in no package travels with the band it stands in, so an
            // actor drawn alongside one does not stay behind when it moves.
            ?? nearestBand(shifted, position[across]);
        placed[key] = { ...position, [across]: position[across] + (band?.shift ?? 0) };
    }

    return placed;
}

/** The band an unpackaged element belongs with: the one it sits in, else the closest. */
function nearestBand<T extends { start: number; size: number }>(bands: T[], at: number): T | undefined {
    const distance = (band: T) => Math.max(band.start - at, at - (band.start + band.size), 0);
    return bands.reduce<T | undefined>(
        (closest, band) => (!closest || distance(band) < distance(closest) ? band : closest),
        undefined,
    );
}

/** Every component under a package, however deeply nested. */
function descendantsOf(containerId: string, scene: DiagramScene): Set<string> {
    const nested = new Set([containerId]);
    for (let added = true; added;) {
        added = false;
        for (const container of scene.containers) {
            if (container.parentId && nested.has(container.parentId) && !nested.has(container.id)) {
                nested.add(container.id);
                added = true;
            }
        }
    }

    return new Set(
        scene.components
            .filter(component => (component.parentIds ?? []).some(parent => nested.has(parent)))
            .map(component => component.alias || component.name),
    );
}

// === Document bounds ===

/**
 * Place the content inside a document that holds all of it.
 *
 * The other layouts leave the diagram to overflow whatever size the file
 * carries; this one is the layout of an import, where nothing has been placed
 * by hand yet, so it grows the document to the diagram and centres what is
 * smaller than the size asked for.
 */
function fitDocument(
    positions: Record<string, ComponentPosition>,
    scene: DiagramScene,
    requested: { width: number; height: number },
): ArchDiaLayout {
    const bounds = contentBounds(positions, scene);
    if (!bounds) return { size: requested, positions };

    const width = Math.max(requested.width, Math.round(bounds.width + DOCUMENT_PADDING * 2));
    const height = Math.max(requested.height, Math.round(bounds.height + DOCUMENT_PADDING * 2));

    const shiftX = (width - bounds.width) / 2 - bounds.minX;
    const shiftY = (height - bounds.height) / 2 - bounds.minY;

    const placed: Record<string, ComponentPosition> = {};
    for (const [key, position] of Object.entries(positions)) {
        placed[key] = { x: Math.round(position.x + shiftX), y: Math.round(position.y + shiftY) };
    }

    return { size: { width, height }, positions: placed };
}

/**
 * The box the diagram actually occupies, containers included — their bounds
 * reach past their children, and a package drawn off-document is as lost as a
 * component would be.
 */
function contentBounds(positions: Record<string, ComponentPosition>, scene: DiagramScene) {
    const containers = computeContainerBounds(scene.containers, scene.components, positions);
    const sizes = sizeIndex(scene);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number, width: number, height: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    };

    for (const [key, position] of Object.entries(positions)) {
        const size = sizes.get(key) ?? { width: 0, height: 0 };
        add(position.x, position.y, size.width, size.height);
    }
    for (const rect of Object.values(containers)) {
        add(rect.x, rect.y, rect.width, rect.height);
    }

    if (minX === Infinity) return null;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
}
