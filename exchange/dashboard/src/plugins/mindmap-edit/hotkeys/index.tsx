import React from 'react';
import { useArrowKeyMove } from '../hooks/useArrowKeyMove';

import { useCoreHotkeys } from './useCoreHotkeys';
import { useNoteHotkeys } from './useNoteHotkeys';
import { MindmapClipboardProvider } from './useClipboardHotkeys';


/**
 * The map's keys: Delete and Escape, the clipboard trio, Ctrl+G to group.
 * The verbs without a key of their own live in the right-click menu (`components/MindmapContextMenu.
 */
export const MindmapHotkeysProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    useArrowKeyMove();
    useCoreHotkeys();
    useNoteHotkeys();

    return (
        <MindmapClipboardProvider>
            {children}
        </MindmapClipboardProvider>
    );
};
