import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
    const focusAfterMove = useRef<{ handle: HTMLElement; to: number } | null>(null);

    const press = useRef<{ from: number; pointerId: number; startY: number } | null>(null);
    const pointerY = useRef(0);
    const scroller = useRef<HTMLElement | null>(null);
    const frame = useRef(0);

    const applyDrag = useCallback((next: { from: number; slot: number } | null) => {
        dragRef.current = next;
        setDrag(next);
    }, []);

    const slotForPointer = useCallback((y: number) => {
        const bounds = rows.current
            .slice(0, count)
            .map(element => (element ? element.getBoundingClientRect() : null));
        return slotAt(y, bounds);
    }, [count]);

    const refreshSlot = useCallback(() => {
        const current = dragRef.current;
        if (!current) return;
        const slot = slotForPointer(pointerY.current);
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
        if (dragRef.current) {
            document.body.classList.remove(DRAGGING_BODY_CLASS);
            applyDrag(null);
        }
    }, [applyDrag]);

    // Positional keys keep the old grip mounted, so follow the moved row after React commits.
    useLayoutEffect(() => {
        const pending = focusAfterMove.current;
        focusAfterMove.current = null;
        if (pending && (document.activeElement === pending.handle || document.activeElement === document.body)) {
            rows.current[pending.to]?.querySelector<HTMLButtonElement>('.kiao-reorder-handle')?.focus();
        }
    });

    useLayoutEffect(endDrag, [count, disabled, endDrag]);

    const moveRow = (from: number, to: number, handle: HTMLElement) => {
        if (disabled || from === to || to < 0 || to >= count) return false;
        if (handle === document.activeElement) focusAfterMove.current = { handle, to };
        onMove(from, to);
        return true;
    };

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
        if (dragRef.current) document.body.classList.remove(DRAGGING_BODY_CLASS);
    }, []);

    const onPointerDown = (index: number, event: React.PointerEvent<HTMLElement>) => {
        if (disabled || count < 2 || press.current || event.isPrimary === false) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const element = event.currentTarget;
        press.current = { from: index, pointerId: event.pointerId, startY: event.clientY };
        pointerY.current = event.clientY;
        element.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        element.focus();
    };

    const onPointerMove: React.PointerEventHandler<HTMLElement> = event => {
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
    };

    const onPointerUp: React.PointerEventHandler<HTMLElement> = event => {
        const pressed = press.current;
        if (!pressed || pressed.pointerId !== event.pointerId) return;
        const to = dragRef.current ? indexForSlot(pressed.from, slotForPointer(event.clientY)) : pressed.from;
        endDrag();
        moveRow(pressed.from, to, event.currentTarget);
    };

    const cancelPointer: React.PointerEventHandler<HTMLElement> = event => {
        if (press.current?.pointerId === event.pointerId) endDrag();
    };

    const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLElement>) => {
        const to =
            event.key === 'ArrowUp' ? index - 1 :
            event.key === 'ArrowDown' ? index + 1 :
            event.key === 'Home' ? 0 :
            event.key === 'End' ? count - 1 :
            index;
        if (moveRow(index, to, event.currentTarget)) {
            event.preventDefault();
            endDrag();
        }
    };

    const refFor = (index: number) => {
        const existing = refCallbacks.current.get(index);
        if (existing) return existing;
        const callback = (element: HTMLElement | null) => { rows.current[index] = element; };
        refCallbacks.current.set(index, callback);
        return callback;
    };

    const rowProps = (index: number, className?: string): ReorderRowProps => {
        const classes = className ? [className] : [];
        if (drag) {
            if (drag.from === index) classes.push(ROW_CLASS_DRAGGING);
            if (drag.slot === index) classes.push(ROW_CLASS_DROP_BEFORE);
            else if (drag.slot === count && index === count - 1) classes.push(ROW_CLASS_DROP_AFTER);
        }
        return { ref: refFor(index), className: classes.length > 0 ? classes.join(' ') : undefined };
    };

    const handleProps = (index: number): ReorderHandleProps => ({
        disabled: disabled || count < 2,
        dragging: drag?.from === index,
        onPointerDown: event => onPointerDown(index, event),
        onPointerMove,
        onPointerUp,
        onPointerCancel: cancelPointer,
        onLostPointerCapture: cancelPointer,
        onKeyDown: event => onKeyDown(index, event),
    });

    return { rowProps, handleProps, draggingIndex: drag?.from ?? null };
};
