import React, { useCallback, useRef, useState } from 'react';
import { FlowNodeSize } from './flowNodeSize';
import { FlowNodeSpot, spotAt } from './flowNodeSpot';

/** Dragging one edge of a selected card: width from the sides, height from the top and bottom. */

export type ResizeEdge = 'top' | 'right' | 'bottom' | 'left';

/** What the press starts from: where the card is, and how wide and tall it is drawn. */
export interface ResizeTarget {
    id: string;
    spot: FlowNodeSpot;
    size: FlowNodeSize;
    height: number;
    minWidth: number;
    minHeight: number;
}

type PointerHandler = React.PointerEventHandler<HTMLElement>;

interface Press {
    id: string;
    edge: ResizeEdge;
    pointerId: number;
    startX: number;
    startY: number;
    spot: FlowNodeSpot;
    size: FlowNodeSize;
    height: number;
    minWidth: number;
    minHeight: number;
    zoom: number;
}

interface Held {
    id: string;
    edge: ResizeEdge;
    size: FlowNodeSize;
    spot: FlowNodeSpot;
}

export interface CardResize {

    resizeProps: (target: ResizeTarget, edge: ResizeEdge) => {
        onPointerDown: PointerHandler;
        onPointerMove: PointerHandler;
        onPointerUp: PointerHandler;
        onPointerCancel: PointerHandler;
        onLostPointerCapture: PointerHandler;
    };

    sizeOf: (id: string) => FlowNodeSize | null;
    spotOf: (id: string) => FlowNodeSpot | null;

    resizing: Held | null;
}

export const useCardResize = (
    onResize: (id: string, size: FlowNodeSize, spot: FlowNodeSpot) => void,
    zoom = 1,
): CardResize => {
    const [held, setHeld] = useState<Held | null>(null);
    const press = useRef<Press | null>(null);
    const latest = useRef({ onResize, zoom });
    latest.current = { onResize, zoom };

    const measure = useCallback((event: React.PointerEvent<HTMLElement>): Held | null => {
        const pressed = press.current;
        if (!pressed) return null;
        const dx = (event.clientX - pressed.startX) / (pressed.zoom || 1);
        const dy = (event.clientY - pressed.startY) / (pressed.zoom || 1);

        let width = pressed.size.w;
        let height = pressed.size.h ?? pressed.height;
        let { spot } = pressed;
        if (pressed.edge === 'right') width += dx;
        if (pressed.edge === 'left') width -= dx;
        if (pressed.edge === 'bottom') height += dy;
        if (pressed.edge === 'top') height -= dy;

        width = Math.max(Math.round(width), pressed.minWidth);
        height = Math.max(Math.round(height), pressed.minHeight);
        if (pressed.edge === 'left') {
            spot = spotAt(pressed.spot.x + pressed.size.w - width, spot.y);
        }
        if (pressed.edge === 'top') {
            spot = spotAt(spot.x, pressed.spot.y + pressed.height - height);
        }
        const size: FlowNodeSize = {
            w: width,
            ...(pressed.edge === 'top' || pressed.edge === 'bottom'
                ? { h: height }
                : pressed.size.h === undefined ? {} : { h: pressed.size.h }),
        };
        return { id: pressed.id, edge: pressed.edge, size, spot };
    }, []);

    const endDrag = useCallback(() => {
        press.current = null;
        setHeld(null);
    }, []);

    const resizeProps = useCallback((target: ResizeTarget, edge: ResizeEdge) => {
        const start = (event: React.PointerEvent<HTMLElement>) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            press.current = {
                id: target.id,
                edge,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                spot: target.spot,
                size: target.size,
                height: target.height,
                minWidth: target.minWidth,
                minHeight: target.minHeight,
                zoom: latest.current.zoom,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setHeld({ id: target.id, edge, size: target.size, spot: target.spot });
        };

        const move = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            event.preventDefault();
            const next = measure(event);
            if (next) setHeld(next);
        };

        const up = (event: React.PointerEvent<HTMLElement>) => {
            const pressed = press.current;
            if (!pressed || pressed.pointerId !== event.pointerId) return;
            const next = measure(event);
            const moved = event.clientX !== pressed.startX || event.clientY !== pressed.startY;
            endDrag();
            if (!next || !moved) return;
            const changed = next.size.w !== pressed.size.w || next.size.h !== pressed.size.h
                || next.spot.x !== pressed.spot.x || next.spot.y !== pressed.spot.y;
            if (changed) latest.current.onResize(pressed.id, next.size, next.spot);
        };

        return {
            onPointerDown: start,
            onPointerMove: move,
            onPointerUp: up,
            onPointerCancel: endDrag,
            onLostPointerCapture: () => { if (press.current) endDrag(); },
        };
    }, [endDrag, measure]);

    const sizeOf = useCallback(
        (id: string): FlowNodeSize | null => (held?.id === id ? held.size : null),
        [held],
    );
    const spotOf = useCallback(
        (id: string): FlowNodeSpot | null => (held?.id === id ? held.spot : null),
        [held],
    );

    return { resizeProps, sizeOf, spotOf, resizing: held };
};
