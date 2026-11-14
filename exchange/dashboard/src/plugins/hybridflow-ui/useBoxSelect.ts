import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boxesInRect, CardBox, SelectionRect } from './boardSpots';
import { edgeScroll } from './boardScroll';

/** Box selection for a board: press on the empty canvas and pull, and every card the box overlaps is. */

/** Movement, in pixels, that turns a press on the canvas into a box rather than a click. */
const BOX_THRESHOLD_PX = 4;

/** How long after a box is let go a click still belongs to it rather than to the canvas under it. */
const CLICK_AFTER_BOX_MS = 250;

type PointerHandler = React.PointerEventHandler<HTMLElement>;

export interface BoxSelectOptions {

    boxes: Map<string, CardBox>;

    zoom?: number;

    onStart: (additive: boolean) => void;

    onChange: (flowNodeIds: string[]) => void;

    onCancel: () => void;
}

export interface BoxSelect {

    boxProps: {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };

    rect: SelectionRect | null;

    selecting: boolean;

    justSelected: () => boolean;
}

interface Press {
    pointerId: number;
    startX: number;
    startY: number;

    additive: boolean;

    canvas: Element | null;

    scrollLeft: number;
    scrollTop: number;

    rectLeft: number;
    rectTop: number;
}

/** Whether the press started inside a card — the move's handle, or the click that opens it. */
const onCard = (target: EventTarget | null): boolean =>
    (target as Element | null)?.closest?.('[data-flow-node-id],[data-flow-node]') != null;

/** Whether the press started inside a workflow's rectangle — which is the workflow's own handle, like. */
const onWorkflow = (target: EventTarget | null): boolean =>
    (target as Element | null)?.closest?.('[data-workflow-id]') != null;

/** The same list twice is no change: the marks are not rewritten for a box that takes the same. */
const sameIds = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((id, rank) => id === right[rank]);

export const useBoxSelect = ({ boxes, zoom = 1, onStart, onChange, onCancel }: BoxSelectOptions): BoxSelect => {
    const [rect, setRect] = useState<SelectionRect | null>(null);

    // What the handlers read at pointer time, so a re-render never leaves a live box reading the board as it stood when the gesture.
    const latest = useRef({ boxes, zoom, onStart, onChange, onCancel });
    latest.current = { boxes, zoom, onStart, onChange, onCancel };

    const press = useRef<Press | null>(null);
    const pointer = useRef({ x: 0, y: 0 });

    const out = useRef(false);

    const sent = useRef<string[] | null>(null);
    const frame = useRef(0);
    const droppedAt = useRef(0);


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


    const emit = useCallback((measured: SelectionRect | null) => {
        const ids = measured ? boxesInRect(latest.current.boxes, measured) : [];
        if (sent.current && sameIds(sent.current, ids)) return;
        sent.current = ids;
        latest.current.onChange(ids);
    }, []);


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

            const target = event.target as Node | null;
            if (!target || !event.currentTarget.contains(target)) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;

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
        // The box goes back the way Escape takes it: a gesture that never finished leaves no selection.
        onPointerCancel: () => {
            if (!press.current || !out.current) {
                endBox();
                return;
            }
            endBox();
            latest.current.onCancel();
        },

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
