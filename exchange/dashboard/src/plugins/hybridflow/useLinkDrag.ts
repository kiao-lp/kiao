import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOW_NODE_ID_ATTRIBUTE } from './boardDom';
import { edgeScroll, scrollerOf } from './boardScroll';

/** Drag-to-chain for board cards: pull from a card's knob to another card, and the first flow node. */

/** Movement, in pixels, that turns a press on the knob into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

type PointerHandler = React.PointerEventHandler<HTMLElement>;

/** The chain being drawn: where it starts, and the card it would land on right now. */
interface Drawn {
    from: string;

    to: string | null;
}

export interface LinkDragOptions {
    canLink?: (from: string, to: string) => boolean;

    onLink: (from: string, to: string | null) => void;
}

export interface LinkDrag {

    knobProps: (flowNodeId: string) => {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };

    source: string | null;

    target: string | null;

    lineRef: (element: SVGLineElement | null) => void;
}

/** The flow node an element sits in, by id, or null where it is in no card at all. */
const flowNodeIdOf = (element: Element | null): string | null =>
    element?.closest(`[${FLOW_NODE_ID_ATTRIBUTE}]`)?.getAttribute(FLOW_NODE_ID_ATTRIBUTE) || null;

/** The flow node the pointer is over, by id — read through the relation strokes, which take. */
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

export const useLinkDrag = ({ onLink, canLink }: LinkDragOptions): LinkDrag => {
    const [drawn, setDrawn] = useState<Drawn | null>(null);
    const drawnRef = useRef<Drawn | null>(null);

    // What the handlers read at pointer time, so a re-render never leaves a live drag calling back into the board as it stood.
    const latest = useRef({ onLink, canLink });
    latest.current = { onLink, canLink };

    const press = useRef<{
        from: string;
        pointerId: number;

        knob: HTMLElement;

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


    const follow = useCallback(() => {
        frame.current = 0;
        const current = drawnRef.current;
        const pressed = press.current;
        if (!current || !pressed) return;

        const { x, y } = pointer.current;
        const under = document.elementFromPoint(x, y);
        edgeScroll(pressed.board, 'x', x);

        edgeScroll(scrollerOf(under, 'y'), 'y', y);

        const over = flowNodeUnder(x, y);
        const to = over === pressed.from || (over && latest.current.canLink?.(pressed.from, over) === false) ? null : over;
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

            const over = flowNodeUnder(event.clientX, event.clientY);
            if (over && over !== pulled.from && latest.current.canLink?.(pulled.from, over) === false) return;
            latest.current.onLink(pulled.from, over === pulled.from ? null : over);
        };

        return { start, move, up };
    }, [apply, endLink, follow]);

    const knobProps = useCallback((flowNodeId: string) => ({
        onPointerDown: handlers.start(flowNodeId),
        onPointerMove: handlers.move,
        onPointerUp: handlers.up,
        onPointerCancel: () => endLink(),

        onLostPointerCapture: () => { if (press.current) endLink(); },
    }), [handlers, endLink]);

    const lineRef = useCallback((element: SVGLineElement | null) => {
        line.current = element;
        // The overlay is mounted a frame after the drag starts: without this it would show at the origin until the loop came round.
        if (element) draw();
    }, [draw]);

    return { knobProps, source: drawn?.from ?? null, target: drawn?.to ?? null, lineRef };
};
