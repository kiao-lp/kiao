/**
 * Files dragged out of the file navigator and let go over the map.
 *
 * **Where it lands is what it means.** Over a note, the link goes at the end of what that note
 * already says: the note is about that file too, and there is one place a link appended to a text
 * can go. Over the bare map, there is no note for it to join, so it becomes one — in the style new
 * notes are being made in, which is the style the top bar shows.
 *
 * The two are the same drag, told apart by the note stopping the drop it took. Without that the
 * map would make a note of it as well, and one dropped file would leave two.
 *
 * A drop is refused while the map is being *visualised*, as every other way of changing it is:
 * `VISUALIZE` is what the editor is put into to be read rather than written, and it is also what a
 * map is in until it is first clicked — the state a double click declines to create a note in.
 * A drag that is not the store's own is refused too, and left to the browser to do what it always
 * has with it.
 */

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
    /** True while a drag of ours is held over the note — what the note is marked with. */
    dropping: boolean;
    dropProps: NoteFileDropProps;
}

/**
 * Says yes to the drop, as a **copy**: the file stays where it is and only a link to it is written.
 * Both this and the same call on `dragover` are needed for a drop to fire at all — a dragover left
 * to its default refuses it, and the browser then navigates to the dropped file.
 */
const acceptCopy = (event: React.DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
};

/**
 * The bare map's side of it: what is dropped becomes a note of its own, over the point it was let
 * go at, holding the links.
 *
 * `locationOf` is the viewport's, the map being drawn zoomed: a drop is at a point on the screen
 * and a note is at a point on the map.
 */
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
            // Related to nothing: the selection is whatever was last worked on, and a note dropped
            // from outside the map has not been said to be about it. A link that belongs to a note
            // is dropped on that note, which is the other half of this.
            createNote(contentWithDroppedFiles('', dropped), locationOf(event) ?? undefined, []);
        },
    }), [editing, createNote, locationOf]);
};

/**
 * A note's side of it: the links go at the end of what the note says.
 *
 * The note's text is read off the map rather than taken as a prop, because the rect that takes the
 * drop is drawn from a place and a size and knows nothing of what is written in it.
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
            // This drop has landed: the map is not to make a note of it as well.
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
