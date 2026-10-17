import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boxesInRect, CardBox, SelectionRect } from './boardSpots';
import { edgeScroll } from './boardScroll';

/**
 * Box selection for a board: press on the empty canvas and pull, and every card the box
 * overlaps is picked out — cards and classes alike. What it writes is the marked set, live,
 * as the box moves: the cards light up under the gesture rather than when it is let go.
 *
 * **A press on a card is not this gesture.** The whole card is the move's handle, so a press
 * that starts inside one belongs to the drag that carries it (`useSpotDrag`) or to the click
 * that opens it — the box answers only where no card is. And a press that does not travel is
 * the click on the empty canvas that clears the selection, which is the canvas's own answer to
 * it: the box starts where that click ends.
 *
 * **With Ctrl held — Cmd beside it, which is the same gesture on a Mac — the box adds** to
 * the cards already picked out instead of replacing them. What that means while the box
 * shrinks back is worth saying: the cards the box stops covering are unpicked again, but the
 * ones picked out before the gesture started stay picked — the gesture's own additions are
 * what it is about, and the set it found is left alone.
 *
 * Nothing is *decided* until the release, but everything is *shown* before it: the marks move
 * with the box, so Escape abandons the gesture by putting the set back the way it found it —
 * the same bargain the other two drags make, which write nothing until the release and drop
 * everything on Escape.
 */

/** Movement, in pixels, that turns a press on the canvas into a box rather than a click. */
const BOX_THRESHOLD_PX = 4;

/** How long after a box is let go a click still belongs to it rather than to the canvas under it. */
const CLICK_AFTER_BOX_MS = 250;

type PointerHandler = React.PointerEventHandler<HTMLElement>;

export interface BoxSelectOptions {
    /**
     * Where every card on screen is, in the sheet's own coordinates — what the box is read
     * against. Cards the filter is holding back are simply not in it, so a box never picks
     * a card it never showed.
     */
    boxes: Map<string, CardBox>;
    /**
     * The size the board is read at. The pointer travels in screen pixels and the cards sit in
     * canvas ones, so the gesture is measured through this.
     */
    zoom?: number;
    /** The box has started: whether it adds to the set it found, read off the press. */
    onStart: (additive: boolean) => void;
    /** The cards the box covers right now, in board order — called live, as the box moves. */
    onChange: (flowNodeIds: string[]) => void;
    /** The gesture was abandoned — Escape, or the pointer taken away: put the set back. */
    onCancel: () => void;
}

export interface BoxSelect {
    /** Props for the canvas itself: the empty canvas is the way in. */
    boxProps: {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };
    /** The box as it is being drawn now, in the sheet's coordinates — or null while none is. */
    rect: SelectionRect | null;
    /** Whether a box is out — read where a re-render is not wanted. */
    selecting: boolean;
    /** Whether a box has just ended — the click after the release is its, not the canvas's. */
    justSelected: () => boolean;
}

interface Press {
    pointerId: number;
    startX: number;
    startY: number;
    /** Whether the press carried Ctrl — or Cmd, which is the same gesture on a Mac. */
    additive: boolean;
    /** The canvas, which scrolls under the box as it reaches an edge. */
    canvas: Element | null;
    /** Where the canvas was scrolled to when the press began. */
    scrollLeft: number;
    scrollTop: number;
    /** Where the canvas's box was in the viewport when the press began. */
    rectLeft: number;
    rectTop: number;
}

/** Whether the press started inside a card — the move's handle, or the click that opens it. */
const onCard = (target: EventTarget | null): boolean =>
    (target as Element | null)?.closest?.('[data-flow-node-id],[data-flow-node]') != null;

/**
 * Whether the press started inside a workflow's rectangle — which is the workflow's own
 * handle, like a card's: a pull there carries the rectangle's members, not a box. Starting
 * outside a rectangle and pulling over it still takes the members the box covers.
 */
const onWorkflow = (target: EventTarget | null): boolean =>
    (target as Element | null)?.closest?.('[data-workflow-id]') != null;

/** The same list twice is no change: the marks are not rewritten for a box that takes the same. */
const sameIds = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((id, rank) => id === right[rank]);

