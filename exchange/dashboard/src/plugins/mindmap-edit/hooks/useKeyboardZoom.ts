import { useEffect } from 'react';

/**
 * Hook to handle keyboard zoom shortcuts (Ctrl+Plus, Ctrl+Minus).
 * Only active when mouse is over the viewport.
 * 
 * @param isMouseOverViewport - Whether mouse is currently over the viewport
 * @param zoom - Current zoom level
 * @param setZoom - Function to update zoom level
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
                setZoom(zoom + 0.1);
            } else if (e.key === '-') {
                e.preventDefault();
                setZoom(zoom - 0.1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMouseOverViewport, zoom, setZoom]);
};
