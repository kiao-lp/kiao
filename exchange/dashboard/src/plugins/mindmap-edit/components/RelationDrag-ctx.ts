import { useCallback, useMemo, useState } from 'react';
import { createSimpleContext } from 'react-concise';

import { useMindmapStateContext } from '../state';
import { useRelateNotes } from '../hooks/useRelation';
import { useCreateNote } from '../hooks/useNote';

/**
 * A relation being pulled out of a note: shift held, the button pressed on the note, and the
 * pointer dragged away. Where the button is let go decides what is made — a relation to the note
 * underneath, or, over the bare map, a new note there and a relation reaching it.
 */
export type RelationDragValue = {
    /** The note the relation is pulled from, null when none is being pulled. */
    from: string | null;
    pullFrom: (noteId: string) => void;
    dropOnNote: (noteId: string) => void;
    dropOnMap: (at: number[]) => void;
    cancel: () => void;
};

const noOperationFn = () => { };

const defaultValue: RelationDragValue = {
    from: null,
    pullFrom: noOperationFn,
    dropOnNote: noOperationFn,
    dropOnMap: noOperationFn,
    cancel: noOperationFn
};

const useRelationDragValue = (): RelationDragValue => {
    const [from, setFrom] = useState<string | null>(null);
    const { saveMindmap } = useMindmapStateContext();
    const relateNotes = useRelateNotes();
    const createNote = useCreateNote();

    const pullFrom = useCallback((noteId: string) => setFrom(noteId), []);

    const cancel = useCallback(() => setFrom(null), []);

    // Let go over a note: the two are related. Over the note it was pulled from, the gesture
    // amounts to nothing — a note is not related to itself.
    const dropOnNote = useCallback((noteId: string) => {
        setFrom(null);
        if (!from || from === noteId) return;

        relateNotes(from, [noteId]);
        saveMindmap();
    }, [from, relateNotes, saveMindmap]);

    // Let go over the bare map: a note is born centred there, related to the one the relation
    // was pulled from, and opens for editing.
    const dropOnMap = useCallback((at: number[]) => {
        setFrom(null);
        if (!from) return;

        createNote(undefined, at, [from]);
    }, [from, createNote]);

    return useMemo(() => ({
        from, pullFrom, dropOnNote, dropOnMap, cancel
    }), [from, pullFrom, dropOnNote, dropOnMap, cancel]);
};

const hookBasedContext = createSimpleContext(useRelationDragValue, defaultValue);

export const RelationDragProvider = hookBasedContext.Provider;
export const useRelationDragContext = hookBasedContext.useContext;