export const useBoxSelect = ({ boxes, zoom = 1, onStart, onChange, onCancel }: BoxSelectOptions): BoxSelect => {
    const [rect, setRect] = useState<SelectionRect | null>(null);

    // What the handlers read at pointer time, so a re-render never leaves a live box reading
    // the board as it stood when the gesture started.
    const latest = useRef({ boxes, zoom, onStart, onChange, onCancel });
    latest.current = { boxes, zoom, onStart, onChange, onCancel };

    const press = useRef<Press | null>(null);
    const pointer = useRef({ x: 0, y: 0 });
    /** Whether the press has become a box — read at pointer time, where state is a frame behind. */
    const out = useRef(false);
    /** The cards last reported, so a box taking the same ones twice writes once. */
    const sent = useRef<string[] | null>(null);
    const frame = useRef(0);
    const droppedAt = useRef(0);

    /**
     * The box as it reads now: the press's corner, fixed in the sheet's coordinates, and the
     * pointer's place on it — through the zoom the board is read at, counting whatever
     * scrolled under the gesture or shifted its box on screen, the way the card drag does.
     */
    const measure = useCallback((): SelectionRect | null => {
        const pressed = press.current;
        if (!pressed) return null;
        const canvas = pressed.canvas;
        const edge = canvas?.getBoundingClientRect();
        const current = latest.current.zoom || 1;
        const fromX = (pressed.startX - pressed.rectLeft + pressed.scrollLeft) / current;
        const fromY = (pressed.startY - pressed.rectTop + pressed.scrollTop) / current;
        const toX = (pointer.current.x - (edge?.left ?? pressed.rectLeft)
            + (canvas?.scrollLeft ?? pressed.scrollLeft)) / current;
        const toY = (pointer.current.y - (edge?.top ?? pressed.rectTop)
            + (canvas?.scrollTop ?? pressed.scrollTop)) / current;
        return {
            x: Math.min(fromX, toX),
            y: Math.min(fromY, toY),
            w: Math.abs(toX - fromX),
            h: Math.abs(toY - fromY),
        };
    }, []);

    /** Reports the cards the box covers — once per set, however many frames take it. */
    const emit = useCallback((measured: SelectionRect | null) => {
        const ids = measured ? boxesInRect(latest.current.boxes, measured) : [];
        if (sent.current && sameIds(sent.current, ids)) return;
        sent.current = ids;
        latest.current.onChange(ids);
    }, []);

    /** Once a frame while a box is out: the canvas comes to the pointer, and the box follows it. */
    const follow = useCallback(() => {
        frame.current = 0;
        const pressed = press.current;
        if (!pressed || !out.current) return;
        const { x, y } = pointer.current;
        edgeScroll(pressed.canvas, 'x', x);
        edgeScroll(pressed.canvas, 'y', y);
        const measured = measure();
        setRect(measured);
        emit(measured);
        frame.current = requestAnimationFrame(follow);
    }, [emit, measure]);

    const endBox = useCallback(() => {
        press.current = null;
        out.current = false;
        sent.current = null;
        if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        }
        setRect(null);
    }, []);

    // A box in flight is a modal gesture: Escape abandons it, and the set goes back the way
    // the gesture found it — the marks moved with the box, so dropping the box alone would
    // leave a selection the gesture never meant. In the capture phase, ahead of the card under
    // the focus: its own Escape gives the marks back, which is the opposite of putting them back.
    const selecting = rect !== null;
    useEffect(() => {
        if (!selecting) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                endBox();
                latest.current.onCancel();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [selecting, endBox]);

    // A view unmounted mid-gesture would otherwise leave a frame loop running for good.
    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

    const handlers = useMemo(() => {
        const start = (event: React.PointerEvent<HTMLElement>) => {
            // A press from a portal — a card's menu, open over the canvas — reaches this handler
            // by bubbling through the React tree while its target stands outside the canvas in
            // the DOM. Answering it would capture the pointer and swallow the click the portal
            // is about, which is every item of every card menu going dead without an error.
            const target = event.target as Node | null;
            if (!target || !event.currentTarget.contains(target)) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            // A card answers its own presses — the drag that carries it, the click that opens
            // it — and a rectangle answers its own the way a card does. The box is what the
            // canvas answers everywhere else.
            if (onCard(event.target) || onWorkflow(event.target)) return;
            const canvas = event.currentTarget;
            const edge = canvas?.getBoundingClientRect();
            press.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                additive: event.ctrlKey || event.metaKey,
                canvas,
                scrollLeft: canvas?.scrollLeft ?? 0,
                scrollTop: canvas?.scrollTop ?? 0,
                rectLeft: edge?.left ?? 0,
                rectTop: edge?.top ?? 0,
            };
            pointer.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture?.(event.pointerId);
        };

        const move = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            // A press that does not travel is a click on the canvas, and a click is not a box.
            if (!out.current) {
                const gone = Math.max(
                    Math.abs(event.clientX - pressed.startX),
                    Math.abs(event.clientY - pressed.startY),
                );
                if (gone < BOX_THRESHOLD_PX) return;
                out.current = true;
                latest.current.onStart(pressed.additive);
                frame.current = requestAnimationFrame(follow);
            }
            // Read here rather than waiting for the frame: the marks move with the box, and a
            // box held still after arriving somewhere is a box that covers it now.
            const measured = measure();
            setRect(measured);
            emit(measured);
        };

        const up = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            const drawn = out.current;
            if (!drawn) {
                endBox();
                return;
            }
            // Read here rather than taken from the last frame: a box let go within a frame of
            // arriving somewhere is a box let go there. Reported before the gesture ends, while
            // the last live report is still held for the dedupe.
            emit(measure());
            droppedAt.current = Date.now();
            endBox();
        };

        return { start, move, up };
    }, [emit, endBox, follow, measure]);

    const boxProps = useMemo(() => ({
        onPointerDown: handlers.start,
        onPointerMove: handlers.move,
        onPointerUp: handlers.up,
        // The pointer taken away mid-gesture — a system gesture, a removed node. The box goes
        // back the way Escape takes it: a gesture that never finished leaves no selection.
        onPointerCancel: () => {
            if (!press.current || !out.current) {
                endBox();
                return;
            }
            endBox();
            latest.current.onCancel();
        },
        // Capture can be lost to something other than the release. Whatever the reason, the box
        // is gone and the set goes back — unless the release already ended it, which reads here
        // as no press at all.
        onLostPointerCapture: () => {
            if (!press.current) return;
            const drawn = out.current;
            endBox();
            if (drawn) latest.current.onCancel();
        },
    }), [handlers, endBox]);

    const justSelected = useCallback(() => Date.now() - droppedAt.current < CLICK_AFTER_BOX_MS, []);

    return { boxProps, rect, selecting, justSelected };
};
