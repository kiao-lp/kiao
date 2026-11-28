import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { useConfirmation } from '@kiao-dashboard-core';
import { boardUrl } from './boardRoute';
import { useHybridflow } from './Hybridflow-ctx';
import { useBoardsCatalog } from './BoardsCatalog-ctx';
import {
    boardArchiveFilename, boardArchiveText, downloadTextFile, importBoardArchive, readBoardArchive,
    readFileText,
} from './boardArchive';
import { ARCHIVED_FLOW_NODES_CSV_FILENAME, fetchArchivedFlowNodesCsv } from './archivedFlowNodesCsv';
import { BoardSummary, FolderDto, HybridflowError } from './service';

type NameDialog =
    | { kind: 'board'; item?: BoardSummary; folder?: FolderDto }
    | { kind: 'folder'; item?: FolderDto };

interface BoardsListValue {
    nameDialog: NameDialog | null;
    openNameDialog: (dialog: NameDialog) => void;
    closeNameDialog: () => void;
    saveName: (name: string) => Promise<void | boolean>;
    moveBoard: (board: BoardSummary, folderId: string) => Promise<void>;
    movingBoard: boolean;
    askDelete: (board: BoardSummary) => void;
    askDeleteFolder: (folder: FolderDto) => void;
    download: (board: BoardSummary) => Promise<void>;
    downloading: ReadonlySet<string>;
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

/** Dialogs and writes for one boards list. */
export const BoardsListProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { client, reload, connectList, expandFolder, forgetFolder } = useBoardsCatalog();
    const navigate = useNavigate();
    const { handle: currentHandle } = useHybridflow();
    const [nameDialog, openNameDialog] = useState<NameDialog | null>(null);
    const [movingBoard, setMovingBoard] = useState(false);
    const [downloading, setDownloading] = useState<ReadonlySet<string>>(() => new Set());
    const [importing, setImporting] = useState(false);
    const [exportingCsv, setExportingCsv] = useState(false);

    useEffect(connectList, [connectList]);

    const closeNameDialog = useCallback(() => openNameDialog(null), []);

    const saveName = useCallback(async (name: string) => {
        if (!client || !nameDialog) return false;
        if (name === nameDialog.item?.name) return;
        try {
            let createdSlug: string | undefined;
            if (nameDialog.kind === 'board') {
                if (nameDialog.item) await client.renameBoard(nameDialog.item.slug, name);
                else {
                    const { board } = await client.createBoard(name, nameDialog.folder?.id);
                    if (board.folderId) expandFolder(board.folderId);
                    createdSlug = board.slug;
                }
            } else if (nameDialog.item) {
                await client.renameBoardFolder(nameDialog.item.id, name);
            } else {
                await client.createBoardFolder(name);
            }
            reload();
            if (createdSlug) navigate(boardUrl(createdSlug));
        } catch (cause) {
            const { kind, item } = nameDialog;
            const taken = cause instanceof HybridflowError && cause.status === 409;
            throw new Error(taken
                ? `There is already a ${kind} called “${name}”.`
                : `The ${kind} could not be ${item ? 'renamed' : 'created'}: ${cause instanceof Error ? cause.message : cause}`);
        }
    }, [client, nameDialog, expandFolder, reload, navigate]);

    const moveBoard = useCallback(async (board: BoardSummary, folderId: string) => {
        if (!client || movingBoard || folderId === (board.folderId ?? '')) return;
        setMovingBoard(true);
        try {
            await client.moveBoard(board.slug, folderId, board.revision);
            message.success(`Board “${board.name}” moved.`);
        } catch (cause) {
            const changed = cause instanceof HybridflowError && cause.status === 409;
            message.error(changed ? 'The board changed. Choose its destination again.'
                : `The board could not be moved: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            reload();
            setMovingBoard(false);
        }
    }, [client, movingBoard, reload]);

    const confirm = useConfirmation();
    const askDelete = useCallback((board: BoardSummary) => {
        if (!client) return;
        confirm({
            title: `Delete “${board.name}”?`,
            description: 'This also deletes its flow nodes and workflows.',
            onConfirm: async () => {
                try {
                    await client.deleteBoard(board.slug);
                } catch (cause) {
                    message.error(`The board could not be deleted: ${cause instanceof Error ? cause.message : cause}`);
                } finally {
                    reload();
                }
            },
        });
    }, [client, confirm, reload]);

    const askDeleteFolder = useCallback((folder: FolderDto) => {
        if (!client) return;
        confirm({
            title: `Delete folder “${folder.name}”?`,
            description: 'Boards in this folder will move to the top level.',
            onConfirm: async () => {
                try {
                    await client.deleteBoardFolder(folder.id);
                    forgetFolder(folder.id);
                } catch (cause) {
                    message.error(`The folder could not be deleted: ${cause instanceof Error ? cause.message : cause}`);
                } finally {
                    reload();
                }
            },
        });
    }, [client, confirm, forgetFolder, reload]);

    const download = useCallback(async (board: BoardSummary) => {
        if (!client || downloading.has(board.slug)) return;
        setDownloading(held => new Set(held).add(board.slug));
        try {
            const detail = await client.board(board.slug);
            downloadTextFile(boardArchiveFilename(board.slug), boardArchiveText(detail));
        } catch (cause) {
            message.error(`The board could not be downloaded: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setDownloading(held => {
                const next = new Set(held);
                next.delete(board.slug);
                return next;
            });
        }
    }, [client, downloading]);

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
            reload();
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
    }, [client, navigate, reload]);

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

    const value = useMemo(() => ({
        nameDialog, openNameDialog, closeNameDialog, saveName,
        moveBoard, movingBoard, askDelete, askDeleteFolder, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    }), [
        nameDialog, closeNameDialog, saveName,
        moveBoard, movingBoard, askDelete, askDeleteFolder, download, downloading, importFile, importing,
        exportArchivedCsv, exportingCsv, currentHandle,
    ]);

    return <BoardsListContext.Provider value={value}>{children}</BoardsListContext.Provider>;
};
