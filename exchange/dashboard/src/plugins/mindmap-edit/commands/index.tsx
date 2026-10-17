import React, { useMemo } from 'react';
import { usePluginCommands } from '@cms-core';
import { useArrowKeyMove } from '../hooks/useArrowKeyMove';
import { CutConfirmModal } from '../components/CutConfirmModal-cmp';

// Sub-hooks
import { useCoreCommands } from './useCoreCommands';
import { useNoteCommands } from './useNoteCommands';
import { useRelationCommands } from './useRelationCommands';
import { useClipboardCommands } from './useClipboardCommands';

// === Main Commands Hook ===

export const useMindmapCommands = () => {
    // Arrow key movement for selected notes
    useArrowKeyMove();

    // Hooks
    const coreCommands = useCoreCommands();
    const noteCommands = useNoteCommands();
    const relationCommands = useRelationCommands();
    // Copy, cut and paste are hotkeys rather than commands, and answer with the one thing they
    // have to show: what a cut is waiting on.
    const { pendingCut, confirmCut, cancelCut } = useClipboardCommands();

    // Aggregate commands
    const commands = useMemo(() => {
        return [
            ...coreCommands,
            ...noteCommands,
            ...relationCommands
        ];
    }, [coreCommands, noteCommands, relationCommands]);

    // Register with cms-core
    usePluginCommands('mindmap-editor', commands, [commands]);

    return { pendingCut, confirmCut, cancelCut };
};

// === Provider Component ===

export const MindmapCommandsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { pendingCut, confirmCut, cancelCut } = useMindmapCommands();
    return (
        <>
            {children}
            <CutConfirmModal pending={pendingCut} onConfirm={confirmCut} onCancel={cancelCut} />
        </>
    );
};
