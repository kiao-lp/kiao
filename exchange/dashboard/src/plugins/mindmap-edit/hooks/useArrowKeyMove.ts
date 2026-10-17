import { useCallback, useEffect } from 'react';
import { useSelectionContext } from '@cms-core';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { instanceOfMindmapRect, instanceOfMindmapRelation } from '../model';
import { useMoveSelection } from './useMoveSelection';

/**
 * Hook to handle arrow key movement of what is selected — notes, and the centres of relations.
 * - Shift: offset of 1
 * - Ctrl: offset of 12
 * - No modifier: offset of 6
 */
export const useArrowKeyMove = () => {
    const [selection] = useSelectionContext();
    const [mode] = useMindmapMode();
    const { selectElements, saveMindmap } = useMindmapStateContext();
    const moveSelection = useMoveSelection();

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // Only handle in EDIT mode
        if (mode !== 'EDIT') return;

        // Only handle arrow keys
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

        // Skip if no selection
        if (selection.length === 0) return;

        // Don't handle if a text input is focused
        const activeElement = document.activeElement as HTMLElement;
        if (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.tagName === 'SELECT' ||
            activeElement.isContentEditable
        ) {
            return;
        }

        // Only what the keys can actually move: notes, and the centres of relations.
        const selectedElements = selection.flatMap(id =>
            selectElements(element => element.id === id)
        );
        const allAreMovable = selectedElements.length > 0 &&
            selectedElements.every(element => instanceOfMindmapRect(element) || instanceOfMindmapRelation(element));

        if (!allAreMovable) return;

        // Determine offset based on modifier keys
        let offset: number;
        if (event.shiftKey) {
            offset = 1;
        } else if (event.ctrlKey || event.metaKey) {
            offset = 12;
        } else {
            offset = 6;
        }

        // Calculate movement vector
        let movement: number[];
        switch (event.key) {
            case 'ArrowUp':
                movement = [0, -offset];
                break;
            case 'ArrowDown':
                movement = [0, offset];
                break;
            case 'ArrowLeft':
                movement = [-offset, 0];
                break;
            case 'ArrowRight':
                movement = [offset, 0];
                break;
            default:
                return;
        }

        // Prevent default browser behavior (e.g., scrolling)
        event.preventDefault();

        // Move what is selected
        moveSelection(movement);
        saveMindmap();
    }, [mode, selection, selectElements, moveSelection, saveMindmap]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
};
