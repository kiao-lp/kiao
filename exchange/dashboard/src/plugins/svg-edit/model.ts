/**
 * The shapes an SVG file is edited as, and the pure geometry over them.
 *
 * A shape is one top-level element of the `<svg>` (see `svgDocument.ts` for the two arrows
 * between the file's text and this structure): its tag, its id, and every attribute it carries
 * besides it, kept verbatim so a save only moves what the edit touched. What this module owns
 * is moving and resizing those attributes, and the box each shape covers — the three things
 * the viewport, the box selection and the resize handles all read.
 */

/** The tags the canvas draws and moves. Anything else stays in the file untouched (as `raw`). */
export type SvgShapeTag =
    'rect' | 'circle' | 'ellipse' | 'line' | 'text' |
    'path' | 'polygon' | 'polyline' | 'image' | 'g';

export const SVG_SHAPE_TAGS: SvgShapeTag[] = [
    'rect', 'circle', 'ellipse', 'line', 'text',
    'path', 'polygon', 'polyline', 'image', 'g',
];

export const isShapeTag = (tag: string): tag is SvgShapeTag =>
    (SVG_SHAPE_TAGS as string[]).includes(tag);

export interface SvgShape {
    id: string;
    tag: SvgShapeTag;
    /** Every attribute but `id`, exactly as the file wrote them. */
    attrs: Record<string, string>;
    /** The text a `<text>` holds. */
    text?: string;
    /** The inner XML a `<g>` holds, kept verbatim. */
    inner?: string;
}

/** A top-level node of the `<svg>`: a shape the canvas edits, or XML it carries through. */
export type SvgNode =
    | { kind: 'shape'; shape: SvgShape }
    | { kind: 'raw'; xml: string };

export interface SvgCanvas {
    width: number;
    height: number;
}

export interface SvgDrawing {
    canvas: SvgCanvas;
    nodes: SvgNode[];
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const DEFAULT_CANVAS: SvgCanvas = { width: 800, height: 600 };

/** An empty drawing — what "New SVG image" writes. */
export const emptyDrawing = (): SvgDrawing => ({
    canvas: { ...DEFAULT_CANVAS },
    nodes: [],
});

// === Numbers ===

/** Reads `attrs[name]`, tolerating a unit suffix (`100px`) and falling back when absent. */
export const numAttr = (attrs: Record<string, string>, name: string, fallback: number): number => {
    const raw = attrs[name];
    if (raw === undefined) return fallback;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
};

/** Writes a number the way the file wants it: no `-0`, at most two decimals. */
export const fmt = (n: number): string => {
    const rounded = Math.round(n * 100) / 100;
    return String(Object.is(rounded, -0) ? 0 : rounded);
};

const setNum = (attrs: Record<string, string>, name: string, value: number): Record<string, string> => ({
    ...attrs,
    [name]: fmt(value),
});

// === Boxes ===

const pointsOf = (shape: SvgShape): [number, number][] => {
    const nums = (shape.attrs.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const points: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) points.push([nums[i], nums[i + 1]]);
    }
    return points;
};

const boxOfPoints = (points: [number, number][]): Box | null => {
    if (points.length === 0) return null;
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/**
 * The box a shape covers, read off its attributes alone — no DOM in it, so the box selection
 * and the tests both read this. `null` where attributes say nothing usable: a `<text>` whose
 * size depends on the font, a `<path>` whose `d` is not parsed here, and a `<g>`, whose box
 * is its content's. The viewport measures those three off the DOM instead (see `state.tsx`).
 *
 * A `translate` the shape carries is folded in; any other transform is the file's own and is
 * left for the DOM measurement to cover.
 */
export const bboxOfShape = (shape: SvgShape): Box | null => {
    const { tag, attrs } = shape;
    const [tx, ty] = translateOf(attrs.transform ?? '');
    const shift = (box: Box | null): Box | null =>
        box && (tx !== 0 || ty !== 0) ? { ...box, x: box.x + tx, y: box.y + ty } : box;
    switch (tag) {
        case 'rect':
        case 'image': {
            const w = numAttr(attrs, 'width', 0);
            const h = numAttr(attrs, 'height', 0);
            if (w <= 0 || h <= 0) return null;
            return shift({ x: numAttr(attrs, 'x', 0), y: numAttr(attrs, 'y', 0), width: w, height: h });
        }
        case 'circle': {
            const r = numAttr(attrs, 'r', 0);
            if (r <= 0) return null;
            const cx = numAttr(attrs, 'cx', 0);
            const cy = numAttr(attrs, 'cy', 0);
            return shift({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r });
        }
        case 'ellipse': {
            const rx = numAttr(attrs, 'rx', 0);
            const ry = numAttr(attrs, 'ry', 0);
            if (rx <= 0 || ry <= 0) return null;
            const cx = numAttr(attrs, 'cx', 0);
            const cy = numAttr(attrs, 'cy', 0);
            return shift({ x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry });
        }
        case 'line': {
            const x1 = numAttr(attrs, 'x1', 0);
            const y1 = numAttr(attrs, 'y1', 0);
            const x2 = numAttr(attrs, 'x2', 0);
            const y2 = numAttr(attrs, 'y2', 0);
            return shift(boxOfPoints([[x1, y1], [x2, y2]]));
        }
        case 'polygon':
        case 'polyline':
            return shift(boxOfPoints(pointsOf(shape)));
        default:
            return null;
    }
};

// === Transforms ===

/**
 * The leading `translate(tx, ty?)` of a transform list, or `[0, 0]`. Only the leading one is
 * ever read or folded: a move prepends a translate, so the editor's own sits first and what
 * follows stays the file's.
 */
export const translateOf = (transform: string): [number, number] => {
    const match = /^\s*translate\(\s*([^\s,)]+)(?:[\s,]+([^\s,)]+))?\s*\)/.exec(transform);
    if (!match) return [0, 0];
    const tx = parseFloat(match[1]);
    const ty = match[2] === undefined ? tx : parseFloat(match[2]);
    return [Number.isFinite(tx) ? tx : 0, Number.isFinite(ty) ? ty : 0];
};

