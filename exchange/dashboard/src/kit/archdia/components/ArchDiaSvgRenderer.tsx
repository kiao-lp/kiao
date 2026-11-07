import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
    BOX_FONT_SIZE, BOX_RADIUS, EDGE_LABEL_FONT_SIZE,
    clientToSvg, markdownToHtml,
} from '@cms-kit/diagram-shared';
import { ArchDiaLayout, ClassMember, DiagramComponent, DiagramRelation, DiagramScene } from '../lib/archdia-model';
import { computeContainerBounds } from '../lib/container-bounds';
import {
    RelationBend, RelationRect, computeRelationGeometry, computeSelfLoopGeometry,
    relationFanOffset, relationKeys,
} from '../lib/relation-geometry';
import {
    DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, estimateNodeWidth, getNodeHeight,
    CLASS_HEADER_HEIGHT, CLASS_MEMBER_LINE_HEIGHT, CLASS_SECTION_PAD, CLASS_MIN_SECTION_HEIGHT,
} from '../lib/component-sizing';
import { parseAllDescriptions, patchDescriptionRaw } from '../lib/archdia-parser';

// === Constants ===

const BOX_RX = BOX_RADIUS;

const COMPONENT_LABEL_FONT_SIZE = BOX_FONT_SIZE;
const COMPONENT_STEREOTYPE_FONT_SIZE = 14;
const CONTAINER_LABEL_FONT_SIZE = 16;
const RELATION_LABEL_FONT_SIZE = EDGE_LABEL_FONT_SIZE;
const RELATION_HANDLE_RADIUS = 6;
const CLASS_MEMBER_FONT_SIZE = 12;

// Stereotypes that say what an element is in a decomposition rather than describing it.
// Their text is never printed: the shape already carries the reading, the word would repeat it.
const isStructuralStereotype = (s?: string) => s ? ['zone', 'district', 'block', 'trust', 'deployable', 'app-service', 'app-function'].includes(s.toLowerCase()) : false;

const getMoscowInfo = (s?: string) => {
    if (!s) return null;
    const lower = s.toLowerCase();
    if (lower === 'must') return { char: '🔴', title: 'Must' };
    if (lower === 'should') return { char: '🟠', title: 'Should' };
    if (lower === 'could') return { char: '🟡', title: 'Could' };
    if (lower === 'won\'t' || lower === 'wont') return { char: '⚪', title: "Won't" };
    return null;
};
const isMoscowStereotype = (s?: string) => s ? getMoscowInfo(s) !== null : false;


const STICK_FIGURE_R = 6;
const QUEUE_RX = 8;
const SHAPE_HEIGHT = 40; // The fixed height of the icon shape part, while the total height includes label

const MultilineText = ({ text, x, lineHeight, centerVertically, moscowInfo }: { text: string, x: number | string, lineHeight: number, centerVertically?: boolean, moscowInfo?: { char: string, title: string } | null }) => {
    if (!text) return null;
    const lines = text.split(/\\n|\n/);
    if (lines.length === 1) {
        if (moscowInfo) {
            return (
                <>
                    <tspan className="archdia-moscow-prefix">
                        <title>{moscowInfo.title}</title>
                        {moscowInfo.char + ' '}
                    </tspan>
                    {text}
                </>
            );
        }
        return <>{text}</>;
    }
    const offset = centerVertically ? -(lines.length - 1) * lineHeight / 2 : 0;
    return (
        <>
            {lines.map((line, i) => (
                <tspan key={i} x={x} dy={i === 0 ? offset : lineHeight}>
                    {i === 0 && moscowInfo && (
                        <tspan className="archdia-moscow-prefix">
                            <title>{moscowInfo.title}</title>
                            {moscowInfo.char + ' '}
                        </tspan>
                    )}
                    {line}
                </tspan>
            ))}
        </>
    );
};



