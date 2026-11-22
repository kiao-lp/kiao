import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardOf } from './boardDom';
import { edgeScroll } from './boardScroll';

/** Drag-to-place for a board: grab a card anywhere and put it down where you want it. */

/** Movement, in pixels, that turns a press on the card into a drag rather than a click. */
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

    onMove: (flowNodeIds: string[], dx: number, dy: number) => void;

    aimedAt: (flowNodeId: string) => string[];
    zoom?: number;
}

export interface SpotDrag {

    dragProps: (flowNodeId: string) => {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };

    offsetOf: (flowNodeId: string) => SpotOffset | null;

    dragging: string | null;

    justDragged: () => boolean;
}

interface Press {

    from: string;
    carried: string[];
    pointerId: number;
    startX: number;
    startY: number;

    canvas: Element | null;

    scrollLeft: number;
    scrollTop: number;

    rectLeft: number;
    rectTop: number;
}

export const useSpotDrag = ({ onMove, aimedAt, zoom = 1 }: SpotDragOptions): SpotDrag => {
    const [carried, setCarried] = useState<{ from: string; ids: string[] } | null>(null);
    const [offset, setOffset] = useState<SpotOffset>({ x: 0, y: 0 });

    // What the handlers read at pointer time, so a re-render never leaves a live drag writing back into the board as it stood.
    const latest = useRef({ onMove, aimedAt, zoom });
    latest.current = { onMove, aimedAt, zoom };

    const press = useRef<Press | null>(null);
    const pointer = useRef({ x: 0, y: 0 });
    const travel = useRef<SpotOffset>({ x: 0, y: 0 });

    const out = useRef(false);
    const frame = useRef(0);
    const droppedAt = useRef(0);


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

    useEffect(() => {
        if (!carried) return undefined;
        document.body.classList.add(DRAGGING_BODY_CLASS);
        return () => document.body.classList.remove(DRAGGING_BODY_CLASS);
    }, [carried]);

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

            const target = event.target as Node | null;
            if (!target || !event.currentTarget.contains(target)) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;

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
