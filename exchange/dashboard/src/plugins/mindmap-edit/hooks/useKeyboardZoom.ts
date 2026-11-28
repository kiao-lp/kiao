import { useEffect } from 'react';
import { stepSurfaceZoom } from '@kiao-dashboard-core';

/**
 * Hook to handle keyboard zoom shortcuts (Ctrl+Plus, Ctrl+Minus).
 * Only active when mouse is over the viewport.
 */
export const useKeyboardZoom = (
    isMouseOverViewport: boolean,
    zoom: number,
    setZoom: (zoom: number) => void
) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isMouseOverViewport) return;
            if (!(e.ctrlKey || e.metaKey)) return;

            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                setZoom(stepSurfaceZoom(zoom, 1));
            } else if (e.key === '-') {
                e.preventDefault();
                setZoom(stepSurfaceZoom(zoom, -1));
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMouseOverViewport, zoom, setZoom]);
};
