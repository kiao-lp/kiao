import { useState, useCallback } from 'react';

/**
 * Hook to track whether the mouse is currently over a specific viewport element.
 * Provides handlers for mouse enter and leave events.
 * 
 * @returns Object with isMouseOver state and event handlers
 */
export const useMouseOverViewport = () => {
    const [isMouseOverViewport, setIsMouseOverViewport] = useState(false);

    const onMouseEnter = useCallback(() => {
        setIsMouseOverViewport(true);
    }, []);

    const onMouseLeave = useCallback(() => {
        setIsMouseOverViewport(false);
    }, []);

    return {
        isMouseOverViewport,
        onMouseEnter,
        onMouseLeave
    };
};