/** Escape a value for use inside a CSS attribute selector string. */
function cssSafeAttr(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface InlineTooltipItem {
    id: string;
    description: string;
    x: number;
    y: number;
    isOnRight?: boolean;
}


// === Drag State ===

interface DragState {
    /** Element id being dragged, or the relation key when a centre is. */
    elementId: string;
    /**
     * Set when what is being dragged is a relation's centre rather than an element: the key its
     * bend is filed under. The same start-move-commit plumbing carries both, and this is what
     * says which of the two the movement lands on.
     */
    bendKey?: string;
    /** Mouse position at drag start (SVG coords). */
    startMouseX: number;
    startMouseY: number;
    /** Element position at drag start. */
    startElemX: number;
    startElemY: number;
}

// === Component ===

/** Display options controlling which class details are visible. */
export interface DisplayOptions {
    showMethods: boolean;
    showProperties: boolean;
    showTypes: boolean;
}

export interface ArchDiaSvgRendererProps {
    /** Positional data (storage model). */
    layout: ArchDiaLayout;
    /** Raw markdown descriptions block. Descriptions are extracted on demand via getDescription(). */
    descriptionsRaw?: string;
    /** Diagram structure (render model) — inferred from PlantUML at runtime. */
    scene: DiagramScene;
    /** Called when one or more elements are dragged to a new position. */
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    /** Called when the raw descriptions markdown changes. If provided, enables click-to-edit. */
    onDescriptionsRawChange?: (descriptionsRaw: string | undefined) => void;
    /**
     * Called when a relation's centre is dragged, keyed as `layout.bends` is. A null value asks
     * for the bend to be dropped, which is what straightening a relation is. When provided, every
     * relation carries a handle at its centre; an export passes none and so draws no handles.
     */
    onBendsChange?: (updates: Record<string, RelationBend | null>) => void;
    /** Display options for toggling class members and type annotations. */
    displayOptions?: DisplayOptions;
    /** Selected theme, defaults to dark. 'light' applies the .archdia-theme-light class. */
    theme?: 'light' | 'dark';
    /**
     * Called when the box the content fits in changes.
     * When provided, the SVG uses layout.size as a fixed viewBox.
     * The parent can hand that box to `fitToContent` to crop the diagram around its content.
     */
    onSizeChange?: (box: ContentBox) => void;
}

function getDescendantComponents(containers: DiagramScene['containers'], components: DiagramScene['components'], rootId: string): string[] {
    const queue = [rootId];
    const descendantContainerIds = new Set<string>();

    while (queue.length > 0) {
        const id = queue.shift()!;
        descendantContainerIds.add(id);
        const children = containers.filter(c => c.parentId === id).map(c => c.id);
        queue.push(...children);
    }

    return components
        .filter(c => (c.parentIds ?? []).some(pid => descendantContainerIds.has(pid)))
        .map(c => c.alias || c.name);
}

/** Map PlantUML visibility characters to display symbols. */
function visSymbol(v?: string): string {
    if (v === '+') return '+';
    if (v === '-') return '\u2013'; // en-dash for private
    if (v === '#') return '#';
    if (v === '~') return '~';
    return '';
}

/** Render a list of class members (properties or methods) starting at a given Y. */
function renderMemberList(
    members: DiagramComponent['members'],
    startY: number,
    textPadLeft: number,
    keyPrefix: string,
) {
    if (!members || members.length === 0) return null;
    return members.map((m, i) => (
        <text
            key={`${keyPrefix}-${i}`}
            x={textPadLeft}
            y={startY + CLASS_SECTION_PAD / 2 + i * CLASS_MEMBER_LINE_HEIGHT + CLASS_MEMBER_LINE_HEIGHT / 2}
            fontSize={CLASS_MEMBER_FONT_SIZE}
            dominantBaseline="central"
            className={`archdia-class-member${m.isStatic ? ' archdia-class-member-static' : ''}${m.isAbstract ? ' archdia-class-member-abstract' : ''}`}
        >
            {m.visibility && (
                <tspan className="archdia-class-visibility">{visSymbol(m.visibility)} </tspan>
            )}
            {m.text}
        </text>
    ));
}

/**
 * Render a UML-style class node with compartments for properties and methods.
 */
function renderClassNode(
    comp: DiagramComponent,
    key: string,
    pos: { x: number; y: number },
    w: number,
    h: number,
    isDraggable: boolean,
    isEditable: boolean,
    handleMouseDown: (elementId: string, e: React.MouseEvent) => void,
    handleMouseUpElement: (elementId: string, e: React.MouseEvent) => void,
    description?: string,
) {
    const members = comp.members || [];
    const properties = members.filter(m => m.kind === 'property');
    const methods = members.filter(m => m.kind === 'method');
    const isEnum = comp.type?.toLowerCase() === 'enum';
    const cx = pos.x + w / 2;
    const textPadLeft = pos.x + 10;

    const headerH = CLASS_HEADER_HEIGHT;
    const propsY = pos.y + headerH;
    const propsH = properties.length > 0
        ? properties.length * CLASS_MEMBER_LINE_HEIGHT + CLASS_SECTION_PAD
        : (isEnum ? 0 : CLASS_MIN_SECTION_HEIGHT);
    const methodsY = propsY + propsH;

    const hasPropertiesComp = properties.length > 0 || !isEnum;
    const hasMethodsComp = methods.length > 0 || !isEnum;

    return (
        <g
            key={key}
            className={`archdia-component${comp.external ? ' archdia-component-external' : ''}${comp.stereotype ? ` archdia-component-${comp.stereotype}` : ''}${isDraggable ? ' archdia-draggable' : ''}${isEditable ? ' archdia-editable' : ''}`}
            data-archdia-id={description ? key : undefined}
            onMouseDown={isDraggable ? (e) => handleMouseDown(key, e) : undefined}
            onMouseUp={isEditable || isDraggable ? (e) => handleMouseUpElement(key, e) : undefined}
        >
            {/* Invisible background for mouse events */}
            <rect x={pos.x} y={pos.y} width={w} height={h} fill="transparent" />

            {/* Outer box */}
            <rect
                x={pos.x} y={pos.y} width={w} height={h}
                rx={BOX_RX} ry={BOX_RX}
                className="archdia-component-box"
            />

            {/* Header: stereotype + name */}
            {comp.stereotype && !isStructuralStereotype(comp.stereotype) && !isMoscowStereotype(comp.stereotype) && (
                <text
                    x={cx} y={pos.y + 12}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={COMPONENT_STEREOTYPE_FONT_SIZE}
                    className="archdia-component-stereotype"
                >
                    {`\u00ab${comp.stereotype}\u00bb`}
                </text>
            )}
            <text
                x={cx} y={pos.y + (comp.stereotype && !isStructuralStereotype(comp.stereotype) && !isMoscowStereotype(comp.stereotype) ? 26 : headerH / 2)}
                textAnchor="middle" dominantBaseline="central"
                fontSize={COMPONENT_LABEL_FONT_SIZE}
                className="archdia-component-label"
                fontWeight="bold"
            >
                {comp.stereotype && isMoscowStereotype(comp.stereotype) && (
                    <tspan className="archdia-moscow-prefix">
                        <title>{getMoscowInfo(comp.stereotype)?.title}</title>
                        {getMoscowInfo(comp.stereotype)?.char + ' '}
                    </tspan>
                )}
                {comp.name}
            </text>

            {hasPropertiesComp && (
                <>
                    {/* Separator: header → properties */}
                    <line
                        x1={pos.x} y1={propsY} x2={pos.x + w} y2={propsY}
                        className="archdia-class-separator"
                    />
                    {renderMemberList(properties, propsY, textPadLeft, 'prop')}
                </>
            )}

            {hasMethodsComp && (
                <>
                    {/* Separator: properties → methods */}
                    <line
                        x1={pos.x} y1={methodsY} x2={pos.x + w} y2={methodsY}
                        className="archdia-class-separator"
                    />
                    {renderMemberList(methods, methodsY, textPadLeft, 'meth')}
                </>
            )}
        </g>
    );
}

/**
 * Renders an architecture diagram as SVG.
 *
 * Renders in back-to-front order:
 *   1. Containers (dashed rectangles with labels)
 *   2. Relations (lines with arrowheads and optional labels)
 *   3. Components (solid rectangles with centered text)
 *
 * When `onPositionChange` is provided, elements are draggable.
 */
/** Strip type annotations (`: Type`) from a member text string. */
function stripTypes(text: string): string {
    // Remove return type at end:  `foo(x) : void`  →  `foo(x)`
    // Remove parameter types:     `foo(x : String)` → `foo(x)`
    // Remove property types:      `id : String`     → `id`
    return text
        .replace(/\s*:\s*[A-Za-z_][\w<>,\[\]?. ]*(?=\s*[),])/g, '')   // param types
        .replace(/\s*:\s*[A-Za-z_][\w<>,\[\]?. ]*$/g, '');              // return / property types
}

/** Filter and transform members based on display options. */
function filterMembers(members: ClassMember[] | undefined, opts: DisplayOptions): ClassMember[] | undefined {
    if (!members || members.length === 0) return members;
    let filtered = members.filter(m => {
        if (m.kind === 'method' && !opts.showMethods) return false;
        if (m.kind === 'property' && !opts.showProperties) return false;
        return true;
    });
    if (!opts.showTypes) {
        filtered = filtered.map(m => ({ ...m, text: stripTypes(m.text) }));
    }
    return filtered.length > 0 ? filtered : undefined;
}

