import { useCallback } from 'react';
import { useSelectionContext } from '@cms-core';
import { useSvgStateContext } from '../state';
import { mapShapes, movedShape } from '../model';

/**
 * Moves everything selected by `(dx, dy)` in SVG units — the drag of a shape, and the
 * arrow keys. Each shape travels by its own coordinates (see `movedShape`).
 */
export const useMoveSelection = () => {
    const [selection] = useSelectionContext();
    const { setDocument } = useSvgStateContext();

    return useCallback((dx: number, dy: number) => {
        if (dx === 0 && dy === 0) return;
        const picked = new Set(selection);
        setDocument(doc => doc ? {
            ...doc,
            drawing: {
                ...doc.drawing,
                nodes: mapShapes(doc.drawing.nodes,
                    shape => picked.has(shape.id) ? movedShape(shape, dx, dy) : shape),
            },
        } : null);
    }, [setDocument, selection]);
};
