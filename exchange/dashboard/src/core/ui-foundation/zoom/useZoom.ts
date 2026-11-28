import { useState, useCallback, useEffect, useRef } from 'react';
import { clampSurfaceZoom, useWheelZoom } from './surfaceZoom';

export interface UseZoomOptions {
    /** The host's remembered value, if any. */
    initial?: number;
    /** Lets the host remember the zoom. */
    onChange?: (zoom: number) => void;
}

/** Zoom with Ctrl+Wheel. Not persisted here; the host remembers it per file. */
export function useZoom({ initial, onChange }: UseZoomOptions = {}) {
    const [zoom, setZoomInternal] = useState(() => clampSurfaceZoom(initial ?? 1));

    const canvasRef = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const setZoom = useCallback((newZoom: number) => {
        setZoomInternal(clampSurfaceZoom(newZoom));
    }, []);

    const previousZoom = useRef(zoom);
    useEffect(() => {
        if (previousZoom.current === zoom) return;
        previousZoom.current = zoom;
        onChangeRef.current?.(zoom);
    }, [zoom]);

    useWheelZoom(canvasRef, zoom, setZoom);

    return { zoom, setZoom, canvasRef };
}
