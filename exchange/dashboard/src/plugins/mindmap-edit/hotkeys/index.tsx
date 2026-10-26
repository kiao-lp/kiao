import React from 'react';
import { useArrowKeyMove } from '../hooks/useArrowKeyMove';

import { useCoreHotkeys } from './useCoreHotkeys';
import { useNoteHotkeys } from './useNoteHotkeys';
import { MindmapClipboardProvider } from './useClipboardHotkeys';

// === Provider Component ===

/**
 * The map's keys: Delete and Escape, the clipboard trio, Ctrl+G to group. The verbs without
 * a key of their own live in the right-click menu (`components/MindmapContextMenu.tsx`).
 */
export const MindmapHotkeysProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    // Arrow key movement for selected notes
    useArrowKeyMove();
    useCoreHotkeys();
    useNoteHotkeys();

    return (
        <MindmapClipboardProvider>
            {children}
        </MindmapClipboardProvider>
    );
};
