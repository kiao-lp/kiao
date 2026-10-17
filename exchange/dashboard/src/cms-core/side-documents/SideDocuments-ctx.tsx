import { useCallback, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { createSimpleContext } from 'react-concise';
import { WorkerClient, WorkerError } from 'kiao-worker';
import { extractName } from '../files/service';
import { useWorkerClient } from '../files/service/ui';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useRefreshFileList } from '../files/core/CurrentFileList-ctx';
import { usePluginListContext } from '../core/PluginList-ctx';
import { useFileViewState } from '../view-state';
import { SideDocumentContext, SideDocumentDeclaration } from './sideDocumentModel';

/** A side document the open document could be given, and whether it is being shown. */
export interface OfferedSideDocument {
    declaration: SideDocumentDeclaration;
    context: SideDocumentContext;
    open: boolean;
}

export interface SideDocumentsValue {
    /** What the open document may be shown beside, in plugin-registration order. */
    offered: OfferedSideDocument[];
    /** Those the user has switched on, in that same order. */
    opened: OfferedSideDocument[];
    /** Show or hide one. Showing one for the first time writes its file. */
    toggle: (id: string) => void;
    /** The id of the side document currently being created, if any. */
    creating: string | null;
}

const defaultValue: SideDocumentsValue = {
    offered: [],
    opened: [],
    toggle: () => { },
    creating: null,
};

/**
 * Whether the store holds this path. `/info` answers a path it does not have with a null body
 * rather than with a 404, so both readings mean absent. Anything else — a 500, a network failure —
 * is not an answer at all and is left to propagate: writing on it would overwrite the very
 * document the reader asked to see.
 */
const documentExists = async (client: WorkerClient, path: string): Promise<boolean> => {
    try {
        return (await client.getFileMetadata(path)) != null;
    } catch (error) {
        if (error instanceof WorkerError && error.response.status === 404) return false;
        throw error;
    }
};

const useSideDocumentsValue = (): SideDocumentsValue => {
    const { sideDocuments } = usePluginListContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const client = useWorkerClient();
    // A side document created here is a new file of the browsed folder; nothing else would
    // tell the file list about it.
    const refreshFileList = useRefreshFileList();
    // Which panes are up is how the user left this document, so it is remembered per file
    // rather than per session. This is the one hook on the scope — the toggles in the top
    // banner and the panes beside the editor both read it through this context.
    const [view, setView] = useFileViewState('side-documents', { open: [] as string[] });
    const [creating, setCreating] = useState<string | null>(null);

    const offered = useMemo<OfferedSideDocument[]>(() => {
        if (!currentFile || currentFile.isDirectory) return [];
        return sideDocuments.flatMap(declaration => {
            const path = declaration.pathFor(currentFile);
            return path
                ? [{ declaration, context: { hostFile: currentFile, path }, open: view.open.includes(declaration.id) }]
                : [];
        });
    }, [sideDocuments, currentFile, view.open]);

    const opened = useMemo(() => offered.filter(entry => entry.open), [offered]);

    // Read inside the callback rather than closed over, so a toggle fired from a stale render
    // still decides against what is on screen.
    const offeredRef = useRef(offered);
    offeredRef.current = offered;

    const toggle = useCallback((id: string) => {
        const entry = offeredRef.current.find(offer => offer.declaration.id === id);
        if (!entry) return;
        if (entry.open) {
            setView(prev => ({ open: prev.open.filter(openId => openId !== id) }));
            return;
        }

        const show = () => setView(prev =>
            prev.open.includes(id) ? {} : { open: [...prev.open, id] });

        const { declaration, context } = entry;
        setCreating(id);
        documentExists(client, context.path)
            .then(exists => exists
                ? undefined
                : declaration.create(context.path, client).then(refreshFileList))
            .then(show)
            .catch(() => message.error(`Could not open ${extractName(context.path)}`))
            .finally(() => setCreating(current => (current === id ? null : current)));
    }, [client, refreshFileList, setView]);

    return useMemo(
        () => ({ offered, opened, toggle, creating }),
        [offered, opened, toggle, creating],
    );
};

const hookBasedContext = createSimpleContext(useSideDocumentsValue, defaultValue);

export const SideDocumentsProvider = hookBasedContext.Provider;
export const useSideDocuments = hookBasedContext.useContext;
