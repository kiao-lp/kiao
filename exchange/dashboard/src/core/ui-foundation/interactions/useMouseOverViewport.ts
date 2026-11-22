import { useState, useCallback } from 'react';

/** Hook to track whether the mouse is currently over a specific viewport element. */
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
