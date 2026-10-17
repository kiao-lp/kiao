/**
 * Board placement and arrow geometry in canvas pixels. Persist initial spots once:
 * recomputing them on render would shuffle unplaced cards after additions or drags.
 */

import { spotAt, FlowNodeSpot } from './flowNodeSpot';
import { FlowNodeSuccess } from './flowNodeSuccess';
import { FlowNode } from './boardContent';
import { FlowNodeType } from './flowNodeType';

/** Shared geometry input for flow nodes and node classes. */
export interface PlacedCard {
    id: string;
    spot: FlowNodeSpot | null;
    onSuccess: FlowNodeSuccess;
}

/** Fixed width prevents window or panel changes from moving cards. */
export const CARD_WIDTH = 221;

/** Symbols use a narrower box so arrows land near their shapes. */
export const SYMBOL_WIDTH = 160;

/** Estimates for initial layout and canvas bounds; arrows use measured dimensions. */
export const NOMINAL_CARD_HEIGHT = 108;

export const NOMINAL_EVENT_HEIGHT = 116;
export const NOMINAL_GATEWAY_HEIGHT = 134;

export type SymbolKind = 'rect' | 'event' | 'gateway';

export const symbolKindOf = (type: FlowNodeType): SymbolKind =>
    type === 'gateway' ? 'gateway' : type === 'shutdown' || type === 'scheduler' ? 'event' : 'rect';

export const cardWidthOf = (type: FlowNodeType): number =>
    symbolKindOf(type) === 'rect' ? CARD_WIDTH : SYMBOL_WIDTH;

export const nominalHeightOf = (type: FlowNodeType): number => {
    const kind = symbolKindOf(type);
    return kind === 'gateway' ? NOMINAL_GATEWAY_HEIGHT
        : kind === 'event' ? NOMINAL_EVENT_HEIGHT : NOMINAL_CARD_HEIGHT;
};

/**
 * Shape-row heights must match `.symbolEventWrap` / `.symbolGatewayWrap` in
 * `Hybridflow.module.css`, since arrows target their centres.
 */
export const EVENT_WRAP_HEIGHT = 62;
export const GATEWAY_WRAP_HEIGHT = 80;

/**
 * Shape extents including the ring pixel; must match `.symbolEvent` / `.symbolGateway`
 * in `Hybridflow.module.css` so arrows meet the outlines.
 */
export const EVENT_RADIUS = 28;
export const GATEWAY_HALF = 36;

export const CHAIN_STEP = CARD_WIDTH + 72;

export const ROW_STEP = NOMINAL_CARD_HEIGHT + 56;

export const CANVAS_MARGIN = 8;

/** Pull the arrow back just under its head length so its point touches the border. */
export const ARROW_HEADROOM = 3;

export const CLONE_STEP = 28;

export interface CardBox extends FlowNodeSpot {
    w: number;
    h: number;
}

export interface ArrowEnds {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Follow single-successor chains, heads first in board order. Each card belongs to
 * the first run reaching it. Cycles stop at visited cards; headless rings start at
 * their first card in board order. Missing targets end the run.
 */
export const chainRuns = <T extends PlacedCard>(cards: T[]): T[][] => {
    const byId = new Map(cards.map(card => [card.id, card]));
    const nextOf = (card: T): T | null =>
        (card.onSuccess.flowNode ? byId.get(card.onSuccess.flowNode) ?? null : null);

    const named = new Set(cards.map(card => nextOf(card)?.id).filter((id): id is string => !!id));
    const runs: T[][] = [];
    const seen = new Set<string>();

    const walk = (start: T) => {
        const run: T[] = [];
        for (let card: T | null = start; card && !seen.has(card.id); card = nextOf(card)) {
            seen.add(card.id);
            run.push(card);
        }
        if (run.length) runs.push(run);
    };

    cards.filter(card => !named.has(card.id)).forEach(walk);
    cards.forEach(walk);
    return runs;
};

/**
 * Place only unplaced cards, one row per chain, below existing placements.
 * Read chains among unplaced cards alone so existing arrangements remain untouched.
 */
export const spotsToPlace = <T extends PlacedCard>(cards: T[]): Map<string, FlowNodeSpot> => {
    const waiting = cards.filter(card => !card.spot);
    const spots = new Map<string, FlowNodeSpot>();
    if (waiting.length === 0) return spots;

    const under = cards.reduce((low, card) => (card.spot ? Math.max(low, card.spot.y + ROW_STEP) : low), 0);
    chainRuns(waiting).forEach((run, row) => {
        run.forEach((card, step) => {
            spots.set(card.id, { x: step * CHAIN_STEP, y: under + row * ROW_STEP });
        });
    });
    return spots;
};

/** Lay out chains among pasted cards alone, anchored at the requested paste point. */
export const pasteSpots = (flowNodes: FlowNode[], at: FlowNodeSpot): Map<string, FlowNodeSpot> => {
    const spots = new Map<string, FlowNodeSpot>();
    chainRuns(flowNodes).forEach((run, row) => {
        run.forEach((flowNode, step) => {
            spots.set(flowNode.id, spotAt(at.x + step * CHAIN_STEP, at.y + row * ROW_STEP));
        });
    });
    return spots;
};

/** Intersect the ray from the box centre towards `(x, y)` with its border. */
export const edgeOf = (box: CardBox, x: number, y: number): { x: number; y: number } => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    // The nearer pair of sides is where the ray exits.
    const toSide = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
    const toCap = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
    const reach = Math.min(toSide, toCap);
    return { x: cx + dx * reach, y: cy + dy * reach };
};

