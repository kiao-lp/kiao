import { useMemo } from 'react';
import { CommandContext, CommandDescriptor, useSingleTargetElement } from '@cms-core';

// State & Models
import { useMindmapStateContext, useMindmapMode } from '../state';

// Hooks
import {
    useCreateNoteGroup,
    useUngroupNotes,
    usePasteLink,
    usePasteCode,
    usePasteImage
} from '../hooks/useNote';

// === Main Note Commands Hook ===

export const useNoteCommands = () => {
    const [mode] = useMindmapMode();
    const { selectElements } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    // Hooks
    const createNoteGroup = useCreateNoteGroup();
    const ungroupNotes = useUngroupNotes();
    const pasteLink = usePasteLink();
    const pasteCode = usePasteCode();
    const pasteImage = usePasteImage();

    // Computed
    const targetMindmapElement = selectElements(element => element.id === targetElement)[0];

    return useMemo(() => {
        const cmds: CommandDescriptor[] = [];

        // === Note Commands ===
        // A new note is made by double clicking the mindmap where it should sit, not by a shortcut.
        cmds.push({
            id: 'new-note-group',
            shortcut: 'grp',
            title: <>grp.Group</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length >= 2,
            execute: () => createNoteGroup()
        });

        cmds.push({
            id: 'ungroup-notes',
            shortcut: 'ugr',
            title: <>ugr.Ungroup</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length >= 1,
            execute: () => ungroupNotes()
        });

        cmds.push({
            id: 'paste-link',
            shortcut: 'pl',
            title: <>pl.Paste lnk</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length === 0 && !targetMindmapElement,
            execute: pasteLink
        });

        cmds.push({
            id: 'paste-code',
            shortcut: 'pc',
            title: <>pc.Paste cde</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length === 0 && !targetMindmapElement,
            execute: pasteCode
        });

        cmds.push({
            id: 'paste-image',
            shortcut: 'pi',
            title: <>pi.Paste image</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length === 0 && !targetMindmapElement,
            execute: pasteImage
        });

        return cmds;
    }, [mode, targetMindmapElement, createNoteGroup, ungroupNotes, pasteLink, pasteCode, pasteImage]);
};
