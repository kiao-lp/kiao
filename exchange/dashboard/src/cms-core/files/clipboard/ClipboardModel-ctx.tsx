import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { notification } from 'antd';
import { useWorkerClient } from '../service/ui';
import { WorkerClient, parentPath } from '../service';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { InProgressFeedback } from '../core/InProgressFeedback-cmp';
import { performCut, performCopy, ClipboardMode, PasteOutcome } from './clipboardOps';

interface ClipboardState {
    entries: string[];
    mode: ClipboardMode;
}

export interface ClipboardModelApi {
    state: ClipboardState | null;
    hasEntries: () => boolean;
    isCut: (path: string) => boolean;
    cut: (paths: string[]) => void;
    copy: (paths: string[]) => void;
    paste: (targetFolder: string) => Promise<PasteOutcome | null>;
    clear: () => void;
}

const ClipboardContext = createContext<ClipboardModelApi | null>(null);

const folderLabel = (path: string): string => path || '/';

const sourceFolderLabel = (paths: string[]): string => {
    const folders = [...new Set(paths.map(parentPath))];
    return folders.length === 1 ? folderLabel(folders[0]) : 'multiple folders';
};

const moveDescription = (
    verb: 'Moving' | 'Moved' | 'Could not move',
    entries: string[],
    targetFolder: string,
): string => {
    const count = entries.length;
    const fileLabel = count === 1 ? 'file' : 'files';
    return `${verb} ${count} ${fileLabel} from ${sourceFolderLabel(entries)} to ${folderLabel(targetFolder)}`;
};

export const ClipboardModelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<ClipboardState | null>(null);
    const client = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();

    const hasEntries = useCallback(() => !!state && state.entries.length > 0, [state]);

    const isCut = useCallback((path: string) =>
        !!state && state.mode === 'cut' && state.entries.includes(path)
    , [state]);

    const cut = useCallback((paths: string[]) => {
        if (paths.length === 0) return;
        setState({ entries: paths.slice(), mode: 'cut' });
    }, []);

    const copy = useCallback((paths: string[]) => {
        if (paths.length === 0) return;
        setState({ entries: paths.slice(), mode: 'copy' });
    }, []);

    const clear = useCallback(() => setState(null), []);

    const paste = useCallback(async (targetFolder: string): Promise<PasteOutcome | null> => {
        if (!state || state.entries.length === 0) return null;
        const op = state.mode;
        const entries = state.entries.slice();
        const action = op === 'cut' ? 'move' : 'copy';
        const key = `clipboard-paste-${Date.now()}`;
        // Shown whatever the entry count. It used to take more than five entries to be worth a
        // spinner, back when a paste was a round trip; a move runs the link-fixer over the whole
        // store, so even one file can take seconds on a large or bind-mounted one — and a paste
        // with nothing on screen is indistinguishable from a paste that did nothing.
        notification.open({
            key,
            message: action === 'move'
                ? `${moveDescription('Moving', entries, targetFolder)}…`
                : `Copying ${entries.length} ${entries.length === 1 ? 'file' : 'files'} from ${sourceFolderLabel(entries)} to ${folderLabel(targetFolder)}…`,
            description: <InProgressFeedback />,
            duration: 0,
        });
        const outcome = op === 'cut'
            ? await performCut(client, entries, targetFolder)
            : await performCopy(client, entries, targetFolder);

        notification.destroy(key);

        const failed = outcome.failed.length;
        if (failed > 0) {
            // Lead with the failure. "Moved N files … with errors" put the word "Moved" first, so a
            // paste that moved nothing at all read as a success with a caveat.
            notification.error({
                message: action === 'move'
                    ? moveDescription('Could not move', entries, targetFolder)
                    : `Could not copy ${entries.length} ${entries.length === 1 ? 'file' : 'files'} from ${sourceFolderLabel(entries)} to ${folderLabel(targetFolder)}`,
                description: `${failed} of ${entries.length} could not be processed. Nothing was retried one by one — check the folder and try again.`,
            });
        } else {
            notification.success({
                message: action === 'move'
                    ? moveDescription('Moved', entries, targetFolder)
                    : `Copied ${entries.length} ${entries.length === 1 ? 'file' : 'files'} from ${sourceFolderLabel(entries)} to ${folderLabel(targetFolder)}`,
            });
        }

        if (op === 'cut') setState(null);
        refreshFileList();
        return outcome;
    }, [state, client, refreshFileList]);

    const api: ClipboardModelApi = useMemo(() => ({
        state,
        hasEntries,
        isCut,
        cut,
        copy,
        paste,
        clear,
    }), [state, hasEntries, isCut, cut, copy, paste, clear]);

    return <ClipboardContext.Provider value={api}>{children}</ClipboardContext.Provider>;
};

export const useClipboard = (): ClipboardModelApi => {
    const ctx = useContext(ClipboardContext);
    if (!ctx) throw new Error('useClipboard must be used within a ClipboardModelProvider');
    return ctx;
};

export const useClipboardOptional = (): ClipboardModelApi | null =>
    useContext(ClipboardContext);