/** The transform with its leading translate moved by `(dx, dy)`, the rest untouched. */
export const translatedTransform = (transform: string | undefined, dx: number, dy: number): string => {
    const current = transform ?? '';
    const [tx, ty] = translateOf(current);
    const rest = current.replace(/^\s*translate\(\s*[^\s,)]+(?:[\s,]+[^\s,)]+)?\s*\)\s*/, '');
    const next = `translate(${fmt(tx + dx)}, ${fmt(ty + dy)})`;
    return rest ? `${next} ${rest}` : next;
};

// === Moving ===

/**
 * The shape moved by `(dx, dy)` in SVG units: its own coordinates where it has some, a
 * leading translate where it has none (`path`, `g`). Anything else it carries — its fill,
 * its `rx`, a rotation after the translate — is untouched.
 */
export const movedShape = (shape: SvgShape, dx: number, dy: number): SvgShape => {
    if (dx === 0 && dy === 0) return shape;
    const { tag, attrs } = shape;
    switch (tag) {
        case 'rect':
        case 'text':
        case 'image':
            return {
                ...shape,
                attrs: setNum(setNum(attrs, 'x', numAttr(attrs, 'x', 0) + dx), 'y', numAttr(attrs, 'y', 0) + dy),
            };
        case 'circle':
        case 'ellipse':
            return {
                ...shape,
                attrs: setNum(setNum(attrs, 'cx', numAttr(attrs, 'cx', 0) + dx), 'cy', numAttr(attrs, 'cy', 0) + dy),
            };
        case 'line':
            return {
                ...shape,
                attrs: {
                    ...attrs,
                    x1: fmt(numAttr(attrs, 'x1', 0) + dx),
                    y1: fmt(numAttr(attrs, 'y1', 0) + dy),
                    x2: fmt(numAttr(attrs, 'x2', 0) + dx),
                    y2: fmt(numAttr(attrs, 'y2', 0) + dy),
                },
            };
        case 'polygon':
        case 'polyline': {
            const moved = pointsOf(shape).map(([x, y]) => `${fmt(x + dx)},${fmt(y + dy)}`).join(' ');
            return { ...shape, attrs: { ...attrs, points: moved } };
        }
        default:
            return { ...shape, attrs: { ...attrs, transform: translatedTransform(attrs.transform, dx, dy) } };
    }
};

// === Resizing ===

