import { useEffect, useRef, type RefObject } from 'react';

export const clampSurfaceZoom = (zoom: number) => Math.max(0.25, Math.min(2, zoom));

export const stepSurfaceZoom = (zoom: number, direction: -1 | 1) =>
    clampSurfaceZoom(Math.round((zoom + direction * 0.1) * 100) / 100);

export function useWheelZoom(
    ref: RefObject<HTMLDivElement>, zoom: number, onChange?: (zoom: number) => void,
) {
    const current = useRef({ zoom, onChange });
    current.current = { zoom, onChange };

    // The host can attach its ref to a different element when switching views.
    useEffect(() => {
        const element = ref.current;
        if (!element || !current.current.onChange) return;

        const wheel = (event: WheelEvent) => {
            if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || !event.deltaY) return;
            event.preventDefault();
            const previous = current.current.zoom;
            const next = stepSurfaceZoom(previous, event.deltaY > 0 ? -1 : 1);
            if (next === previous) return;
            current.current.zoom = next;
            current.current.onChange?.(next);
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    });
}
