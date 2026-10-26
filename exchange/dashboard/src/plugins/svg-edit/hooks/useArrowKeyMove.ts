import { useCallback, useEffect } from 'react';
import { useSelectionContext } from '@cms-core';
import { useSvgStateContext } from '../state';
import { bboxOfShape, isResizable, shapeById } from '../model';
import { useMoveSelection } from './useMoveSelection';
import { FONT_STEP, RESIZE_STEP, useGrowSelection, useResizeTextSelection } from './useShapes';

/**
 * The arrow keys move what is selected — the mindmap steps: 1 with Shift, 12 with Ctrl,
 * 6 bare. With Alt they resize instead: the single selected shape grows by one step in
 * the arrow's direction — Shift for a fine step — and a text, having no box to grow,
 * grows its font on Alt+Up/Down. Quiet where text is being typed, and in the source
 * view, where the keys belong to the editor.
 */
export const useArrowKeyMove = () => {
    const [selection] = useSelectionContext();
    const { document: svgDocument, mode, saveSvg } = useSvgStateContext();
    const moveSelection = useMoveSelection();
    const growSelection = useGrowSelection();
    const resizeText = useResizeTextSelection();

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (mode !== 'canvas') return;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        if (selection.length === 0) return;

        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
            || active.tagName === 'SELECT' || active.isContentEditable)) return;

        if (event.altKey) {
            // Prevented even where nothing is resized: Alt+Left/Right is the browser's
            // own history walk, and the canvas keeps every Alt+Arrow for itself.
            event.preventDefault();
            if (selection.length !== 1) return;
            const shape = svgDocument ? shapeById(svgDocument.drawing.nodes, selection[0]) : undefined;
            if (!shape) return;
            if (shape.tag === 'text') {
                if (event.key === 'ArrowUp') resizeText(FONT_STEP);
                else if (event.key === 'ArrowDown') resizeText(-FONT_STEP);
                return;
            }
            if (!isResizable(shape) || !bboxOfShape(shape)) return;
            const step = event.shiftKey ? 2 : RESIZE_STEP;
            const [dw, dh] =
                event.key === 'ArrowRight' ? [step, 0] :
                    event.key === 'ArrowLeft' ? [-step, 0] :
                        event.key === 'ArrowDown' ? [0, step] : [0, -step];
            growSelection(dw, dh);
            return;
        }

        const offset = event.shiftKey ? 1 : event.ctrlKey || event.metaKey ? 12 : 6;
        const movement =
            event.key === 'ArrowUp' ? [0, -offset] :
                event.key === 'ArrowDown' ? [0, offset] :
                    event.key === 'ArrowLeft' ? [-offset, 0] : [offset, 0];

        event.preventDefault();
        moveSelection(movement[0], movement[1]);
        saveSvg();
    }, [mode, selection, svgDocument, moveSelection, growSelection, resizeText, saveSvg]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
};
