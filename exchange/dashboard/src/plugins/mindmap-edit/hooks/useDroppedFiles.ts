/** Files dragged out of the file navigator and let go over the map. **Where it lands is what it means. */

import type React from 'react';
import { useMemo, useState } from 'react';
import { holdsDraggedFiles, readDraggedFiles } from '@cms-core';

import { contentWithDroppedFiles } from '../lib/dropped-files';
import { MindmapText, Note } from '../model';
import { useMindmapMode, useMindmapStateContext } from '../state';
import { useCreateNote } from './useNote';

/** Spread onto whatever takes the drop. */
export interface FileDropProps {
    onDragOver: React.DragEventHandler<HTMLElement>;
    onDrop: React.DragEventHandler<HTMLElement>;
}

/** A note's, which also lets go of the mark it wears while the drag is over it. */
export interface NoteFileDropProps extends FileDropProps {
    onDragLeave: React.DragEventHandler<HTMLElement>;
}

export interface NoteFileDrop {

    dropping: boolean;
    dropProps: NoteFileDropProps;
}

/** Says yes to the drop, as a **copy**: the file stays where it is and only a link to it is written. */
const acceptCopy = (event: React.DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
};

/** The bare map's side of it: what is dropped becomes a note of its own, over the point it was let go. */
export const useMapFileDrop = (
    locationOf: (event: React.DragEvent) => number[] | null
): FileDropProps => {
    const [mode] = useMindmapMode();
    const createNote = useCreateNote();

    const editing = mode !== 'VISUALIZE';

    return useMemo(() => ({
        onDragOver: event => {
            if (!editing || !holdsDraggedFiles(event.dataTransfer)) return;
            acceptCopy(event);
        },
        onDrop: event => {
            if (!editing) return;
            const dropped = readDraggedFiles(event.dataTransfer);
            if (!dropped.length) return;
            acceptCopy(event);
            createNote(contentWithDroppedFiles('', dropped), locationOf(event) ?? undefined, []);
        },
    }), [editing, createNote, locationOf]);
};

/**
 * A note's side of it: the links go at the end of what the note says.
 * The note's text is read off the map rather than taken as a prop, because the rect that takes.
 */
export const useNoteFileDrop = (id: string): NoteFileDrop => {
    const [mode] = useMindmapMode();
    const { selectElements, patchElement, saveMindmap } = useMindmapStateContext();
    const [dropping, setDropping] = useState(false);

    const editing = mode !== 'VISUALIZE';

    const dropProps = useMemo<NoteFileDropProps>(() => ({
        onDragOver: event => {
            if (!editing || !holdsDraggedFiles(event.dataTransfer)) return;
            acceptCopy(event);
            setDropping(true);
        },
        onDragLeave: () => setDropping(false),
        onDrop: event => {
            setDropping(false);
            if (!editing) return;
            const dropped = readDraggedFiles(event.dataTransfer);
            if (!dropped.length) return;
            acceptCopy(event);
            event.stopPropagation();

            const note = selectElements(element => element.id === id)[0] as Note | undefined;
            if (!note) return;
            patchElement<MindmapText>('notes', id, {
                content: contentWithDroppedFiles(note.content ?? '', dropped)
            });
            saveMindmap();
        },
    }), [editing, id, selectElements, patchElement, saveMindmap]);

    return useMemo(() => ({ dropping, dropProps }), [dropping, dropProps]);
};
