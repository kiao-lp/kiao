import { useCallback, useRef } from 'react';

export interface LongPressHandlers {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
}

export interface LongPressOptions {
    onLongPress: (e: React.PointerEvent) => void;
    durationMs?: number;
    movementTolerancePx?: number;
    enabled?: boolean;
}

export const useLongPress = (opts: LongPressOptions): LongPressHandlers => {
    const { onLongPress, durationMs = 500, movementTolerancePx = 10, enabled = true } = opts;
    const timerRef = useRef<number | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const lastEventRef = useRef<React.PointerEvent | null>(null);

    const cancel = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startRef.current = null;
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!enabled || e.pointerType !== 'touch') return;
        startRef.current = { x: e.clientX, y: e.clientY };
        lastEventRef.current = e;
        timerRef.current = window.setTimeout(() => {
            if (lastEventRef.current) onLongPress(lastEventRef.current);
            timerRef.current = null;
        }, durationMs);
    }, [enabled, onLongPress, durationMs]);

    const onPointerUp = useCallback(() => {
        cancel();
    }, [cancel]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!startRef.current) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) > movementTolerancePx) cancel();
    }, [cancel, movementTolerancePx]);

    const onPointerCancel = useCallback(() => cancel(), [cancel]);

    return { onPointerDown, onPointerUp, onPointerMove, onPointerCancel };
};

export const isCoarsePointer = (): boolean => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
};

export const useIsCoarsePointer = (): boolean => {
    // Static: pointer type rarely changes on a given device.
    return isCoarsePointer();
};

export const dispatchContextMenuAt = (target: EventTarget | null, x: number, y: number) => {
    if (!(target instanceof Element)) return;
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
    });
    target.dispatchEvent(event);
};

export const useLongPressContextMenu = (enabled: boolean): LongPressHandlers => {
    return useLongPress({
        enabled,
        onLongPress: (e) => {
            dispatchContextMenuAt(e.target, e.clientX, e.clientY);
        },
    });
};
