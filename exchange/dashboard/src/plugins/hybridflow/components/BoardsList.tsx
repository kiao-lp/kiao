import React, { useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Alert, type MenuProps } from 'antd';
import {
    AppstoreOutlined, DeleteOutlined, DownloadOutlined, DownOutlined, EditOutlined, FolderOpenOutlined,
    FolderOutlined, RightOutlined,
} from '@ant-design/icons';
import { AsyncList, ContextMenu, NameDialog, dispatchContextMenuAt, useLongPress } from '@kiao-dashboard-core';
import { boardUrl } from '../boardRoute';
import { useBoardsCatalog } from '../BoardsCatalog-ctx';
import { useBoardsList } from '../BoardsList-ctx';
import type { BoardSummary, FolderDto } from '../service';
import iconImg from '../hybridflow.svg';
import styles from './BoardsList.module.css';

/** Shared board list for the Boards tab and the list at /boards. */
export const BoardsList: React.FC<{ compact?: boolean; header?: React.ReactNode }> = ({ compact, header }) => {
    const { client, catalog, error, loading, reload } = useBoardsCatalog();

    return (
        <>
            <div className={compact ? styles.panel : styles.page}
                data-testid={compact ? 'boards-panel' : 'boards-page'}>
                {!compact && <span className={styles.title}>Boards</span>}
                {header}

                {!client ? (
                    <Alert type="info" showIcon title="No hybridflow store" />
                ) : (
                    <AsyncList loading={!catalog} error={error} errorTitle="The boards list could not be read"
                        onRetry={reload} retrying={loading}
                        empty={catalog && !catalog.boards.length && !catalog.folders.length && 'No boards yet.'}>
                        {catalog && <BoardTree {...catalog} compact={compact} />}
                    </AsyncList>
                )}
            </div>
            <BoardNameDialog />
        </>
    );
};

const BoardTree: React.FC<{ boards: BoardSummary[]; folders: FolderDto[]; compact?: boolean }> = ({
    boards, folders, compact,
}) => {
    const boardsByFolder = new Map(folders.map(folder => [folder.id, [] as BoardSummary[]]));
    const topLevel: BoardSummary[] = [];
    for (const board of boards) {
        // A folder can be removed between the two list requests. Keep the board reachable.
        const group = board.folderId ? boardsByFolder.get(board.folderId) : undefined;
        (group ?? topLevel).push(board);
    }
    const rows = (list: BoardSummary[]) => list.map(board =>
        <BoardRow key={board.id} board={board} folders={folders} compact={compact} />);

    return <div className={styles.list}>
        {folders.map(folder => (
            <FolderBranch key={folder.id} folder={folder}>
                {rows(boardsByFolder.get(folder.id) ?? [])}
            </FolderBranch>
        ))}
        {rows(topLevel)}
    </div>;
};

const useRowMenuTrigger = () => {
    const suppressTouchClick = useRef(false);
    const longPress = useLongPress({
        onLongPress: event => {
            suppressTouchClick.current = true;
            dispatchContextMenuAt(event.target, event.clientX, event.clientY);
        },
    });

    return {
        ...longPress,
        'aria-haspopup': 'menu' as const,
        'aria-keyshortcuts': 'Shift+F10',
        onPointerDown: (event: React.PointerEvent) => {
            suppressTouchClick.current = false;
            longPress.onPointerDown(event);
        },
        onClickCapture: (event: React.MouseEvent) => {
            // Releasing a long press can also click the link or folder toggle.
            if (!suppressTouchClick.current || event.detail === 0) return;
            suppressTouchClick.current = false;
            event.preventDefault();
            event.stopPropagation();
        },
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
            event.preventDefault();
            const { left, bottom } = event.currentTarget.getBoundingClientRect();
            dispatchContextMenuAt(event.currentTarget, left, bottom);
        },
    };
};

