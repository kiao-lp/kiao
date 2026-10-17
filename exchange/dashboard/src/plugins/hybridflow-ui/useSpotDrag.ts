import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardOf } from './boardDom';
import { edgeScroll } from './boardScroll';

/**
 * Drag-to-place for a board: grab a card anywhere and put it down where
 * you want it. What it writes is the card's spot, and the whole point of the board is that somebody
 * decides where that is.
 *
 * **The card follows the pointer**, which is where this parts company with every other drag in this
 * application. Those all leave the board still and draw a line where the drop would land, because
 * what they are aiming at is a *gap between two things* and the things must not move while it is
 * being aimed at. Here there is nothing to aim between: the drop lands where the card is, so the
 * card has to be where it is going to be — anything else is aiming blind at a foot of empty canvas.
 *
 * So the offset is state and the arrows redraw with it, once a frame. The chains being drawn from
 * the card as it moves are the reason: a card dragged across a board whose arrows only caught up
 * at the drop would be a picture that never showed what the arrangement was going to look like,
 * which is the one question the gesture is asking.
 *
 * **A marked card carries the marked set**, as it does everywhere on this board: the distance is the
 * gesture's, and every card of the set moves by it, so a group arrives in the shape it left in.
 *
 * Nothing is written until the release, and Escape abandons a drag in flight — the same bargain the
 * chain drag makes.
 */

/**
 * Movement, in pixels, that turns a press on the card into a drag rather than a click. Read by
 * the symbol too: a press on its shape that does not travel this far is a Play, not a drag.
 */
export const DRAG_THRESHOLD_PX = 4;

/** How long after a drop a click still belongs to the drag rather than to the card under it. */
const CLICK_AFTER_DROP_MS = 250;

const DRAGGING_BODY_CLASS = 'kiao-reordering';

type PointerHandler = React.PointerEventHandler<HTMLElement>;

/** How far the cards being carried have travelled, in canvas pixels. */
export interface SpotOffset {
    x: number;
    y: number;
}

export interface SpotDragOptions {
    /** Where they went: the distance the gesture travelled, for every card it carried. */
    onMove: (flowNodeIds: string[], dx: number, dy: number) => void;
    /**
     * Which cards this gesture is about — the card it started on, or every marked card where that
     * is one of them. The hook knows nothing of marks: it asks once, when the drag starts.
     */
    aimedAt: (flowNodeId: string) => string[];
    /**
     * The size the board is read at. The pointer travels in screen pixels and the cards sit in
     * canvas ones, so the gesture is measured through this: at half size a card follows the
     * pointer two canvas pixels for one on screen.
     */
    zoom?: number;
}

export interface SpotDrag {
    /** Props for the card itself: the whole of it is the way in. */
    dragProps: (flowNodeId: string) => {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };
    /** How far to draw this card from where the document has it, or null while it is not moving. */
    offsetOf: (flowNodeId: string) => SpotOffset | null;
    /** The card the gesture started on, or null when nothing is being carried. */
    dragging: string | null;
    /** Whether a drag has just ended — the click after the release is its, not the card's. */
    justDragged: () => boolean;
}

interface Press {
    /** The card the press started on — the one the gesture is named by. */
    from: string;
    /** Every card travelling, this one included. */
    carried: string[];
    pointerId: number;
    startX: number;
    startY: number;
    /** The canvas, which scrolls under the drag as it reaches an edge. */
    canvas: Element | null;
    /** Where the canvas was scrolled to when the press began: the drag is in *its* coordinates. */
    scrollLeft: number;
    scrollTop: number;
    /**
     * Where the canvas's box was in the viewport when the press began. The drag is
     * measured in the sheet's coordinates — the pointer's place on it — and the box
     * moving under the gesture moves that place: an outer scroller, a bar opening,
     * anything shifting the canvas on screen counts like its own scroll does.
     */
    rectLeft: number;
    rectTop: number;
}

