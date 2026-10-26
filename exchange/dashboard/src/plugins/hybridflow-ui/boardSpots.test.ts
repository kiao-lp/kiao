import { describe, expect, it } from 'vitest';
import {
    arrowEnds, arrowEndsBetween, boxesInRect, canvasSize, CARD_WIDTH, cardWidthOf, chainRuns,
    CHAIN_STEP, edgeOf, edgeOfDiamond, edgeOfEllipse, nominalHeightOf,
    NOMINAL_CARD_HEIGHT, NOMINAL_EVENT_HEIGHT, NOMINAL_GATEWAY_HEIGHT, pasteSpots, ROW_STEP,
    shapeAnchor, spotsToPlace, symbolKindOf, SYMBOL_WIDTH,
} from './boardSpots';
import { noSuccess } from './flowNodeSuccess';
import { FlowNodeSpot } from './flowNodeSpot';
import { FlowNode } from './boardContent';

/**
 * The geometry of the board: where a card nobody has placed goes, and where the arrow
 * between two chained cards runs. All of it arithmetic, so what the picture of a board looks like
 * is testable without a canvas, a pointer or a browser.
 */

const flowNode = (id: string, over: Partial<FlowNode> = {}): FlowNode => ({
    id,
    title: id,
    type: 'human',
    note: '',
    value: {},
    tags: [],
    body: '',
    criteria: [],
    complexity: null,
    settings: {},
    at: '',
    spot: null,
    status: 'ready',
    archived: false,
    chat: '',
    onSuccess: noSuccess(),
    classVersion: null,
    workflow: '',
    ...over,
});

/** `a → b`, as a card says it: the id of the flow node played next. */
const chained = (id: string, to: string, spot: FlowNodeSpot | null = null): FlowNode =>
    flowNode(id, { spot, onSuccess: { flowNode: to, flowNodes: [], mode: 'end', compact: false } });

describe('reading a board as chains', () => {
    it('runs from a card nothing hands on to, along whatever it hands on to', () => {
        const runs = chainRuns([chained('a', 'b'), flowNode('c'), chained('b', 'd'), flowNode('d')]);
        expect(runs.map(run => run.map(held => held.id))).toEqual([['a', 'b', 'd'], ['c']]);
    });

    it('puts each card in one run — the first that reaches it', () => {
        // Two cards handing on to the same third: the third is read with whichever run got there
        // first, and the second run ends where it meets it.
        const runs = chainRuns([chained('a', 'c'), chained('b', 'c'), flowNode('c')]);
        expect(runs.map(run => run.map(held => held.id))).toEqual([['a', 'c'], ['b']]);
    });

    it('ends a chain that comes back round to a card it has already read', () => {
        const runs = chainRuns([chained('a', 'b'), chained('b', 'a')]);
        expect(runs.map(run => run.map(held => held.id))).toEqual([['a', 'b']]);
    });

    it('ends a chain that names a card the board does not hold', () => {
        const runs = chainRuns([chained('a', 'gone')]);
        expect(runs.map(run => run.map(held => held.id))).toEqual([['a']]);
    });
});

describe('placing the cards that have never been placed', () => {
    it('lays a chain out as a row, left to right along it', () => {
        const spots = spotsToPlace([chained('a', 'b'), flowNode('b'), flowNode('c')]);
        expect(spots.get('a')).toEqual({ x: 0, y: 0 });
        expect(spots.get('b')).toEqual({ x: CHAIN_STEP, y: 0 });
        // A card nothing chains is a run of one, on a row of its own.
        expect(spots.get('c')).toEqual({ x: 0, y: ROW_STEP });
    });

    it('says nothing about a card that already has a place', () => {
        const spots = spotsToPlace([flowNode('a', { spot: { x: 40, y: 40 } }), flowNode('b')]);
        expect(spots.has('a')).toBe(false);
        expect(spots.has('b')).toBe(true);
    });

    // The first card dragged out of the opening layout must not shove the other thirteen aside, and
    // a card made tomorrow must not land on top of somebody's arrangement.
    it('starts the new rows under everything already placed', () => {
        const spots = spotsToPlace([flowNode('a', { spot: { x: 0, y: 400 } }), flowNode('b')]);
        expect(spots.get('b')).toEqual({ x: 0, y: 400 + ROW_STEP });
    });

    it('finds nothing to do on a board where every card has a place', () => {
        expect(spotsToPlace([flowNode('a', { spot: { x: 0, y: 0 } })]).size).toBe(0);
    });
});

