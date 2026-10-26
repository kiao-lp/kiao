import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal, message } from 'antd';
import { BOARDS_PREFIX, boardUrl, handleOf } from './boardRoute';
import {
    boardArchiveFilename, boardArchiveText, downloadTextFile, importBoardArchive, readBoardArchive,
    readFileText,
} from './boardArchive';
import { ARCHIVED_FLOW_NODES_CSV_FILENAME, fetchArchivedFlowNodesCsv } from './archivedFlowNodesCsv';
import { BoardSummary, HybridflowClient, HybridflowError, useHybridflowClient } from './service';

interface BoardsListValue {
    client: HybridflowClient | null;
    boards: BoardSummary[] | null;
    ordered: (compact: boolean) => BoardSummary[];
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

/**
 * The boards list state: the listing, the dialogs over it, and the gestures reaching the
 * store. Shared by the list body and its controls, which render apart on the page — the body
 * in the document, the controls in its tab strip.
 */
export const BoardsListProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const navigate = useNavigate();
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
            // Through the router, as the links in the list are: `boardUrl` is the address *inside*
            // the application, and the application is mounted under a base path (`/dashboard/`).
            // Writing it onto history directly lands on `/boards/major`, which is nowhere.
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
        // Unchanged is not a write: the dialog is closed the way it was opened, and the board — and
        // its revision — are left alone.
        if (name === renaming.name) {
            closeRename();
            return;
        }
        try {
            // **No If-Match here**, and that is deliberate. This list is a snapshot — it is read
            // once, not watched — so the revision it holds is stale by design, and a rename refused
            // because the board moved since is a name somebody typed being answered with a revision
            // they never saw. A name is a whole value and concurrent renames last-win, which is the
            // only sane semantic for one. It also keeps a 409 meaning exactly one thing — the name
            // is taken — so the sentence below is always the right one.
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

    // Asked about in a dialog of its own rather than in a popconfirm on the button: a delete is the
    // press with nothing behind it, and a board of forty cards is not a thing to lose a corner of
    // by leaning on a key — or by missing the rename beside it.
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
                    // The list may be what is wrong — a board deleted in another tab is a row this
                    // one should never have offered — so it is read again rather than trusted.
                    await load();
                }
            },
        });
    }, [client, load]);

    // One board in one file: read whole, written as one JSON document, offered as a download.
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

    // The reverse: a downloaded file replayed onto a fresh board, which opens like a board just
    // made. A file naming agents or runners this store does not hold still imports — those are
    // left unset, and said so.
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

    // Every archived card on every board, as one spreadsheet: the cards are hidden
    // everywhere else, so this is the one place they are still read. Nothing to say is said in
    // the list rather than downloaded as a header alone.
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

    // The page reads most recently touched first, to get back to the one you were on. The
    // lateral panel reads alphabetically, so a board stays where the hand expects it.
    const ordered = useCallback((compact: boolean) => [...(boards ?? [])].sort((a, b) => (compact
        ? a.name.localeCompare(b.name)
        : b.updatedAt.localeCompare(a.updatedAt))), [boards]);

    // The board that is currently open, so the lateral panel marks it as selected. Read from the
    // location rather than the app route: the list itself is what hangs under the prefix, and it
    // has to know where it stands with no provider standing it up — in a test as in a tool bar.
    // `useLocation` is already stripped of the router basename, so this is the stored form.
    const { pathname } = useLocation();
    const currentHandle = useMemo(() => {
        if (pathname === BOARDS_PREFIX) return null;
        if (!pathname.startsWith(`${BOARDS_PREFIX}/`)) return null;
        return handleOf(pathname.slice(BOARDS_PREFIX.length).replace(/^\/+/, ''));
    }, [pathname]);

    const value = useMemo(() => ({
        client, boards, ordered, error, loading, load,
        showArchived, setShowArchived,
        creating, setCreating, newName, setNewName, create,
        renaming, renameTo, setRenameTo, startRename, closeRename, rename,
        askDelete, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    }), [
        client, boards, ordered, error, loading, load,
        showArchived, creating, newName, create,
        renaming, renameTo, startRename, closeRename, rename,
        askDelete, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    ]);

    return <BoardsListContext.Provider value={value}>{children}</BoardsListContext.Provider>;
};
