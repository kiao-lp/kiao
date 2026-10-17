import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { indexForSlot, slotAt } from './reorder';

/**
 * Drag-to-reorder for any list of rows: grab the handle, drag, drop where the line shows.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, for two reasons: HTML5 drags are dead on
 * touch screens, and their drop feedback is a browser affair we could not turn into an insertion
 * line. Here the pointer stream is ours from press to release, so mouse, pen and finger all reorder
 * the same way and the line is drawn exactly where the row will land.
 *
 * The list is never reordered mid-drag — the dragged row only dims in place while a line marks the
 * gap it is aimed at. Nothing moves until the drop, so the row you are dragging past never slides
 * out from under the pointer.
 *
 * The handle is a real button, so the same reordering is available from the keyboard: see
 * `handleProps`.
 */

/** Movement, in pixels, that turns a press on the handle into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** How close to the edge of the scrolling area the pointer starts dragging the list along. */
const EDGE_PX = 48;
/** Scroll speed at the very edge, per frame. */
const MAX_SCROLL_STEP_PX = 14;

/** Marks the whole document as being dragged: no text selection, one cursor everywhere. */
const DRAGGING_BODY_CLASS = 'kiao-reordering';

export const ROW_CLASS_DRAGGING = 'kiao-reorder-row-dragging';
export const ROW_CLASS_DROP_BEFORE = 'kiao-reorder-drop-before';
export const ROW_CLASS_DROP_AFTER = 'kiao-reorder-drop-after';

export interface ReorderableOptions {
    /** How many rows the list holds right now. */
    count: number;
    /** Commits a move: the row at `from` becomes the row at `to`. Never called for a no-op. */
    onMove: (from: number, to: number) => void;
    /** Turns the whole thing off — handles stay visible but inert. */
    disabled?: boolean;
}

/** Spread on the row element: a `<tr>`, a `<div>`, an `<li>` — anything with a box. */
export interface ReorderRowProps {
    ref: (element: HTMLElement | null) => void;
    className?: string;
}

/** Spread on `<ReorderHandle>`, which is the only thing that starts a drag. */
export interface ReorderHandleProps {
    disabled: boolean;
    dragging: boolean;
    onPointerDown: React.PointerEventHandler<HTMLElement>;
    onPointerMove: React.PointerEventHandler<HTMLElement>;
    onPointerUp: React.PointerEventHandler<HTMLElement>;
    onPointerCancel: React.PointerEventHandler<HTMLElement>;
    onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLElement>;
}

export interface Reorderable {
    /** Props for row `index`; `className` is merged with the drag/drop state classes. */
    rowProps: (index: number, className?: string) => ReorderRowProps;
    /** Props for the handle of row `index`. */
    handleProps: (index: number) => ReorderHandleProps;
    /** The row being dragged, or `null` when the list is at rest. */
    draggingIndex: number | null;
}

/** The scrolling box the list sits in, so a drag past its edge can scroll it. */
const scrollParentOf = (element: HTMLElement | null): HTMLElement | null => {
    for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY;
        if (/(auto|scroll|overlay)/.test(overflow) && parent.scrollHeight > parent.clientHeight + 1) {
            return parent;
        }
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
};