const FolderBranch: React.FC<{ folder: FolderDto; children: React.ReactNode }> = ({ folder, children }) => {
    const branchId = useId();
    const { expandedFolders, toggleFolder } = useBoardsCatalog();
    const { askDeleteFolder, openNameDialog } = useBoardsList();
    const expanded = expandedFolders.has(folder.id);
    const trigger = useRowMenuTrigger();
    const items: MenuProps['items'] = [
        { key: 'create', label: 'New board', icon: <AppstoreOutlined aria-hidden="true" />,
            onClick: () => openNameDialog({ kind: 'board', folder }) },
        { type: 'divider' },
        { key: 'rename', label: 'Rename', icon: <EditOutlined aria-hidden="true" />,
            onClick: () => openNameDialog({ kind: 'folder', item: folder }) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined aria-hidden="true" />, danger: true,
            onClick: () => askDeleteFolder(folder) },
    ];

    return <div>
        <div className={styles.row}>
            <ContextMenu items={items} autoFocus>
                <button type="button" className={`${styles.rowTarget} ${styles.folderToggle}`} aria-expanded={expanded}
                    aria-controls={branchId} onClick={() => toggleFolder(folder.id)} {...trigger}>
                    <span className={styles.switcher} aria-hidden="true">
                        {expanded ? <DownOutlined /> : <RightOutlined />}
                    </span>
                    {expanded ? <FolderOpenOutlined aria-hidden="true" /> : <FolderOutlined aria-hidden="true" />}
                    <span className={styles.name}>{folder.name}</span>
                </button>
            </ContextMenu>
        </div>
        <div id={branchId} className={styles.folderContents} role="group" aria-label={folder.name} hidden={!expanded}>
            {expanded && children}
        </div>
    </div>;
};

const BoardRow: React.FC<{ board: BoardSummary; folders: FolderDto[]; compact?: boolean }> = ({
    board, folders, compact,
}) => {
    const { currentHandle, download, downloading, moveBoard, movingBoard, openNameDialog, askDelete } = useBoardsList();
    const selected = currentHandle === board.slug;
    const trigger = useRowMenuTrigger();
    const items: NonNullable<MenuProps['items']> = [
        { key: 'download', label: 'Download', icon: <DownloadOutlined aria-hidden="true" />,
            disabled: downloading.has(board.slug),
            onClick: () => void download(board) },
        { key: 'rename', label: 'Rename', icon: <EditOutlined aria-hidden="true" />,
            onClick: () => openNameDialog({ kind: 'board', item: board }) },
    ];
    if (folders.length > 0 || board.folderId) {
        items.push({
            key: 'move', label: 'Move board', icon: <FolderOpenOutlined aria-hidden="true" />, disabled: movingBoard,
            popupClassName: styles.destinations,
            children: [
                { key: 'top-level', label: 'Top level', disabled: !board.folderId,
                    onClick: () => void moveBoard(board, '') },
                ...folders.map(folder => ({ key: folder.id, label: folder.name, disabled: folder.id === board.folderId,
                    onClick: () => void moveBoard(board, folder.id) })),
            ],
        });
    }
    items.push({ key: 'delete', label: 'Delete', icon: <DeleteOutlined aria-hidden="true" />, danger: true,
        onClick: () => askDelete(board) });

    return <div className={`${styles.row} ${board.archived ? styles.archived : ''} ${selected ? styles.selected : ''}`}
        data-testid={`board-row-${board.slug}`}>
        <ContextMenu items={items} autoFocus>
            <Link to={boardUrl(board.slug)} className={`${styles.rowTarget} ${styles.boardLink}`}
                aria-current={selected ? 'page' : undefined} {...trigger}>
                <img src={iconImg} className={styles.icon} alt="" />
                <span className={styles.name}>{board.name}</span>
                {!compact && <>
                    <span className={styles.slug}>/{board.slug}</span>
                    <span className={styles.spacer} />
                    <span className={styles.when}>{whenOf(board.updatedAt)}</span>
                </>}
            </Link>
        </ContextMenu>
    </div>;
};

const BoardNameDialog: React.FC = () => {
    const { nameDialog, saveName, closeNameDialog } = useBoardsList();
    const kind = nameDialog?.kind ?? 'board';
    const item = nameDialog?.item;
    const folder = nameDialog?.kind === 'board' ? nameDialog.folder : undefined;
    const title = item ? `Rename “${item.name}”` : folder ? `New board in “${folder.name}”` : `New ${kind}`;
    const board = nameDialog?.kind === 'board' ? nameDialog.item : undefined;

    return (
        <NameDialog
            open={nameDialog !== null}
            title={title}
            label={kind === 'board' ? 'Board name' : 'Folder name'}
            okText={item ? 'Rename' : 'Create'}
            initialName={item?.name}
            placeholder={kind === 'board' ? 'What the board is about' : 'Folder name'}
            description={board && `The board stays at /boards/${board.slug}.`}
            onSubmit={saveName}
            onClose={closeNameDialog}
        />
    );
};

const whenOf = (iso: string): string => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    return at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
