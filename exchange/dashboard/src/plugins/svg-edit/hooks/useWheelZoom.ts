import { RefObject, useEffect } from 'react';

/**
 * Ctrl-wheel (or Cmd-wheel) zooms the viewport the listener is attached to. A bare wheel is
 * the page's, for scrolling the drawing.
 */
export const useWheelZoom = (
    divRef: RefObject<HTMLDivElement> | null,
    zoom: number,
    setZoom: (zoom: number) => void,
) => {
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoom(zoom + (e.deltaY > 0 ? -0.1 : 0.1));
            }
        };

        const element = divRef?.current;
        if (element) {
            element.addEventListener('wheel', handleWheel, { passive: false });
            return () => element.removeEventListener('wheel', handleWheel);
        }
    }, [zoom, setZoom, divRef]);
};