/** The tags a resize handle is offered for: those whose size lives in attributes. */
export const RESIZABLE_TAGS: SvgShapeTag[] = ['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'image'];

export const isResizable = (shape: SvgShape): boolean => RESIZABLE_TAGS.includes(shape.tag);

/**
 * The shape fitted to `box`, read in SVG units: what a resize handle writes when the pointer
 * says the shape now covers that box. `null` for a tag with no size in its attributes
 * (`text` is sized by its font, `path` and `g` by their content) — those are offered no
 * handle. A degenerate box is clamped to one unit rather than written out inverted.
 */
export const shapeWithBox = (shape: SvgShape, box: Box): SvgShape | null => {
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    const { tag, attrs } = shape;
    switch (tag) {
        case 'rect':
        case 'image':
            return { ...shape, attrs: { ...attrs, x: fmt(box.x), y: fmt(box.y), width: fmt(w), height: fmt(h) } };
        case 'circle': {
            const r = Math.max(1, Math.min(w, h) / 2);
            return {
                ...shape,
                attrs: { ...attrs, cx: fmt(box.x + w / 2), cy: fmt(box.y + h / 2), r: fmt(r) },
            };
        }
        case 'ellipse':
            return {
                ...shape,
                attrs: { ...attrs, cx: fmt(box.x + w / 2), cy: fmt(box.y + h / 2), rx: fmt(w / 2), ry: fmt(h / 2) },
            };
        case 'line':
        case 'polygon':
        case 'polyline': {
            const from = bboxOfShape(shape);
            if (!from || from.width === 0 || from.height === 0) return shape;
            const mapX = (x: number) => box.x + ((x - from.x) / from.width) * w;
            const mapY = (y: number) => box.y + ((y - from.y) / from.height) * h;
            if (tag === 'line') {
                return {
                    ...shape,
                    attrs: {
                        ...attrs,
                        x1: fmt(mapX(numAttr(attrs, 'x1', 0))),
                        y1: fmt(mapY(numAttr(attrs, 'y1', 0))),
                        x2: fmt(mapX(numAttr(attrs, 'x2', 0))),
                        y2: fmt(mapY(numAttr(attrs, 'y2', 0))),
                    },
                };
            }
            const mapped = pointsOf(shape).map(([x, y]) => `${fmt(mapX(x))},${fmt(mapY(y))}`).join(' ');
            return { ...shape, attrs: { ...attrs, points: mapped } };
        }
        default:
            return null;
    }
};

/**
 * The shape grown by `(dw, dh)` about its centre — the wheel's resize and the `rw`/`rn`/`rt`/
 * `rs` commands. A circle grows by the mean of the two, having one radius for both; a line,
 * polygon or polyline is scaled about its box's centre. `null` where `shapeWithBox` is null.
 */
export const grownShape = (shape: SvgShape, dw: number, dh: number): SvgShape | null => {
    const box = bboxOfShape(shape);
    if (!box) return null;
    if (shape.tag === 'circle') {
        const dr = (dw + dh) / 4;
        const r = Math.max(1, numAttr(shape.attrs, 'r', 0) + dr);
        return { ...shape, attrs: { ...shape.attrs, r: fmt(r) } };
    }
    return shapeWithBox(shape, {
        x: box.x - dw / 2,
        y: box.y - dh / 2,
        width: box.width + dw,
        height: box.height + dh,
    });
};

// === Node lists ===

/** The shapes of a node list, in document order — which is also their z-order. */
export const shapesOf = (nodes: SvgNode[]): SvgShape[] =>
    nodes.filter((node): node is { kind: 'shape'; shape: SvgShape } => node.kind === 'shape')
        .map(node => node.shape);

export const shapeById = (nodes: SvgNode[], id: string): SvgShape | undefined =>
    shapesOf(nodes).find(shape => shape.id === id);

export const mapShapes = (nodes: SvgNode[], mapFn: (shape: SvgShape) => SvgShape): SvgNode[] =>
    nodes.map(node => node.kind === 'shape' ? { ...node, shape: mapFn(node.shape) } : node);

export const idsOf = (nodes: SvgNode[]): string[] => shapesOf(nodes).map(shape => shape.id);

/** The nodes without the shapes named — and, with them, their selection nowhere else to prune. */
export const withoutShapes = (nodes: SvgNode[], ids: string[]): SvgNode[] => {
    const doomed = new Set(ids);
    return nodes.filter(node => node.kind !== 'shape' || !doomed.has(node.shape.id));
};

/**
 * The named shapes moved to one end of the document — the end drawn last is on top, so that
 * is front. Relative order within the moved shapes, and within the rest, is kept.
 */
export const restackedShapes = (nodes: SvgNode[], ids: string[], to: 'front' | 'back'): SvgNode[] => {
    const picked = new Set(ids);
    const moved = nodes.filter(node => node.kind === 'shape' && picked.has(node.shape.id));
    const rest = nodes.filter(node => !(node.kind === 'shape' && picked.has(node.shape.id)));
    return to === 'front' ? [...rest, ...moved] : [...moved, ...rest];
};

// === Boxes over boxes ===

export const boxesIntersect = (a: Box, b: Box): boolean =>
    !(a.x > b.x + b.width || a.x + a.width < b.x || a.y > b.y + b.height || a.y + a.height < b.y);

export const boxOfCorners = (a: [number, number], b: [number, number]): Box => ({
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(b[0] - a[0]),
    height: Math.abs(b[1] - a[1]),
});