/** Where a scrolling box shows through, in viewport coordinates. */
const viewportOf = (element: HTMLElement) => {
    if (element === document.documentElement || element === document.body) {
        return { top: 0, bottom: window.innerHeight };
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
};

export const useReorderable = ({ count, onMove, disabled = false }: ReorderableOptions): Reorderable => {
    // Rendering reads the drag from state; the handlers read and write it through the ref, so a
    // pointer move never waits for a render to know where it left off.
    const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
    const dragRef = useRef<{ from: number; slot: number } | null>(null);

    const rows = useRef<(HTMLElement | null)[]>([]);
    const refCallbacks = useRef(new Map<number, (element: HTMLElement | null) => void>());

    // The handlers are created once; everything they need to read at pointer time comes through
    // here, so a re-render never leaves a live drag talking to a stale list.
    const latest = useRef({ count, onMove, disabled });
    latest.current = { count, onMove, disabled };

    const press = useRef<{ from: number; pointerId: number; startY: number } | null>(null);
    const pointerY = useRef(0);
    const scroller = useRef<HTMLElement | null>(null);
    const frame = useRef(0);

    const applyDrag = useCallback((next: { from: number; slot: number } | null) => {
        dragRef.current = next;
        setDrag(next);
    }, []);

    const slotForPointer = useCallback(() => {
        const bounds = rows.current
            .slice(0, latest.current.count)
            .map(element => (element ? element.getBoundingClientRect() : null));
        return slotAt(pointerY.current, bounds);
    }, []);

    const refreshSlot = useCallback(() => {
        const current = dragRef.current;
        if (!current) return;
        const slot = slotForPointer();
        if (slot !== current.slot) applyDrag({ ...current, slot });
    }, [applyDrag, slotForPointer]);

    const autoScroll = useCallback(() => {
        frame.current = 0;
        const box = scroller.current;
        if (!dragRef.current || !box) return;

        const view = viewportOf(box);
        const y = pointerY.current;
        let step = 0;
        if (y < view.top + EDGE_PX) {
            step = -MAX_SCROLL_STEP_PX * Math.min(1, (view.top + EDGE_PX - y) / EDGE_PX);
        } else if (y > view.bottom - EDGE_PX) {
            step = MAX_SCROLL_STEP_PX * Math.min(1, (y - (view.bottom - EDGE_PX)) / EDGE_PX);
        }
        if (step !== 0) {
            box.scrollTop += step;
            refreshSlot();
        }
        frame.current = requestAnimationFrame(autoScroll);
    }, [refreshSlot]);

    const endDrag = useCallback(() => {
        press.current = null;
        scroller.current = null;
        if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        }
        document.body.classList.remove(DRAGGING_BODY_CLASS);
        applyDrag(null);
    }, [applyDrag]);

    // A drag is a modal gesture: Escape abandons it and puts nothing back, since nothing moved yet.
    useEffect(() => {
        if (!drag) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                endDrag();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [drag, endDrag]);

    // A list unmounted mid-drag would otherwise leave the body dragging for good.
    useEffect(() => () => {
        if (frame.current) cancelAnimationFrame(frame.current);
        document.body.classList.remove(DRAGGING_BODY_CLASS);
    }, []);

    const handlers = useMemo(() => ({
        onPointerDown: (index: number) => (event: React.PointerEvent<HTMLElement>) => {
            if (latest.current.disabled || latest.current.count < 2) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const element = event.currentTarget;
            press.current = { from: index, pointerId: event.pointerId, startY: event.clientY };
            pointerY.current = event.clientY;
            element.setPointerCapture?.(event.pointerId);
            // The press belongs to the drag, not to the selection under it — but the handle still
            // has to take focus, or the keyboard alternative would be unreachable by pointer.
            event.preventDefault();
            element.focus?.();
        },

        onPointerMove: () => (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            pointerY.current = event.clientY;

            if (!dragRef.current) {
                if (Math.abs(event.clientY - pressed.startY) < DRAG_THRESHOLD_PX) return;
                document.body.classList.add(DRAGGING_BODY_CLASS);
                scroller.current = scrollParentOf(rows.current[pressed.from] ?? null);
                applyDrag({ from: pressed.from, slot: pressed.from });
                frame.current = requestAnimationFrame(autoScroll);
            }
            refreshSlot();
        },

        onPointerUp: () => (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            const dropped = dragRef.current;
            endDrag();
            if (!dropped) return;
            const to = indexForSlot(dropped.from, dropped.slot);
            if (to !== dropped.from) latest.current.onMove(dropped.from, to);
        },

        onPointerCancel: () => () => endDrag(),

        // Capture can be lost to something other than the release — a removed node, a system
        // gesture. Whatever the reason, the drag is over and nothing was dropped.
        onLostPointerCapture: () => () => {
            if (press.current) endDrag();
        },

        onKeyDown: (index: number) => (event: React.KeyboardEvent<HTMLElement>) => {
            const { count: total, onMove: move, disabled: off } = latest.current;
            if (off) return;
            const to =
                event.key === 'ArrowUp' ? index - 1 :
                event.key === 'ArrowDown' ? index + 1 :
                event.key === 'Home' ? 0 :
                event.key === 'End' ? total - 1 :
                index;
            if (to === index || to < 0 || to >= total) return;
            event.preventDefault();
            move(index, to);
        },
    }), [applyDrag, autoScroll, endDrag, refreshSlot]);

    const refFor = useCallback((index: number) => {
        const existing = refCallbacks.current.get(index);
        if (existing) return existing;
        const callback = (element: HTMLElement | null) => { rows.current[index] = element; };
        refCallbacks.current.set(index, callback);
        return callback;
    }, []);

    const rowProps = useCallback((index: number, className?: string): ReorderRowProps => {
        const classes = className ? [className] : [];
        if (drag) {
            if (drag.from === index) classes.push(ROW_CLASS_DRAGGING);
            if (drag.slot === index) classes.push(ROW_CLASS_DROP_BEFORE);
            else if (drag.slot === count && index === count - 1) classes.push(ROW_CLASS_DROP_AFTER);
        }
        return { ref: refFor(index), className: classes.length > 0 ? classes.join(' ') : undefined };
    }, [count, drag, refFor]);

    const handleProps = useCallback((index: number): ReorderHandleProps => ({
        disabled: disabled || count < 2,
        dragging: drag?.from === index,
        onPointerDown: handlers.onPointerDown(index),
        onPointerMove: handlers.onPointerMove(),
        onPointerUp: handlers.onPointerUp(),
        onPointerCancel: handlers.onPointerCancel(),
        onLostPointerCapture: handlers.onLostPointerCapture(),
        onKeyDown: handlers.onKeyDown(index),
    }), [count, disabled, drag, handlers]);

    return { rowProps, handleProps, draggingIndex: drag?.from ?? null };
};
