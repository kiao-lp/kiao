import { useEffect, RefObject } from 'react';

/**
 * Hook to handle mouse wheel zoom on a mindmap viewport.
 * Attaches a non-passive wheel event listener to allow preventDefault.
 * 
 * @param divRef - Reference to the mindmap viewport element (may be null)
 * @param zoom - Current zoom level
 * @param setZoom - Function to update zoom level
 */
export const useWheelZoom = (
    divRef: RefObject<HTMLDivElement> | null,
    zoom: number,
    setZoom: (zoom: number) => void
) => {
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY;
                const zoomChange = delta > 0 ? -0.1 : 0.1;
                setZoom(zoom + zoomChange);
            }
        };

        const element = divRef?.current;
        if (element) {
            // Use {passive: false} to allow preventDefault() and prevent browser zoom
            element.addEventListener('wheel', handleWheel, { passive: false });
            return () => element.removeEventListener('wheel', handleWheel);
        }
    }, [zoom, setZoom, divRef]);
};
