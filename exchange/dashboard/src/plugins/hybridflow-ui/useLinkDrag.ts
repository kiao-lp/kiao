import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOW_NODE_ID_ATTRIBUTE } from './boardDom';
import { edgeScroll, scrollerOf } from './boardScroll';

/**
 * Drag-to-chain for board cards: pull from a card's knob to another card, and the first flow node hands
 * on to the second when its turn comes back an answer.
 *
 * A chain used to be written only in the flow node panel, by picking a title out of a list of every card
 * on the board — which is a list of strings for something that is a line between two cards. Drawing
 * it is what it is: the pointer leaves the knob, a line follows it, the card it lands on lights up,
 * and the release writes the chain. Dropped on nothing, or back on the card it started from, it
 * writes the absence of one — that is how a chain is taken off without going anywhere near a
 * select.
 *
 * **The card under the pointer is found in the document, not in a register**: every card carries
 * {@link FLOW_NODE_ID_ATTRIBUTE}, and `elementsFromPoint` says which one the pointer is over — read
 * through the relation strokes the chain may cross, which take the pointer where the empty canvas
 * passes it through. A board is a scrolling canvas whose cards move under the pointer as it pans,
 * and asking the document is the one answer that is never out of date.
 *
 * Nothing is written until the release, and Escape abandons a chain in flight — the same bargain
 * the spot drag (`useSpotDrag`) makes, so that a gesture started by mistake costs nothing.
 */

/** Movement, in pixels, that turns a press on the knob into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

type PointerHandler = React.PointerEventHandler<HTMLElement>;

/** The chain being drawn: where it starts, and the card it would land on right now. */
interface Drawn {
    from: string;
    /** The card under the pointer — null over anything else, the source card included. */
    to: string | null;
}

export interface LinkDragOptions {
    /**
     * The chain the release wrote: `from` hands on to `to`, or to nothing at all where the pointer
     * landed on no card or back on the one it started from.
     */
    onLink: (from: string, to: string | null) => void;
}

export interface LinkDrag {
    /** The knob's own handlers: a chain is pulled from here and nowhere else. */
    knobProps: (flowNodeId: string) => {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };
    /** The card a chain is being pulled from, or null when none is. */
    source: string | null;
    /** The card the chain would land on, or null — over nothing, or over the source itself. */
    target: string | null;
    /**
     * The line drawn from the knob to the pointer. Its ends are written straight to the element,
     * once a frame: a line that followed the pointer through React would re-render every card on
     * the board for every pixel it travelled.
     */
    lineRef: (element: SVGLineElement | null) => void;
}

/** The flow node an element sits in, by id, or null where it is in no card at all. */
const flowNodeIdOf = (element: Element | null): string | null =>
    element?.closest(`[${FLOW_NODE_ID_ATTRIBUTE}]`)?.getAttribute(FLOW_NODE_ID_ATTRIBUTE) || null;

/**
 * The flow node the pointer is over, by id — read through the relation strokes, which take the
 * pointer where the empty canvas passes it through (see `BoardCanvas`). The one answer
 * `elementFromPoint` gives is the stroke the chain happens to cross; the stack it stands in
 * still names the card under the pointer.
 */
export const flowNodeUnder = (x: number, y: number): string | null => {
    if (typeof document.elementsFromPoint === 'function') {
        for (const element of document.elementsFromPoint(x, y)) {
            const id = flowNodeIdOf(element);
            if (id) return id;
        }
        return null;
    }
    return flowNodeIdOf(document.elementFromPoint(x, y));
};

