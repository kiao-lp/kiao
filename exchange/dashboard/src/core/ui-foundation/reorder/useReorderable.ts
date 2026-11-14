import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { indexForSlot, slotAt } from './reorder';

/** Pointer-event drag for mouse, pen and touch. The list moves only on drop; the handle also works from the keyboard. */

const DRAG_THRESHOLD_PX = 4;
/** Distance from the edge where auto-scroll starts. */
const EDGE_PX = 48;
const MAX_SCROLL_STEP_PX = 14;

/** On `body` during a drag: no selection, one cursor. */
const DRAGGING_BODY_CLASS = 'kiao-reordering';

export const ROW_CLASS_DRAGGING = 'kiao-reorder-row-dragging';
export const ROW_CLASS_DROP_BEFORE = 'kiao-reorder-drop-before';
export const ROW_CLASS_DROP_AFTER = 'kiao-reorder-drop-after';

export interface ReorderableOptions {
    /** Current row count. */
    count: number;
    /** Never called for a no-op. */
    onMove: (from: number, to: number) => void;
    /** Handles stay visible but inert. */
    disabled?: boolean;
}

/** Spread on the row element, e.g. a `<tr>` or `<div>`. */
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
    /** `className` is merged with the drag/drop state classes. */
    rowProps: (index: number, className?: string) => ReorderRowProps;
    handleProps: (index: number) => ReorderHandleProps;
    /** `null` when no drag runs. */
    draggingIndex: number | null;
}

/** The scrolling ancestor a drag past its edge scrolls. */
const scrollParentOf = (element: HTMLElement | null): HTMLElement | null => {
    for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY;
        if (/(auto|scroll|overlay)/.test(overflow) && parent.scrollHeight > parent.clientHeight + 1) {
            return parent;
        }
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
};

/** Visible span in viewport coordinates. */
const viewportOf = (element: HTMLElement) => {
    if (element === document.documentElement || element === document.body) {
        return { top: 0, bottom: window.innerHeight };
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
};

export const useReorderable = ({ count, onMove, disabled = false }: ReorderableOptions): Reorderable => {
    // State drives rendering; the ref drives handlers, so moves do not wait for a render.
    const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
    const dragRef = useRef<{ from: number; slot: number } | null>(null);

    const rows = useRef<(HTMLElement | null)[]>([]);
    const refCallbacks = useRef(new Map<number, (element: HTMLElement | null) => void>());

    // Handlers are created once and read current values through `latest`.
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

    // Escape cancels the drag; nothing has moved yet.
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

    // The body class must not outlive the drag.
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
            // The press takes focus for keyboard use; it does not select text.
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

        // Lost capture ends the drag with no drop.
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