// === Content Bounds Utility ===

/** The margin left around the content when the diagram is cropped to it. */
export const CONTENT_PADDING = 40;

/** @internal */
function getRawContentBounds(
    positions: Record<string, { x: number; y: number }>,
    components: DiagramComponent[],
    containerBounds: Record<string, { x: number; y: number; width: number; height: number }>,
) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const [key, pos] of Object.entries(positions)) {
        if (!pos) continue;
        const comp = components.find(c => (c.alias || c.name) === key);
        const w = comp ? estimateNodeWidth(comp.name, comp.members, comp.stereotype) : DEFAULT_NODE_WIDTH;
        const h = comp ? getNodeHeight(comp.type, comp.members, comp.name) : DEFAULT_NODE_HEIGHT;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + w);
        maxY = Math.max(maxY, pos.y + h);
    }
    for (const rect of Object.values(containerBounds)) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    }

    return { minX, minY, maxX, maxY };
}

/** Where the diagram content sits, and the canvas size that holds it with its margin. */
export interface ContentBox {
    /** The content's own top-left corner, in layout coordinates, margin excluded. */
    x: number;
    y: number;
    /** The content's extent plus `CONTENT_PADDING` on each of the four sides. */
    width: number;
    height: number;
}

/**
 * The box all diagram content (components + containers) occupies, margin included.
 *
 * `width`/`height` are what `layout.size` has to be for the diagram to fit; `x`/`y` say where the
 * content is drawn today, which is what tells a caller how far to move it to sit in that size.
 * Cropping without moving is what leaves a diagram hanging off its own right and bottom edges.
 */
export function computeContentBox(
    positions: Record<string, { x: number; y: number }>,
    components: DiagramComponent[],
    containerBounds: Record<string, { x: number; y: number; width: number; height: number }>,
): ContentBox | null {
    const { minX, minY, maxX, maxY } = getRawContentBounds(positions, components, containerBounds);
    if (minX === Infinity) return null;

    return {
        x: minX,
        y: minY,
        width: Math.round((maxX - minX) + CONTENT_PADDING * 2),
        height: Math.round((maxY - minY) + CONTENT_PADDING * 2),
    };
}

/**
 * Scale/Shift all positions by the negative of the minimum offset,
 * returning a new positions map where no element has x<0 or y<0.
 * If targetSize is provided and the diagram fits inside it, the diagram is centered.
 */
export function getNormalizedPositions(
    positions: Record<string, { x: number; y: number }>,
    components: DiagramComponent[],
    containers: DiagramScene['containers'],
    targetSize?: { width: number; height: number },
): Record<string, { x: number; y: number }> | null {
    const containerBounds = computeContainerBounds(containers, components, positions);
    const { minX, minY, maxX, maxY } = getRawContentBounds(positions, components, containerBounds);
    if (minX === Infinity) return null;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    let shiftX = -minX;
    let shiftY = -minY;

    if (targetSize) {
        if (contentWidth < targetSize.width) {
            shiftX = -minX + (targetSize.width - contentWidth) / 2;
        }
        if (contentHeight < targetSize.height) {
            shiftY = -minY + (targetSize.height - contentHeight) / 2;
        }
    }

    const updates: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of Object.entries(positions)) {
        updates[id] = {
            x: Math.round(pos.x + shiftX),
            y: Math.round(pos.y + shiftY),
        };
    }
    return updates;
}

