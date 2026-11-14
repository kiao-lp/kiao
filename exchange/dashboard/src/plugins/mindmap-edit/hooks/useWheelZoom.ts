import { useEffect, RefObject } from 'react';

/** Hook to handle mouse wheel zoom on a mindmap viewport. */
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
            element.addEventListener('wheel', handleWheel, { passive: false });
            return () => element.removeEventListener('wheel', handleWheel);
        }
    }, [zoom, setZoom, divRef]);
};