describe('laying a pasted block out where it was aimed', () => {
    it('anchors the block at the aim, a row per chain along it', () => {
        const spots = pasteSpots([chained('a', 'b'), flowNode('b'), flowNode('c')], { x: 100, y: 200 });
        expect(spots.get('a')).toEqual({ x: 100, y: 200 });
        expect(spots.get('b')).toEqual({ x: 100 + CHAIN_STEP, y: 200 });
        // A card nothing chains is a run of one, on a row of its own.
        expect(spots.get('c')).toEqual({ x: 100, y: 200 + ROW_STEP });
    });

    it('keeps the block on the canvas side of the origin', () => {
        expect(pasteSpots([flowNode('a')], { x: -30, y: -10 }).get('a')).toEqual({ x: 0, y: 0 });
    });
});

describe('the arrow between two cards', () => {
    const box = (x: number, y: number) => ({ x, y, w: 100, h: 50 });

    it('leaves the side of the card the other one is on', () => {
        // Middles at (50, 25) and (250, 25): due right, so it leaves the right edge and lands on
        // the left one.
        expect(arrowEnds(box(0, 0), box(200, 0))).toEqual({ x1: 100, y1: 25, x2: 200, y2: 25 });
    });

    it('leaves the bottom of a card the chain runs downwards from', () => {
        const ends = arrowEnds(box(0, 0), box(0, 200));
        expect(ends).toEqual({ x1: 50, y1: 50, x2: 50, y2: 200 });
    });

    it('runs backwards as readily as forwards', () => {
        const ends = arrowEnds(box(200, 0), box(0, 0));
        expect(ends).toEqual({ x1: 200, y1: 25, x2: 100, y2: 25 });
    });

    // So the head sits against the border rather than across it.
    it('stops short of the card it points at by the room its head needs', () => {
        expect(arrowEnds(box(0, 0), box(200, 0), 10)).toEqual({ x1: 100, y1: 25, x2: 190, y2: 25 });
    });

    it('is not drawn at all between two cards lying on one another', () => {
        expect(arrowEnds(box(0, 0), box(0, 0))).toBeNull();
    });

    it('never pulls its head back past where it started', () => {
        // Two cards all but touching: the headroom is more than the arrow is long, and an arrow
        // pulled back further than that would point the wrong way.
        const ends = arrowEnds(box(0, 0), box(102, 0), 40);
        expect(ends?.x2).toBeGreaterThanOrEqual(ends?.x1 ?? 0);
    });

    it('leaves a card through the corner where the other one is diagonal to it', () => {
        // Square box, the other one square on the diagonal: the ray leaves at the corner exactly.
        expect(edgeOf({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000)).toEqual({ x: 100, y: 100 });
    });
});

describe('the shapes the nodes are drawn as', () => {
    it('draws work as cards and the rest as BPMN symbols', () => {
        expect([symbolKindOf('ai'), symbolKindOf('human')]).toEqual(['rect', 'rect']);
        expect([symbolKindOf('shutdown'), symbolKindOf('scheduler')]).toEqual(['event', 'event']);
        expect(symbolKindOf('gateway')).toBe('gateway');
    });

    it('draws a symbol narrower than a card', () => {
        expect(cardWidthOf('ai')).toBe(CARD_WIDTH);
        expect(cardWidthOf('scheduler')).toBe(SYMBOL_WIDTH);
        expect(cardWidthOf('gateway')).toBe(SYMBOL_WIDTH);
        expect(SYMBOL_WIDTH).toBeLessThan(CARD_WIDTH);
    });

    it('takes each shape to be its own height before it has been measured', () => {
        expect(nominalHeightOf('human')).toBe(NOMINAL_CARD_HEIGHT);
        expect(nominalHeightOf('shutdown')).toBe(NOMINAL_EVENT_HEIGHT);
        expect(nominalHeightOf('gateway')).toBe(NOMINAL_GATEWAY_HEIGHT);
    });
});

describe('the arrow between two symbols', () => {
    // Two event boxes side by side: the shape row is 62 tall, so the middles it joins are at
    // y = 8 + 31.
    const eventAt = (x: number) => ({ x, y: 8, w: SYMBOL_WIDTH, h: NOMINAL_EVENT_HEIGHT });

    /** An arrow's ends within a hair: the ray crossings are quotients, never exact. */
    const expectEnds = (
        ends: { x1: number; y1: number; x2: number; y2: number } | null,
        x1: number, y1: number, x2: number, y2: number,
    ) => {
        expect(ends?.x1).toBeCloseTo(x1, 5);
        expect(ends?.y1).toBeCloseTo(y1, 5);
        expect(ends?.x2).toBeCloseTo(x2, 5);
        expect(ends?.y2).toBeCloseTo(y2, 5);
    };

    it('aims at the shape’s middle rather than the label’s', () => {
        expect(shapeAnchor(eventAt(8), 'event')).toEqual({ x: 88, y: 39 });
        expect(shapeAnchor({ x: 8, y: 8, w: SYMBOL_WIDTH, h: 134 }, 'gateway')).toEqual({ x: 88, y: 48 });
        // A card is still joined at its own middle.
        expect(shapeAnchor({ x: 0, y: 0, w: 100, h: 50 }, 'rect')).toEqual({ x: 50, y: 25 });
    });

    it('leaves an event’s circle where the ray crosses it', () => {
        expect(edgeOfEllipse(0, 0, 10, 10, 100, 0)).toEqual({ x: 10, y: 0 });
        expect(edgeOfEllipse(0, 0, 10, 10, 0, 50)).toEqual({ x: 0, y: 10 });
        // Square on the diagonal: the ray crosses at (10/√2, 10/√2).
        const at = edgeOfEllipse(0, 0, 10, 10, 100, 100);
        expect(at.x).toBeCloseTo(7.07, 2);
        expect(at.y).toBeCloseTo(7.07, 2);
    });

    it('leaves a gateway’s diamond where the ray crosses it', () => {
        expect(edgeOfDiamond(0, 0, 10, 10, 100, 0)).toEqual({ x: 10, y: 0 });
        expect(edgeOfDiamond(0, 0, 10, 10, 0, 50)).toEqual({ x: 0, y: 10 });
        // Square on the diagonal: the ray crosses halfway to the corner, at (5, 5) — where the
        // rectangle’s own edge would have said (10, 10), half the shape wide of it.
        expect(edgeOfDiamond(0, 0, 10, 10, 100, 100)).toEqual({ x: 5, y: 5 });
    });

    it('runs shape to shape between two events side by side', () => {
        // Anchors at (88, 39) and (380, 39): due right, so it leaves the circle at 88 + 28 and
        // lands on the other at 380 − 28, held 3 short for its head.
        expectEnds(arrowEndsBetween(eventAt(8), 'event', eventAt(300), 'event', 3), 116, 39, 349, 39);
    });

    it('runs point to point between two gateways side by side', () => {
        const box = (x: number) => ({ x, y: 8, w: SYMBOL_WIDTH, h: NOMINAL_GATEWAY_HEIGHT });
        // Anchors at (88, 48) and (380, 48): it leaves the diamond’s right point and lands on
        // the other’s left one, held 3 short for its head.
        expectEnds(arrowEndsBetween(box(8), 'gateway', box(300), 'gateway', 3), 124, 48, 341, 48);
    });

    it('leaves a card’s edge aimed at a symbol’s shape middle', () => {
        // The card’s middle and the circle’s middle on one line: the card is joined where it
        // always was, and the circle where the ray crosses it.
        expectEnds(arrowEndsBetween(
            { x: 0, y: 0, w: 100, h: 50 }, 'rect',
            { x: 300, y: -6, w: SYMBOL_WIDTH, h: NOMINAL_EVENT_HEIGHT }, 'event', 3,
        ), 100, 25, 349, 25);
    });

    it('is not drawn at all where the two anchors coincide', () => {
        expect(arrowEndsBetween(eventAt(8), 'event', eventAt(8), 'event')).toBeNull();
    });
});

describe('how big the canvas has to be', () => {
    it('reaches past the furthest edge of the furthest card', () => {
        const size = canvasSize([
            { x: 0, y: 0, w: CARD_WIDTH, h: NOMINAL_CARD_HEIGHT },
            { x: 500, y: 300, w: CARD_WIDTH, h: NOMINAL_CARD_HEIGHT },
        ]);
        expect(size.width).toBeGreaterThan(500 + CARD_WIDTH);
        expect(size.height).toBeGreaterThan(300 + NOMINAL_CARD_HEIGHT);
    });
});

describe('the cards a box picks out', () => {
    const boxes = new Map([
        ['left', { x: 0, y: 0, w: 100, h: 100 }],
        ['right', { x: 200, y: 0, w: 100, h: 100 }],
        ['below', { x: 0, y: 200, w: 100, h: 100 }],
    ]);

    it('takes every card it overlaps, in board order', () => {
        expect(boxesInRect(boxes, { x: 0, y: 0, w: 500, h: 500 })).toEqual(['left', 'right', 'below']);
    });

    it('takes a card it only partly covers', () => {
        // Over the left card's right half alone: a box need not swallow a card to take it.
        expect(boxesInRect(boxes, { x: 50, y: 50, w: 60, h: 60 })).toEqual(['left']);
    });

    it('takes no card where it covers none', () => {
        expect(boxesInRect(boxes, { x: 120, y: 120, w: 60, h: 60 })).toEqual([]);
    });

    it('leaves a card it merely touches at an edge', () => {
        // Up to the left card's right edge exactly: a box aimed at the gap takes neither side.
        expect(boxesInRect(boxes, { x: 100, y: 0, w: 100, h: 100 })).toEqual([]);
    });
});