/** Rectangle-to-rectangle arrow; see `arrowEndsBetween` for headroom and null cases. */
export const arrowEnds = (from: CardBox, to: CardBox, headroom = 0): ArrowEnds | null =>
    arrowEndsBetween(from, 'rect', to, 'rect', headroom);

/** Target the shape centre, excluding a symbol's label below its shape row. */
export const shapeAnchor = (box: CardBox, kind: SymbolKind): { x: number; y: number } => {
    const x = box.x + box.w / 2;
    if (kind === 'event') return { x, y: box.y + EVENT_WRAP_HEIGHT / 2 };
    if (kind === 'gateway') return { x, y: box.y + GATEWAY_WRAP_HEIGHT / 2 };
    return { x, y: box.y + box.h / 2 };
};

/** Intersect the ray from the ellipse centre towards `(x, y)` with its border. */
export const edgeOfEllipse = (
    cx: number, cy: number, rx: number, ry: number, x: number, y: number,
): { x: number; y: number } => {
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const reach = 1 / Math.hypot(dx / rx, dy / ry);
    return { x: cx + dx * reach, y: cy + dy * reach };
};

/** Intersect the ray from the diamond centre towards `(x, y)` with its border. */
export const edgeOfDiamond = (
    cx: number, cy: number, hx: number, hy: number, x: number, y: number,
): { x: number; y: number } => {
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const reach = 1 / (Math.abs(dx) / hx + Math.abs(dy) / hy);
    return { x: cx + dx * reach, y: cy + dy * reach };
};

export const shapeEdge = (
    box: CardBox, kind: SymbolKind, x: number, y: number,
): { x: number; y: number } => {
    const at = shapeAnchor(box, kind);
    if (kind === 'event') return edgeOfEllipse(at.x, at.y, EVENT_RADIUS, EVENT_RADIUS, x, y);
    if (kind === 'gateway') return edgeOfDiamond(at.x, at.y, GATEWAY_HALF, GATEWAY_HALF, x, y);
    return edgeOf(box, x, y);
};

/**
 * Join shape outlines along their anchors, retracting the head by `headroom`.
 * Symbols connect at their shapes, over their labels. Null for coincident anchors.
 */
export const arrowEndsBetween = (
    from: CardBox, fromKind: SymbolKind, to: CardBox, toKind: SymbolKind, headroom = 0,
): ArrowEnds | null => {
    const startAt = shapeAnchor(from, fromKind);
    const endAt = shapeAnchor(to, toKind);
    if (startAt.x === endAt.x && startAt.y === endAt.y) return null;

    const start = shapeEdge(from, fromKind, endAt.x, endAt.y);
    const end = shapeEdge(to, toKind, startAt.x, startAt.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const span = Math.hypot(dx, dy);
    // Clamp headroom to prevent short arrows from reversing direction.
    const back = span > 0 ? Math.min(headroom, span) / span : 0;
    return { x1: start.x, y1: start.y, x2: end.x - dx * back, y2: end.y - dy * back };
};

/** Normalized selection bounds in canvas pixels, with a top-left origin. */
export interface SelectionRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Return overlapping ids in map order; touching an edge does not select a card. */
export const boxesInRect = (boxes: Map<string, CardBox>, rect: SelectionRect): string[] => {
    const held: string[] = [];
    boxes.forEach((box, id) => {
        const overlaps = box.x < rect.x + rect.w
            && box.x + box.w > rect.x
            && box.y < rect.y + rect.h
            && box.y + box.h > rect.y;
        if (overlaps) held.push(id);
    });
    return held;
};

export const canvasSize = (boxes: CardBox[]): { width: number; height: number } => ({
    width: boxes.reduce((far, box) => Math.max(far, box.x + box.w), 0) + CANVAS_MARGIN,
    height: boxes.reduce((far, box) => Math.max(far, box.y + box.h), 0) + CANVAS_MARGIN,
});