export const ArchDiaSvgRenderer: React.FC<ArchDiaSvgRendererProps> = ({ layout, descriptionsRaw, scene, onPositionsChange, onDescriptionsRawChange, onBendsChange, displayOptions, theme, onSizeChange }) => {
    const { size, positions } = layout;
    const { containers, relations } = scene;

    // Parse descriptions once per string update
    const descriptions = useMemo(() => parseAllDescriptions(descriptionsRaw), [descriptionsRaw]);

    // Descriptions carried by the source itself (C4 macro arguments), overridden
    // by any DESCRIPTIONS entry declared for the same key.
    const effectiveDescriptions = useMemo(() => {
        const inline: Record<string, string> = {};
        for (const comp of scene.components) {
            if (comp.description) inline[comp.alias || comp.name] = comp.description;
        }
        for (const container of scene.containers) {
            if (container.description) inline[container.id] = container.description;
        }
        return Object.keys(inline).length > 0 ? { ...inline, ...descriptions } : descriptions;
    }, [scene.components, scene.containers, descriptions]);

    // Apply display option filters to component members
    const defaultOpts: DisplayOptions = { showMethods: true, showProperties: true, showTypes: true };
    const opts = displayOptions ?? defaultOpts;
    const components = useMemo(() => {
        if (opts.showMethods && opts.showProperties && opts.showTypes) return scene.components;
        return scene.components.map(c => ({
            ...c,
            members: filterMembers(c.members, opts),
        }));
    }, [scene.components, opts.showMethods, opts.showProperties, opts.showTypes]);

    const svgRef = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });



    // --- Editor State ---
    const [editorElementId, setEditorElementId] = useState<string | null>(null);
    const [editorValue, setEditorValue] = useState<string>('');
    const [editorPos, setEditorPos] = useState<{ x: number, y: number } | null>(null);

    // --- Drag & Click handlers ---

    const handleMouseDown = useCallback((elementId: string, e: React.MouseEvent) => {
        if (!onPositionsChange && !onDescriptionsRawChange) return;
        e.preventDefault();
        e.stopPropagation();

        // If clicking outside the active editor but on an element, we first save the existing one via its own onBlur
        // But let's proceed to track this mouse down.

        const svg = svgRef.current;
        if (!svg) return;

        const pos = positions[elementId];
        const { x, y } = clientToSvg(svg, e.clientX, e.clientY);
        setDrag({ elementId, startMouseX: x, startMouseY: y, startElemX: pos?.x ?? 0, startElemY: pos?.y ?? 0 });
        setDragOffset({ dx: 0, dy: 0 });
    }, [onPositionsChange, onDescriptionsRawChange, positions]);

    /**
     * Takes hold of a relation's centre. The relation is not selected and no editor is opened by
     * it: a centre is a handle on one relation and nothing else, so pressing it says only that
     * the thing is about to be moved.
     */
    const handleBendMouseDown = useCallback((bendKey: string, e: React.MouseEvent) => {
        if (!onBendsChange) return;
        e.preventDefault();
        e.stopPropagation();

        const svg = svgRef.current;
        if (!svg) return;

        const { x, y } = clientToSvg(svg, e.clientX, e.clientY);
        setDrag({ elementId: bendKey, bendKey, startMouseX: x, startMouseY: y, startElemX: 0, startElemY: 0 });
        setDragOffset({ dx: 0, dy: 0 });
    }, [onBendsChange]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!drag) return;
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;

        const { x, y } = clientToSvg(svg, e.clientX, e.clientY);
        setDragOffset({
            dx: x - drag.startMouseX,
            dy: y - drag.startMouseY,
        });
    }, [drag]);

    // --- Helper: get position with drag offset applied ---

    // --- Compute positions with drag offset applied for container bounds ---

    const effectivePositions = useMemo(() => {
        if (!drag || drag.bendKey) return positions;

        const isContainer = containers.some(c => c.id === drag.elementId);
        let draggedIds = [drag.elementId];
        if (isContainer) {
            draggedIds = getDescendantComponents(containers, components, drag.elementId);
        }

        const newPos = { ...positions };
        for (const id of draggedIds) {
            const p = positions[id];
            if (p) {
                newPos[id] = { ...p, x: p.x + dragOffset.dx, y: p.y + dragOffset.dy };
            }
        }
        return newPos;
    }, [positions, drag, dragOffset, containers, components]);

    function getPos(elementId: string) {
        return effectivePositions[elementId] || null;
    }

    // --- Container bounds computed from children positions ---

    const containerBounds = useMemo(
        () => computeContainerBounds(containers, components, effectivePositions),
        [containers, components, effectivePositions],
    );

    // --- Relation centres ---

    const bendKeys = useMemo(() => relationKeys(relations), [relations]);

    /**
     * Where every bent relation's centre currently is, the one being dragged included: its stored
     * bend plus how far the pointer has come, so the curve follows the hand and is written down
     * only once the centre is let go.
     */
    const effectiveBends = useMemo((): Record<string, RelationBend> => {
        const stored = layout.bends ?? {};
        if (!drag?.bendKey) return stored;

        const [bx, by] = stored[drag.bendKey] ?? [0, 0];
        return { ...stored, [drag.bendKey]: [bx + dragOffset.dx, by + dragOffset.dy] };
    }, [layout.bends, drag, dragOffset]);

    /** The box a relation attaches to, be it a component's or a container's, or none if unplaced. */
    const getBox = (elementId: string): RelationRect | null => {
        const pos = getPos(elementId);
        if (!pos) return containerBounds[elementId] ?? null;

        const comp = components.find(c => (c.alias || c.name) === elementId);
        return {
            x: pos.x,
            y: pos.y,
            width: comp ? estimateNodeWidth(comp.name, comp.members, comp.stereotype) : DEFAULT_NODE_WIDTH,
            height: comp ? getNodeHeight(comp.type, comp.members, comp.name) : DEFAULT_NODE_HEIGHT,
        };
    };

    const handleMouseUpElement = useCallback((elementId: string, e: React.MouseEvent) => {
        if (!drag) return;
        e.stopPropagation();

        // A relation's centre let go over an element is still that centre being let go: the
        // element under the pointer is not what was picked up, and opening its editor would be
        // answering a press that was never made on it.
        if (drag.bendKey) {
            handleMouseUp();
            return;
        }

        const isClick = Math.abs(dragOffset.dx) < 5 && Math.abs(dragOffset.dy) < 5;

        if (isClick && onDescriptionsRawChange) {
            // It was a click, open editor
            const pos = getPos(elementId);
            if (pos) {
                // If it's a container, pos comes from bounds
                let bx = pos.x;
                let by = pos.y;
                let compW = 320;

                if (!positions[elementId] && containerBounds[elementId]) {
                    bx = containerBounds[elementId].x;
                    by = containerBounds[elementId].y;
                    compW = containerBounds[elementId].width;
                } else {
                    const comp = components.find(c => (c.alias || c.name) === elementId);
                    if (comp) compW = estimateNodeWidth(comp.name, comp.members, comp.stereotype);
                }

                const isOnRight = (bx + compW / 2) > size.width / 2;
                const editX = isOnRight ? bx + compW - 320 - 10 : bx + 10;

                // Set editor slightly offset from the top left of the element (or right side if on right)
                setEditorPos({ x: editX, y: by + 10 });
                setEditorElementId(elementId);
                setEditorValue(effectiveDescriptions[elementId] || '');
            }
            setDrag(null);
            setDragOffset({ dx: 0, dy: 0 });
            return;
        }

        handleMouseUp();
    }, [drag, dragOffset, onDescriptionsRawChange, descriptionsRaw, containerBounds, positions, components, size.width, effectiveDescriptions]);

    const handleMouseUp = useCallback(() => {
        if (!drag) return;

        if (drag.bendKey) {
            // A press that moved nothing is not a bend: it leaves the relation as it was, which
            // is what lets the double-click that straightens it through.
            if (onBendsChange && (Math.abs(dragOffset.dx) >= 1 || Math.abs(dragOffset.dy) >= 1)) {
                const [bx, by] = effectiveBends[drag.bendKey];
                onBendsChange({ [drag.bendKey]: [Math.round(bx), Math.round(by)] });
            }
            setDrag(null);
            setDragOffset({ dx: 0, dy: 0 });
            return;
        }

        if (!onPositionsChange) return;

        const isContainer = containers.some(c => c.id === drag.elementId);
        let draggedIds = [drag.elementId];
        if (isContainer) {
            draggedIds = getDescendantComponents(containers, components, drag.elementId);
        }

        // Only update positions if moved significantly
        if (Math.abs(dragOffset.dx) >= 1 || Math.abs(dragOffset.dy) >= 1) {
            const updates: Record<string, { x: number, y: number }> = {};
            for (const id of draggedIds) {
                const p = positions[id];
                if (p) {
                    updates[id] = {
                        x: Math.round(p.x + dragOffset.dx),
                        y: Math.round(p.y + dragOffset.dy),
                    };
                }
            }
            onPositionsChange(updates);
        }

        setDrag(null);
        setDragOffset({ dx: 0, dy: 0 });
    }, [drag, dragOffset, onPositionsChange, onBendsChange, effectiveBends, containers, components, positions]);

    const handleMouseLeave = useCallback(() => {
        if (drag) {
            // Treat leaving the SVG the same as mouse-up
            handleMouseUp();
        }
    }, [drag, handleMouseUp]);

    // Compute the content box for fit-to-content
    const contentBox = useMemo(() => {
        return computeContentBox(effectivePositions, components, containerBounds);
    }, [effectivePositions, components, containerBounds]);

    // Notify parent of the box the content fits in (for on-demand "fit to content"). Its origin
    // travels with the diagram, so a drag that moves everything to the right is reported too.
    const lastReportedBox = useRef<string>('');
    useEffect(() => {
        if (!onSizeChange || !contentBox) return;
        const key = `${contentBox.x}:${contentBox.y}:${contentBox.width}:${contentBox.height}`;
        if (key !== lastReportedBox.current) {
            lastReportedBox.current = key;
            onSizeChange(contentBox);
        }
    }, [contentBox, onSizeChange]);

    // Use fixed viewBox based on layout.size (no auto-sizing)
    const viewBoxAttr = `0 0 ${size.width} ${size.height}`;
    const isDraggable = !!onPositionsChange;
    const isEditable = !!onDescriptionsRawChange;
    const isDragging = !!drag;

    // --- Relation tooltips ---
    // Keyed by relation identity so the tooltip layer and the relation layer
    // agree on ids. A [[#Key]] reference wins over an inline description.
    const relationTips = useMemo(() => {
        const tips = new Map<DiagramRelation, { id: string; description: string }>();
        relations.forEach((rel, index) => {
            const desc = (rel.descriptionRef ? descriptions[rel.descriptionRef] : undefined) ?? rel.description;
            if (!desc) return;
            tips.set(rel, { id: `rel:${rel.descriptionRef ?? index}`, description: desc });
        });
        return tips;
    }, [relations, descriptions]);

    // --- Tooltip items for the export tooltip layer ---
    const tooltipItems = useMemo((): InlineTooltipItem[] => {
        const items: InlineTooltipItem[] = [];
        for (const container of containers) {
            const desc = effectiveDescriptions[container.id];
            if (!desc) continue;
            const rect = containerBounds[container.id];
            if (rect) {
                const isOnRight = (rect.x + rect.width / 2) > size.width / 2;
                items.push({ id: container.id, description: desc, x: isOnRight ? rect.x - 320 : rect.x + rect.width, y: rect.y, isOnRight });
            }
        }
        for (const comp of components) {
            const key = comp.alias || comp.name;
            const desc = effectiveDescriptions[key];
            if (!desc) continue;
            const pos = effectivePositions[key];
            if (pos) {
                const compW = estimateNodeWidth(comp.name, comp.members, comp.stereotype);
                const isOnRight = (pos.x + compW / 2) > size.width / 2;
                items.push({ id: key, description: desc, x: isOnRight ? pos.x - 320 : pos.x + compW, y: pos.y, isOnRight });
            }
        }
        for (const rel of relations) {
            const tip = relationTips.get(rel);
            if (!tip) continue;
            const fromPos = effectivePositions[rel.from] || containerBounds[rel.from];
            const toPos = effectivePositions[rel.to] || containerBounds[rel.to];
            if (!fromPos || !toPos) continue;
            const getDims = (key: string) => {
                if (containerBounds[key]) return { w: containerBounds[key].width, h: containerBounds[key].height };
                const comp = components.find(c => (c.alias || c.name) === key);
                return { w: comp ? estimateNodeWidth(comp.name, comp.members, comp.stereotype) : DEFAULT_NODE_WIDTH, h: comp ? getNodeHeight(comp.type, comp.members, comp.name) : DEFAULT_NODE_HEIGHT };
            };
            const { w: fromW, h: fromH } = getDims(rel.from);
            const { w: toW, h: toH } = getDims(rel.to);
            const midX = (fromPos.x + fromW / 2 + toPos.x + toW / 2) / 2;
            const midY = (fromPos.y + fromH / 2 + toPos.y + toH / 2) / 2;
            if (items.some(it => it.id === tip.id)) continue;
            const isOnRight = midX > size.width / 2;
            items.push({ id: tip.id, description: tip.description, x: isOnRight ? midX - 320 : midX, y: midY, isOnRight });
        }
        return items;
    }, [containers, components, relations, effectiveDescriptions, relationTips, containerBounds, effectivePositions, size.width]);

    // --- Editor completion handler ---
    const commitDescription = useCallback(() => {
        if (editorElementId && onDescriptionsRawChange) {
            const trimmed = editorValue.trim();
            const newRaw = patchDescriptionRaw(
                descriptionsRaw || '',
                editorElementId,
                trimmed || undefined,
            );
            onDescriptionsRawChange(newRaw.trim() || undefined);
        }
        setEditorElementId(null);
    }, [editorElementId, editorValue, descriptionsRaw, onDescriptionsRawChange]);

    const handleBackgroundMouseDown = () => {
        if (editorElementId) {
            commitDescription();
        }
    };

    return (
        <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={viewBoxAttr}
            width={size.width}
            height={size.height}
            className={`archdia-svg${isDragging ? ' archdia-dragging' : ''}${editorElementId ? ' archdia-editing' : ''}${theme === 'light' ? ' archdia-theme-light' : ''}`}
            onMouseMove={isDragging ? handleMouseMove : undefined}
            onMouseUp={isDragging ? handleMouseUp : undefined}
            onMouseLeave={isDragging ? handleMouseLeave : undefined}
            onMouseDown={handleBackgroundMouseDown}
        >
            {/* Arrowhead marker definitions */}
            <defs>
                <marker
                    id="archdia-arrowhead-arrow"
                    markerWidth="10"
                    markerHeight="7"
                    refX="10"
                    refY="3.5"
                    orient="auto"
                >
                    <polygon
                        points="0 0, 10 3.5, 0 7"
                        fill="currentColor"
                        className="archdia-arrowhead"
                    />
                </marker>
                <marker
                    id="archdia-arrowhead-triangle"
                    markerWidth="10"
                    markerHeight="10"
                    refX="10"
                    refY="5"
                    orient="auto"
                >
                    <polygon
                        points="0 0, 10 5, 0 10"
                        fill="none"
                        stroke="currentColor"
                        className="archdia-arrowhead"
                    />
                </marker>
                <marker
                    id="archdia-arrowhead-diamond"
                    markerWidth="12"
                    markerHeight="8"
                    refX="12"
                    refY="4"
                    orient="auto"
                >
                    <polygon
                        points="0 4, 6 0, 12 4, 6 8"
                        fill="none"
                        stroke="currentColor"
                        className="archdia-arrowhead"
                    />
                </marker>
                <marker
                    id="archdia-arrowhead-diamond-filled"
                    markerWidth="12"
                    markerHeight="8"
                    refX="12"
                    refY="4"
                    orient="auto"
                >
                    <polygon
                        points="0 4, 6 0, 12 4, 6 8"
                        fill="currentColor"
                        className="archdia-arrowhead"
                    />
                </marker>
            </defs>

            {/* Layer 1: Containers (back) — auto-fitted to children */}
            {containers.map((container) => {
                const rect = containerBounds[container.id];
                if (!rect) return null;

                return (
                    <g
                        key={`container-${container.id}`}
                        className={`archdia-container${container.stereotype ? ` archdia-container-${container.stereotype}` : ''}${isDraggable ? ' archdia-draggable' : ''}${isEditable ? ' archdia-editable' : ''}`}
                        data-archdia-id={effectiveDescriptions[container.id] ? container.id : undefined}
                        onMouseDown={isDraggable || isEditable ? (e) => handleMouseDown(container.id, e) : undefined}
                        onMouseUp={isDraggable || isEditable ? (e) => handleMouseUpElement(container.id, e) : undefined}
                    >
                        <rect
                            x={rect.x}
                            y={rect.y}
                            width={rect.width}
                            height={rect.height}
                            rx={BOX_RX}
                            ry={BOX_RX}
                            className="archdia-container-box"
                        />
                        {container.stereotype && !isStructuralStereotype(container.stereotype) && !isMoscowStereotype(container.stereotype) && (
                            <text
                                x={rect.x + 12}
                                /* Sits above the label baseline (rect.y + 30) with enough
                                   room for the label's ascenders. */
                                y={rect.y + 13}
                                fontSize={CONTAINER_LABEL_FONT_SIZE - 2}
                                fill="currentColor"
                                className="archdia-container-stereotype"
                            >
                                <MultilineText text={`«${container.stereotype}»`} x={rect.x + 12} lineHeight={(CONTAINER_LABEL_FONT_SIZE - 2) * 1.2} />
                            </text>
                        )}
                        {container.stereotype?.toLowerCase() !== 'trust' && (
                        <text
                            x={rect.x + 12}
                            y={rect.y + (container.stereotype && !isStructuralStereotype(container.stereotype) && !isMoscowStereotype(container.stereotype) ? 30 : 18)}
                            fontSize={CONTAINER_LABEL_FONT_SIZE}
                            className="archdia-container-label"
                            fontWeight="bold"
                        >
                            <MultilineText text={container.label} x={rect.x + 12} lineHeight={CONTAINER_LABEL_FONT_SIZE * 1.2} moscowInfo={getMoscowInfo(container.stereotype)} />
                        </text>
                        )}
                    </g>
                );
            })}

            {/* Layer 2: Relations (middle) */}
            {(() => {
                // Relations sharing a pair of elements are fanned out around the straight line
                // between them, whichever way round each is written, so none hides another.
                const groups: Record<string, typeof relations> = {};
                relations.forEach(rel => {
                    const pairKey = [rel.from, rel.to].sort().join('::');
                    if (!groups[pairKey]) groups[pairKey] = [];
                    groups[pairKey].push(rel);
                });

                return Object.values(groups).flatMap(groupRels => groupRels.map((rel, indexInGroup) => {
                    const from = getBox(rel.from);
                    const to = getBox(rel.to);
                    if (!from || !to) return null;

                    const bendKey = bendKeys.get(rel)!;
                    const bend = effectiveBends[bendKey];
                    const geometry = rel.from === rel.to
                        ? computeSelfLoopGeometry(from, indexInGroup, bend)
                        : computeRelationGeometry(
                            from, to,
                            relationFanOffset(from, to, rel.from, rel.to, indexInGroup, groupRels.length),
                            bend,
                        );

                    const relTip = relationTips.get(rel);
                    return (
                        <g
                            key={`rel-${bendKey}`}
                            className={`archdia-relation${onBendsChange ? ' archdia-relation-bendable' : ''}`}
                            style={rel.color ? { color: rel.color } : undefined}
                            data-archdia-id={relTip?.id}
                        >
                            {/* The band a relation is caught by. A curve a pixel wide is not
                                something a pointer can be asked to land on, so one is drawn along
                                every relation, invisible and as wide as a fingertip: it is what
                                answers the hover that lights the relation up and brings out its
                                centre, and what widens the reach of the tooltip it used to be
                                drawn for alone. */}
                            <path d={geometry.d} className="archdia-relation-hit" fill="none" />
                            <path
                                d={geometry.d}
                                className="archdia-relation-line"
                                markerStart={rel.startArrow ? `url(#archdia-arrowhead-${rel.startArrow})` : undefined}
                                markerEnd={rel.endArrow ? `url(#archdia-arrowhead-${rel.endArrow})` : undefined}
                                strokeDasharray={rel.lineStyle === 'dashed' ? '5,5' : undefined}
                                fill="none"
                                style={{
                                    ...(rel.color ? { stroke: rel.color } : {}),
                                    ...(rel.weight ? { strokeWidth: rel.weight } : {}),
                                }}
                            />
                            {rel.label && (
                                <text
                                    x={geometry.labelX}
                                    y={geometry.labelY}
                                    textAnchor="middle"
                                    fontSize={RELATION_LABEL_FONT_SIZE}
                                    className="archdia-relation-label"
                                >
                                    <MultilineText text={rel.label} x={geometry.labelX} lineHeight={RELATION_LABEL_FONT_SIZE * 1.2} centerVertically={true} />
                                </text>
                            )}
                            {onBendsChange && (
                                <circle
                                    cx={geometry.anchor[0]}
                                    cy={geometry.anchor[1]}
                                    r={RELATION_HANDLE_RADIUS}
                                    className={`archdia-relation-handle${drag?.bendKey === bendKey ? ' archdia-relation-handle-held' : ''}`}
                                    data-archdia-bend={bendKey}
                                    onMouseDown={e => handleBendMouseDown(bendKey, e)}
                                    onDoubleClick={() => onBendsChange({ [bendKey]: null })}
                                />
                            )}
                        </g>
                    );
                }));
            })()}

            {/* Layer 3: Components (front) */}
            {components.map((comp) => {
                const key = comp.alias || comp.name;
                const pos = getPos(key);
                if (!pos) return null;

                // A hidden stereotype (structural, MoSCoW) takes no room on the box.
                const hasVisibleStereotype = Boolean(comp.stereotype && !isStructuralStereotype(comp.stereotype) && !isMoscowStereotype(comp.stereotype));
                const w = estimateNodeWidth(comp.name, comp.members, hasVisibleStereotype ? comp.stereotype : undefined);
                const h = getNodeHeight(comp.type, comp.members, comp.name);
                const type = comp.type?.toLowerCase();
                const hasMembers = comp.members && comp.members.length > 0;

                // If this is a class/interface with members, render UML compartments
                if (hasMembers) {
                    return renderClassNode(comp, key, pos, w, h, isDraggable, isEditable, handleMouseDown, handleMouseUpElement, effectiveDescriptions[key]);
                }

                let shape = null;
                const isIconShape = Boolean(type && ['database', 'actor', 'queue', 'cloud', 'storage', 'collections', 'folder', 'artifact', 'boundary', 'control', 'entity'].includes(type));
                const labelYOffset = pos.y + (isIconShape ? SHAPE_HEIGHT + 15 : h / 2 + (hasVisibleStereotype ? 8 : 0));
                const stereotypeYOffset = pos.y + (isIconShape ? SHAPE_HEIGHT + 5 : h / 2 - 8);

                const cx = pos.x + w / 2;

                // Common base class
                const baseClass = isIconShape ? "archdia-component-shape" : "archdia-component-box";

                if (type === 'database') {
                    // Database is a cylinder. Let's make it fixed width (e.g. 50) and centered.
                    const dbW = 50;
                    const dbX = cx - dbW / 2;
                    const cy = pos.y + 6;
                    shape = (
                        <g className="archdia-shape-database">
                            <path d={`M ${dbX} ${pos.y + 12} L ${dbX} ${pos.y + SHAPE_HEIGHT - 6} A ${dbW / 2} 6 0 0 0 ${dbX + dbW} ${pos.y + SHAPE_HEIGHT - 6} L ${dbX + dbW} ${pos.y + 12}`} className={baseClass} />
                            <ellipse cx={cx} cy={pos.y + SHAPE_HEIGHT - 6} rx={dbW / 2} ry="6" className={baseClass} fillOpacity="0" />
                            <ellipse cx={cx} cy={pos.y + 12} rx={dbW / 2} ry="6" className={baseClass} />
                        </g>
                    );
                } else if (type === 'actor') {
                    // Actor is naturally centered because it's drawn relative to cx
                    const actorCy = pos.y + STICK_FIGURE_R + 5;
                    shape = (
                        <g className="archdia-shape-actor">
                            <circle cx={cx} cy={actorCy} r={STICK_FIGURE_R} className={baseClass} />
                            <line x1={cx} y1={actorCy + STICK_FIGURE_R} x2={cx} y2={actorCy + STICK_FIGURE_R + 15} className={baseClass} />
                            <line x1={cx - 12} y1={actorCy + STICK_FIGURE_R + 5} x2={cx + 12} y2={actorCy + STICK_FIGURE_R + 5} className={baseClass} />
                            <line x1={cx} y1={actorCy + STICK_FIGURE_R + 15} x2={cx - 10} y2={actorCy + STICK_FIGURE_R + 25} className={baseClass} />
                            <line x1={cx} y1={actorCy + STICK_FIGURE_R + 15} x2={cx + 10} y2={actorCy + STICK_FIGURE_R + 25} className={baseClass} />
                        </g>
                    );
                } else if (type === 'queue') {
                    const qW = 60;
                    const qX = cx - qW / 2;
                    const qRy = (SHAPE_HEIGHT - 10) / 2;
                    const qY = pos.y + 5;
                    // Closed path: top-left → top-right → arc right cap → bottom-right → bottom-left → arc left cap → close
                    const bodyPath = `M ${qX + QUEUE_RX} ${qY} L ${qX + qW - QUEUE_RX} ${qY} A ${QUEUE_RX} ${qRy} 0 0 1 ${qX + qW - QUEUE_RX} ${qY + qRy * 2} L ${qX + QUEUE_RX} ${qY + qRy * 2} A ${QUEUE_RX} ${qRy} 0 0 1 ${qX + QUEUE_RX} ${qY} Z`;
                    shape = (
                        <g className="archdia-shape-queue">
                            <path d={bodyPath} className={baseClass} />
                            <ellipse cx={qX + QUEUE_RX} cy={qY + qRy} rx={QUEUE_RX} ry={qRy} className={baseClass} fillOpacity="0" />
                            <ellipse cx={qX + qW - QUEUE_RX} cy={qY + qRy} rx={QUEUE_RX} ry={qRy} className={baseClass} fillOpacity="0" />
                        </g>
                    );
                } else if (type === 'cloud') {
                    const cW = 60;
                    const cX = cx - cW / 2;
                    shape = (
                        <g className="archdia-shape-cloud">
                            <path d={`M ${cX + cW * 0.3} ${pos.y + SHAPE_HEIGHT} Q ${cX + cW * 0.1} ${pos.y + SHAPE_HEIGHT} ${cX + cW * 0.1} ${pos.y + SHAPE_HEIGHT * 0.7} Q ${cX} ${pos.y + SHAPE_HEIGHT * 0.4} ${cX + cW * 0.3} ${pos.y + SHAPE_HEIGHT * 0.3} Q ${cX + cW * 0.4} ${pos.y} ${cX + cW * 0.6} ${pos.y + SHAPE_HEIGHT * 0.1} Q ${cX + cW * 0.8} ${pos.y} ${cX + cW * 0.9} ${pos.y + SHAPE_HEIGHT * 0.3} Q ${cX + cW} ${pos.y + SHAPE_HEIGHT * 0.5} ${cX + cW * 0.9} ${pos.y + SHAPE_HEIGHT * 0.8} Q ${cX + cW * 0.8} ${pos.y + SHAPE_HEIGHT} ${cX + cW * 0.7} ${pos.y + SHAPE_HEIGHT} Z`} className={baseClass} />
                        </g>
                    );
                } else if (type === 'storage') {
                    const skew = 10;
                    const sW = 60;
                    const sX = cx - sW / 2;
                    shape = (
                        <g className="archdia-shape-storage">
                            <polygon points={`${sX + skew},${pos.y + 5} ${sX + sW},${pos.y + 5} ${sX + sW - skew},${pos.y + SHAPE_HEIGHT - 5} ${sX},${pos.y + SHAPE_HEIGHT - 5}`} className={baseClass} />
                        </g>
                    );
                } else if (type === 'collections') {
                    const colW = 50;
                    const colX = cx - colW / 2;
                    shape = (
                        <g className="archdia-shape-collections">
                            <rect x={colX + 5} y={pos.y} width={colW - 5} height={SHAPE_HEIGHT - 8} rx={BOX_RX} ry={BOX_RX} className={baseClass} />
                            <rect x={colX} y={pos.y + 8} width={colW - 5} height={SHAPE_HEIGHT - 8} rx={BOX_RX} ry={BOX_RX} className={baseClass} />
                        </g>
                    );
                } else if (type === 'folder') {
                    const fW = 50;
                    const fX = cx - fW / 2;
                    const tabW = 20;
                    shape = (
                        <g className="archdia-shape-folder">
                            <path d={`M ${fX} ${pos.y + 8} L ${fX} ${pos.y + SHAPE_HEIGHT} L ${fX + fW} ${pos.y + SHAPE_HEIGHT} L ${fX + fW} ${pos.y + 8} L ${fX + tabW + 6} ${pos.y + 8} L ${fX + tabW} ${pos.y} L ${fX} ${pos.y} Z`} className={baseClass} />
                        </g>
                    );
                } else if (type === 'artifact') {
                    const aW = 40;
                    const aX = cx - aW / 2;
                    const fold = 10;
                    shape = (
                        <g className="archdia-shape-artifact">
                            <path d={`M ${aX} ${pos.y} L ${aX + aW - fold} ${pos.y} L ${aX + aW} ${pos.y + fold} L ${aX + aW} ${pos.y + SHAPE_HEIGHT} L ${aX} ${pos.y + SHAPE_HEIGHT} Z`} className={baseClass} />
                            <path d={`M ${aX + aW - fold} ${pos.y} L ${aX + aW - fold} ${pos.y + fold} L ${aX + aW} ${pos.y + fold}`} className={baseClass} fillOpacity="0" />
                        </g>
                    );
                } else if (type === 'boundary') {
                    // boundary is naturally centered
                    shape = (
                        <g className="archdia-shape-boundary">
                            <circle cx={cx + 10} cy={pos.y + SHAPE_HEIGHT / 2} r={SHAPE_HEIGHT / 2 - 5} className={baseClass} fillOpacity="0" />
                            <line x1={cx + 10 - (SHAPE_HEIGHT / 2 - 5)} y1={pos.y + SHAPE_HEIGHT / 2} x2={cx - 10} y2={pos.y + SHAPE_HEIGHT / 2} className={baseClass} />
                            <line x1={cx - 10} y1={pos.y + 5} x2={cx - 10} y2={pos.y + SHAPE_HEIGHT - 5} className={baseClass} />
                        </g>
                    );
                } else if (type === 'control') {
                    // control is naturally centered
                    shape = (
                        <g className="archdia-shape-control">
                            <circle cx={cx} cy={pos.y + SHAPE_HEIGHT / 2 + 5} r={SHAPE_HEIGHT / 2 - 10} className={baseClass} />
                            <line x1={cx} y1={pos.y + SHAPE_HEIGHT / 2 - 5} x2={cx} y2={pos.y} className={baseClass} />
                            <polygon points={`${cx},${pos.y - 4} ${cx - 4},${pos.y + 4} ${cx + 4},${pos.y + 4}`} className={baseClass} fill="currentColor" />
                        </g>
                    );
                } else if (type === 'entity') {
                    const eW = 50;
                    const eX = cx - eW / 2;
                    shape = (
                        <g className="archdia-shape-entity">
                            <rect x={eX} y={pos.y + 5} width={eW} height={SHAPE_HEIGHT - 10} rx={BOX_RX} ry={BOX_RX} className={baseClass} />
                            <line x1={eX + 5} y1={pos.y + SHAPE_HEIGHT} x2={eX + eW - 5} y2={pos.y + SHAPE_HEIGHT} className={baseClass} />
                        </g>
                    );
                } else {
                    // Default box for 'component', 'node', 'class', etc...
                    shape = (
                        <rect
                            x={pos.x}
                            y={pos.y}
                            width={w}
                            height={h}
                            rx={BOX_RX}
                            ry={BOX_RX}
                            className={baseClass}
                        />
                    );
                }

                const desc = effectiveDescriptions[key];

                return (
                    <g
                        key={key}
                        className={`archdia-component${comp.external ? ' archdia-component-external' : ''}${comp.stereotype ? ` archdia-component-${comp.stereotype}` : ''}${isDraggable ? ' archdia-draggable' : ''}${isEditable ? ' archdia-editable' : ''}`}
                        data-archdia-id={desc ? key : undefined}
                        onMouseDown={isDraggable || isEditable ? (e) => handleMouseDown(key, e) : undefined}
                        onMouseUp={isDraggable || isEditable ? (e) => handleMouseUpElement(key, e) : undefined}
                    >
                        {/* Invisible background to capture mouse events on the entire component area */}
                        <rect x={pos.x} y={pos.y} width={w} height={h} fill="transparent" />
                        {shape}
                        {hasVisibleStereotype && (
                            <text
                                x={cx}
                                y={stereotypeYOffset}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={COMPONENT_STEREOTYPE_FONT_SIZE}
                                fill="currentColor"
                                className="archdia-component-stereotype"
                            >
                                <MultilineText text={`«${comp.stereotype}»`} x={cx} lineHeight={COMPONENT_STEREOTYPE_FONT_SIZE * 1.2} centerVertically={true} />
                            </text>
                        )}
                        <text
                            x={cx}
                            y={labelYOffset}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={COMPONENT_LABEL_FONT_SIZE}
                            className="archdia-component-label"
                        >
                            <MultilineText text={comp.name} x={cx} lineHeight={COMPONENT_LABEL_FONT_SIZE * 1.2} centerVertically={true} moscowInfo={getMoscowInfo(comp.stereotype)} />
                        </text>
                    </g>
                );
            })}

            {/* Layer 5: Inline tooltip layer — final layer so tooltips are never covered */}
            {tooltipItems.length > 0 && (() => {
                const css = tooltipItems
                    .map(item => `svg:not(.archdia-dragging):not(.archdia-editing):has([data-archdia-id="${cssSafeAttr(item.id)}"]:hover) [data-archdia-tip="${cssSafeAttr(item.id)}"] { display: block; }`)
                    .join('\n');
                return (
                    <>
                        <style>{css}</style>
                        {tooltipItems.map(item => (
                            <foreignObject
                                key={`tooltip-${item.id}`}
                                x={item.x}
                                y={item.y}
                                width={320}
                                height={1}
                                className="archdia-inline-tooltip"
                                data-archdia-tip={item.id}
                                style={{ overflow: 'visible', pointerEvents: 'none' }}
                            >
                                <div style={{ display: 'flex', justifyContent: item.isOnRight ? 'flex-end' : 'flex-start' }}>
                                    <div
                                        className="archdia-tooltip-body"
                                        dangerouslySetInnerHTML={{ __html: markdownToHtml(item.description) }}
                                    />
                                </div>
                            </foreignObject>
                        ))}
                    </>
                );
            })()}

            {/* Layer 7: Floating Editor Overlay */}
            {editorElementId && editorPos && (
                <foreignObject
                    x={editorPos.x}
                    y={editorPos.y}
                    width={320}
                    height={180}
                    style={{ overflow: 'visible' }}
                >
                    <div
                        className="archdia-description-editor-container"
                        onMouseDown={(e) => e.stopPropagation()} // Prevent closing when interacting with editor
                    >
                        <textarea
                            className="archdia-description-editor-textarea"
                            value={editorValue}
                            onChange={(e) => setEditorValue(e.target.value)}
                            onBlur={commitDescription}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    commitDescription();
                                }
                            }}
                            autoFocus
                            placeholder="Add markdown description for tooltip..."
                        />
                    </div>
                </foreignObject>
            )}
        </svg>
    );
};
