import { useCallback } from 'react';

import { deleteElement, deleteElements } from '../lib/delete-element';
import { useMindmapStateContext } from '../state';

/** Deletes a note, a text or a relation, and saves the map. */
export const useDeleteElement = () => {
    const { setMindmap, saveMindmap } = useMindmapStateContext();

    return useCallback((id: string) => {
        setMindmap(mindmap => mindmap ? deleteElement(mindmap, id) : null);
        saveMindmap();
    }, [setMindmap, saveMindmap]);
};

/**
 * Deletes everything named at once — what the Delete key takes, a selection holding notes and
 * relations alike — and saves the map. Nothing named is nothing to do, and no save either.
 */
export const useDeleteElements = () => {
    const { setMindmap, saveMindmap } = useMindmapStateContext();

    return useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        setMindmap(mindmap => mindmap ? deleteElements(mindmap, ids) : null);
        saveMindmap();
    }, [setMindmap, saveMindmap]);
};
