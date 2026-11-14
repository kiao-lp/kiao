import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, message } from 'antd';
import { boardUrl } from './boardRoute';
import { useHybridflow } from './Hybridflow-ctx';
import {
    boardArchiveFilename, boardArchiveText, downloadTextFile, importBoardArchive, readBoardArchive,
    readFileText,
} from './boardArchive';
import { ARCHIVED_FLOW_NODES_CSV_FILENAME, fetchArchivedFlowNodesCsv } from './archivedFlowNodesCsv';
import { BoardSummary, HybridflowClient, HybridflowError, useHybridflowClient } from './service';

interface BoardsListValue {
    client: HybridflowClient | null;
    boards: BoardSummary[] | null;
    error: string | null;
    loading: boolean;
    load: () => Promise<void>;
    showArchived: boolean;
    setShowArchived: (show: boolean) => void;
    creating: boolean;
    setCreating: (creating: boolean) => void;
    newName: string;
    setNewName: (name: string) => void;
    create: () => Promise<void>;
    renaming: BoardSummary | null;
    renameTo: string;
    setRenameTo: (name: string) => void;
    startRename: (board: BoardSummary) => void;
    closeRename: () => void;
    rename: () => Promise<void>;
    askDelete: (board: BoardSummary) => void;
    download: (board: BoardSummary) => Promise<void>;
    downloading: string | null;
    importFile: (file: File) => Promise<void>;
    importing: boolean;
    exportArchivedCsv: () => Promise<void>;
    exportingCsv: boolean;
    currentHandle: string | null;
}

const BoardsListContext = createContext<BoardsListValue | null>(null);

export const useBoardsList = (): BoardsListValue => {
    const context = useContext(BoardsListContext);
    if (!context) throw new Error('useBoardsList must be used within a BoardsListProvider');
    return context;
};

/** The boards list state: the listing, the dialogs over it, and the gestures reaching the store. */
export const BoardsListProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const navigate = useNavigate();
    const { handle: currentHandle } = useHybridflow();
    const [boards, setBoards] = useState<BoardSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [renaming, setRenaming] = useState<BoardSummary | null>(null);
    const [renameTo, setRenameTo] = useState('');
    const [downloading, setDownloading] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [exportingCsv, setExportingCsv] = useState(false);

    const load = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            setBoards(await client.boards(showArchived));
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }, [client, showArchived]);

    useEffect(() => { void load(); }, [load]);

    const create = useCallback(async () => {
        if (!client) return;
        const name = newName.trim();
        if (!name) return;
        try {
            const made = await client.createBoard(name);
            setCreating(false);
            setNewName('');
            // Straight onto it: making a board is something you do because you are about to use it.
            navigate(boardUrl(made.board.slug));
        } catch (cause) {
            const taken = cause instanceof HybridflowError && cause.status === 409;
            message.error(taken
                ? `There is already a board called “${name}”.`
                : `The board could not be created: ${cause instanceof Error ? cause.message : cause}`);
        }
    }, [client, newName, navigate]);

    const closeRename = useCallback(() => {
        setRenaming(null);
        setRenameTo('');
    }, []);

    const startRename = useCallback((board: BoardSummary) => {
        setRenaming(board);
        setRenameTo(board.name);
    }, []);

    const rename = useCallback(async () => {
        if (!client || !renaming) return;
        const name = renameTo.trim();
        if (!name) return;

        if (name === renaming.name) {
            closeRename();
            return;
        }
        try {
            const changed = await client.renameBoard(renaming.slug, name);
            setBoards(held => (held ?? []).map(board => (board.id === changed.id ? changed : board)));
            closeRename();
        } catch (cause) {
            const taken = cause instanceof HybridflowError && cause.status === 409;
            message.error(taken
                ? `There is already a board called “${name}”.`
                : `The board could not be renamed: ${cause instanceof Error ? cause.message : cause}`);
        }
    }, [client, renaming, renameTo, closeRename]);

    const askDelete = useCallback((board: BoardSummary) => {
        if (!client) return;
        Modal.confirm({
            title: `Delete “${board.name}”?`,
            content: 'Its cards go with it, and there is no undo.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    await client.deleteBoard(board.slug);
                    setBoards(held => (held ?? []).filter(heldBoard => heldBoard.id !== board.id));
                } catch (cause) {
                    message.error(`The board could not be deleted: ${cause instanceof Error ? cause.message : cause}`);
                    // The list may be what is wrong — a board deleted in another tab is a row this one should never have offered —.
                    await load();
                }
            },
        });
    }, [client, load]);

    const download = useCallback(async (board: BoardSummary) => {
        if (!client) return;
        setDownloading(board.slug);
        try {
            const detail = await client.board(board.slug);
            downloadTextFile(boardArchiveFilename(board.slug), boardArchiveText(detail));
        } catch (cause) {
            message.error(`The board could not be downloaded: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setDownloading(null);
        }
    }, [client]);

    const importFile = useCallback(async (file: File) => {
        if (!client) return;
        setImporting(true);
        try {
            const archive = readBoardArchive(await readFileText(file));
            if (!archive) {
                message.error('This file is not a board download.');
                return;
            }
            const { board: made, droppedRefs } = await importBoardArchive(client, archive);
            navigate(boardUrl(made.slug));
            message.success(`Board “${made.name}” imported.`);
            if (droppedRefs > 0) {
                message.warning(
                    `${droppedRefs} agent or runner reference${droppedRefs === 1 ? ' was' : 's were'} `
                    + 'left unset: this store holds nothing by those ids.');
            }
        } catch (cause) {
            const taken = cause instanceof HybridflowError && cause.status === 409;
            message.error(taken
                ? 'There is already a board by that name.'
                : `The board could not be imported: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setImporting(false);
        }
    }, [client, navigate]);

    const exportArchivedCsv = useCallback(async () => {
        if (!client) return;
        setExportingCsv(true);
        try {
            const { text, flowNodes } = await fetchArchivedFlowNodesCsv(client);
            if (flowNodes === 0) {
                message.info('No archived flow nodes to export.');
                return;
            }
            downloadTextFile(ARCHIVED_FLOW_NODES_CSV_FILENAME, text, 'text/csv;charset=utf-8');
        } catch (cause) {
            message.error(`The archived flow nodes could not be exported: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setExportingCsv(false);
        }
    }, [client]);

    const orderedBoards = useMemo(() => boards === null ? null
        : [...boards].sort((a, b) => a.name.localeCompare(b.name)), [boards]);

    const value = useMemo(() => ({
        client, boards: orderedBoards, error, loading, load,
        showArchived, setShowArchived,
        creating, setCreating, newName, setNewName, create,
        renaming, renameTo, setRenameTo, startRename, closeRename, rename,
        askDelete, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    }), [
        client, orderedBoards, error, loading, load,
        showArchived, creating, newName, create,
        renaming, renameTo, startRename, closeRename, rename,
        askDelete, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    ]);

    return <BoardsListContext.Provider value={value}>{children}</BoardsListContext.Provider>;
};
