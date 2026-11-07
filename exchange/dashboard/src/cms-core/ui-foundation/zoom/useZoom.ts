import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseZoomOptions {
    /** The host's remembered value, if any. */
    initial?: number;
    /** Lets the host remember the zoom. */
    onChange?: (zoom: number) => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;
const clamp = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Zoom with Ctrl+Wheel. Not persisted here; the host remembers it per file. */
export function useZoom({ initial, onChange }: UseZoomOptions = {}) {
    const [zoom, setZoomInternal] = useState<number>(() => clamp(initial ?? 1.0));

    const canvasRef = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const setZoom = useCallback((newZoom: number) => {
        setZoomInternal(clamp(newZoom));
    }, []);

    const firstRender = useRef(true);
    useEffect(() => {
        // The initial value is not reported back.
        if (firstRender.current) { firstRender.current = false; return; }
        onChangeRef.current?.(zoom);
    }, [zoom]);

    useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const zoomChange = e.deltaY > 0 ? -0.1 : 0.1;
                setZoomInternal(prev => clamp(prev + zoomChange));
            }
        };
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, []);

    return { zoom, setZoom, canvasRef };
}
