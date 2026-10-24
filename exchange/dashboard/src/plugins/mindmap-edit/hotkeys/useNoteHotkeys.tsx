import React from 'react';
import { CommandContext, usePluginHotkeys } from '@cms-core';

import { useMindmapStateContext, useMindmapMode } from '../state';
import { MindmapRect } from '../model';
import { useCreateNoteGroup, useUngroupNotes } from '../hooks/useNote';

/**
 * Group and ungroup, on the keys every drawing program puts them on. The right-click menu
 * says the same two.
 */
export const useNoteHotkeys = () => {
    const [mode] = useMindmapMode();
    const { selectElements } = useMindmapStateContext();

    const createNoteGroup = useCreateNoteGroup();
    const ungroupNotes = useUngroupNotes();

    const anyGrouped = React.useCallback((ctx: CommandContext) =>
        selectElements(element => ctx.selection.includes(element.id))
            .some(element => (element as MindmapRect).group !== undefined),
        [selectElements]);

    usePluginHotkeys('mindmap-notes', [
        {
            id: 'group-notes',
            key: 'Mod+G',
            title: <>Ctrl+G. Group</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length >= 2,
            execute: () => createNoteGroup()
        },
        {
            id: 'ungroup-notes',
            key: 'Mod+Shift+G',
            title: <>Ctrl+Shift+G. Ungroup</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && anyGrouped(ctx),
            execute: () => ungroupNotes()
        },
    ], [mode, anyGrouped, createNoteGroup, ungroupNotes]);
};