export const useLinkDrag = ({ onLink }: LinkDragOptions): LinkDrag => {
    const [drawn, setDrawn] = useState<Drawn | null>(null);
    const drawnRef = useRef<Drawn | null>(null);

    // What the handlers read at pointer time, so a re-render never leaves a live drag calling back
    // into the board as it stood when the gesture started.
    const latest = useRef({ onLink });
    latest.current = { onLink };

    const press = useRef<{
        from: string;
        pointerId: number;
        /** The knob itself: where the line starts, wherever the board has scrolled to since. */
        knob: HTMLElement;
        /** The board, which the drag pans to reach a card that is off-screen. */
        board: Element | null;
        startX: number;
        startY: number;
    } | null>(null);
    const pointer = useRef({ x: 0, y: 0 });
    const frame = useRef(0);
    const line = useRef<SVGLineElement | null>(null);

    const apply = useCallback((next: Drawn | null) => {
        drawnRef.current = next;
        setDrawn(next);
    }, []);

    /** The line's two ends, in the viewport coordinates the overlay is drawn in. */
    const draw = useCallback(() => {
        const element = line.current;
        const knob = press.current?.knob;
        if (!element || !knob) return;
        const box = knob.getBoundingClientRect();
        element.setAttribute('x1', String(box.left + box.width / 2));
        element.setAttribute('y1', String(box.top + box.height / 2));
        element.setAttribute('x2', String(pointer.current.x));
        element.setAttribute('y2', String(pointer.current.y));
    }, []);

    /** Once a frame while a chain is out: the board pans, the target is read, the line follows. */
    const follow = useCallback(() => {
        frame.current = 0;
        const current = drawnRef.current;
        const pressed = press.current;
        if (!current || !pressed) return;

        const { x, y } = pointer.current;
        const under = document.elementFromPoint(x, y);
        edgeScroll(pressed.board, 'x', x);
        // Whatever scrolls under the pointer vertically, found from the pointer itself.
        edgeScroll(scrollerOf(under, 'y'), 'y', y);

        // Through the relation strokes the chain may cross, to the card under the pointer.
        const over = flowNodeUnder(x, y);
        const to = over === pressed.from ? null : over;
        if (to !== current.to) apply({ ...current, to });

        draw();
        frame.current = requestAnimationFrame(follow);
    }, [apply, draw]);

    const endLink = useCallback(() => {
        press.current = null;
        if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        }
        apply(null);
    }, [apply]);

    // A chain in flight is a modal gesture: Escape drops it, and nothing has been written yet.
    useEffect(() => {
        if (!drawn) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                endLink();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [drawn, endLink]);

    // A board unmounted mid-drag would otherwise leave a frame loop running for good.
    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

    const handlers = useMemo(() => {
        const start = (from: string) => (event: React.PointerEvent<HTMLElement>) => {
            // A press from a portal reaches this handler by bubbling through the React tree while
            // its target stands outside this knob in the DOM. Answering it would capture the
            // pointer and swallow the click the portal is about — the box-select learned this
            // first, on every item of every card menu.
            const target = event.target as Node | null;
            if (!target || !event.currentTarget.contains(target)) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            press.current = {
                from,
                pointerId: event.pointerId,
                knob: event.currentTarget,
                board: scrollerOf(event.currentTarget, 'x'),
                startX: event.clientX,
                startY: event.clientY,
            };
            pointer.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture?.(event.pointerId);
        };

        const move = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            if (drawnRef.current) return;

            // A press that does not travel is a press on the knob, and a knob is not a button.
            const travelled = Math.max(Math.abs(event.clientX - pressed.startX), Math.abs(event.clientY - pressed.startY));
            if (travelled < DRAG_THRESHOLD_PX) return;
            apply({ from: pressed.from, to: null });
            frame.current = requestAnimationFrame(follow);
        };

        const up = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            const pulled = drawnRef.current;
            endLink();
            if (!pulled) return;
            // Read here rather than taken from the last frame: a gesture released within a frame of
            // arriving over a card is a gesture that landed on it.
            const over = flowNodeUnder(event.clientX, event.clientY);
            latest.current.onLink(pulled.from, over === pulled.from ? null : over);
        };

        return { start, move, up };
    }, [apply, endLink, follow]);

    const knobProps = useCallback((flowNodeId: string) => ({
        onPointerDown: handlers.start(flowNodeId),
        onPointerMove: handlers.move,
        onPointerUp: handlers.up,
        onPointerCancel: () => endLink(),
        // Capture can be lost to something other than the release — a removed node, a system
        // gesture. Whatever the reason, the chain is dropped and nothing is written.
        onLostPointerCapture: () => { if (press.current) endLink(); },
    }), [handlers, endLink]);

    const lineRef = useCallback((element: SVGLineElement | null) => {
        line.current = element;
        // The overlay is mounted a frame after the drag starts: without this it would show at the
        // origin until the loop came round.
        if (element) draw();
    }, [draw]);

    return { knobProps, source: drawn?.from ?? null, target: drawn?.to ?? null, lineRef };
};