export const useSpotDrag = ({ onMove, aimedAt, zoom = 1 }: SpotDragOptions): SpotDrag => {
    const [carried, setCarried] = useState<{ from: string; ids: string[] } | null>(null);
    const [offset, setOffset] = useState<SpotOffset>({ x: 0, y: 0 });

    // What the handlers read at pointer time, so a re-render never leaves a live drag writing back
    // into the board as it stood when the gesture started.
    const latest = useRef({ onMove, aimedAt, zoom });
    latest.current = { onMove, aimedAt, zoom };

    const press = useRef<Press | null>(null);
    const pointer = useRef({ x: 0, y: 0 });
    const travel = useRef<SpotOffset>({ x: 0, y: 0 });
    /** Whether the press has become a drag — read at pointer time, where state is a frame behind. */
    const out = useRef(false);
    const frame = useRef(0);
    const droppedAt = useRef(0);

    /** The distance travelled in the sheet's own coordinates: the pointer's place on it now
     *  less its place at the press — the pointer's travel, plus whatever scrolled under it
     *  since, less whatever the canvas's box itself drifted by on screen — through the zoom
     *  the board is read at, every term of it being in screen pixels and the sheet in canvas
     *  ones. */
    const measure = useCallback((): SpotOffset => {
        const pressed = press.current;
        if (!pressed) return { x: 0, y: 0 };
        const canvas = pressed.canvas;
        const scrolled = canvas
            ? { x: canvas.scrollLeft - pressed.scrollLeft, y: canvas.scrollTop - pressed.scrollTop }
            : { x: 0, y: 0 };
        const edge = canvas?.getBoundingClientRect();
        const drifted = edge
            ? { x: edge.left - pressed.rectLeft, y: edge.top - pressed.rectTop }
            : { x: 0, y: 0 };
        const zoom = latest.current.zoom || 1;
        return {
            x: (pointer.current.x - pressed.startX + scrolled.x - drifted.x) / zoom,
            y: (pointer.current.y - pressed.startY + scrolled.y - drifted.y) / zoom,
        };
    }, []);

    /** Once a frame while a card is out: the canvas comes to the pointer, and the card follows it. */
    const follow = useCallback(() => {
        frame.current = 0;
        const pressed = press.current;
        if (!pressed) return;
        const { x, y } = pointer.current;
        edgeScroll(pressed.canvas, 'x', x);
        edgeScroll(pressed.canvas, 'y', y);
        travel.current = measure();
        setOffset(held => (held.x === travel.current.x && held.y === travel.current.y
            ? held
            : travel.current));
        frame.current = requestAnimationFrame(follow);
    }, [measure]);

    const endDrag = useCallback(() => {
        press.current = null;
        travel.current = { x: 0, y: 0 };
        out.current = false;
        if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        }
        setCarried(null);
        setOffset({ x: 0, y: 0 });
    }, []);

    // The cursor is the board's while a card is out, as it is for every other drag here.
    useEffect(() => {
        if (!carried) return undefined;
        document.body.classList.add(DRAGGING_BODY_CLASS);
        return () => document.body.classList.remove(DRAGGING_BODY_CLASS);
    }, [carried]);

    // A drag in flight is a modal gesture: Escape puts the card back, nothing having been written.
    useEffect(() => {
        if (!carried) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                endDrag();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [carried, endDrag]);

    // A view unmounted mid-drag would otherwise leave a frame loop running for good.
    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

    const handlers = useMemo(() => {
        const start = (flowNodeId: string) => (event: React.PointerEvent<HTMLElement>) => {
            // A press from a portal reaches this handler by bubbling through the React tree while
            // its target stands outside this handle in the DOM. Answering it would capture the
            // pointer and swallow the click the portal is about — the box-select learned this
            // first, on every item of every card menu.
            const target = event.target as Node | null;
            if (!target || !event.currentTarget.contains(target)) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            // The canvas itself, asked of the document rather than found by looking for something
            // that happens to scroll right now: the sheet grows as a card is dragged past its edge,
            // so a board with nowhere to scroll at the press has somewhere by the release.
            const canvas = boardOf(event.currentTarget);
            const edge = canvas?.getBoundingClientRect();
            press.current = {
                from: flowNodeId,
                carried: latest.current.aimedAt(flowNodeId),
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
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
            if (out.current) return;

            // A press that does not travel is a click on the card, and a click is not a drag.
            const gone = Math.max(
                Math.abs(event.clientX - pressed.startX),
                Math.abs(event.clientY - pressed.startY),
            );
            if (gone < DRAG_THRESHOLD_PX) return;
            out.current = true;
            setCarried({ from: pressed.from, ids: pressed.carried });
            travel.current = measure();
            setOffset(travel.current);
            frame.current = requestAnimationFrame(follow);
        };

        const up = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            // Read here rather than taken from the last frame: a card let go within a frame of
            // arriving somewhere is a card let go there.
            const gone = measure();
            const moved = out.current && (gone.x !== 0 || gone.y !== 0);
            const going = pressed.carried;
            endDrag();
            if (!moved) return;
            droppedAt.current = Date.now();
            latest.current.onMove(going, gone.x, gone.y);
        };

        return { start, move, up };
    }, [endDrag, follow, measure]);

    const dragProps = useCallback((flowNodeId: string) => ({
        onPointerDown: handlers.start(flowNodeId),
        onPointerMove: handlers.move,
        onPointerUp: handlers.up,
        onPointerCancel: () => endDrag(),
        // Capture can be lost to something other than the release — a removed node, a system
        // gesture. Whatever the reason, the card goes back and nothing is written.
        onLostPointerCapture: () => { if (press.current) endDrag(); },
    }), [handlers, endDrag]);

    const held = useMemo(() => new Set(carried?.ids ?? []), [carried]);

    const offsetOf = useCallback(
        (flowNodeId: string): SpotOffset | null => (held.has(flowNodeId) ? offset : null),
        [held, offset],
    );

    const justDragged = useCallback(() => Date.now() - droppedAt.current < CLICK_AFTER_DROP_MS, []);

    return { dragProps, offsetOf, dragging: carried?.from ?? null, justDragged };
};
