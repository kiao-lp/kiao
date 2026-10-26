import React, { useCallback, useMemo } from 'react';
import { useSelectionContext, useFileBrowsingPersistenceContext, useCleanSelectionAndPointing } from '@cms-core';

import { MindmapElementOwner, MindmapText, Note } from '../model';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { useDeleteElement } from '../hooks/useDeleteElement';
import { EditableRichTextCmp, NoteEditToolbar } from '../lib/rich-text';

interface MindmapTextProps extends MindmapElementOwner<MindmapText> { }

export const MindmapTextCmp: React.FC<MindmapTextProps> = React.memo(({ element }) => {
    const { id } = element;
    const [selection] = useSelectionContext();
    const { patchElement, selectElements, saveMindmap } = useMindmapStateContext();
    const [mode, setMode] = useMindmapMode();
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const deleteElement = useDeleteElement();
    const { currentFile } = useFileBrowsingPersistenceContext();

    const isEdited = selection.indexOf(id) !== -1 && mode === 'EDIT_MODIFY_ELEMENT';

    const note = useMemo(
        () => selectElements((e) => e.id === id)[0] as Note | undefined,
        [selectElements, id]
    );

    const onChangeFinished = useCallback((value: string, defaultValue: string) => {
        if (value === defaultValue) {
            return;
        }

        patchElement<MindmapText>('notes', id, { content: value })
        saveMindmap();
    }, [patchElement, id, currentFile, saveMindmap]);

    const onPatch = useCallback((patch: Partial<Note>) => {
        patchElement<Note>('notes', id, patch);
        saveMindmap();
    }, [patchElement, id, saveMindmap]);

    const onDelete = useCallback(() => {
        deleteElement(id);
        cleanSelectionAndPointing();
        setMode('EDIT');
    }, [deleteElement, id, cleanSelectionAndPointing, setMode]);

    // Ctrl+Enter is done with the note: the map goes back to being edited, the note staying
    // selected, and the text is kept by the editor's unmount just as a click away keeps it.
    const onCloseEditor = useCallback(() => setMode('EDIT'), [setMode]);

    const toolbar = isEdited && note
        ? <NoteEditToolbar note={note} onPatch={onPatch} onDelete={onDelete} />
        : null;

    return (
        <EditableRichTextCmp className='mindmap-text-rich-text' {...element} isEdited={isEdited}
            toolbar={toolbar}
            onBlur={onChangeFinished} onUnMount={onChangeFinished} onClose={onCloseEditor} />
    );
});
