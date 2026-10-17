import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Modal, Spin, Switch, message } from 'antd';
import {
    DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined, TableOutlined,
    UploadOutlined,
} from '@ant-design/icons';
import { BOARDS_PREFIX, boardUrl, handleOf } from '../boardRoute';
import {
    boardArchiveFilename, boardArchiveText, downloadTextFile, importBoardArchive, readBoardArchive,
    readFileText,
} from '../boardArchive';
import { ARCHIVED_FLOW_NODES_CSV_FILENAME, fetchArchivedFlowNodesCsv } from '../archivedFlowNodesCsv';
import { BoardSummary, useHybridflowClient, HybridflowError } from '../service';
import { Tooltip } from '@cms-core';
import iconImg from '../hybridflow.svg';
import styles from './BoardsList.module.css';

/**
 * **The boards, and the way in to each of them.**
 *
 * It exists because a board stopped being a file. A file is found in the file browser, which every
 * document of the store shares; a row in a database is found nowhere unless something lists it. So
 * this is the boards' own browser — the lateral panel the `...` menu opens, and the page every
 * board's URL hangs under.
 *
 * It is deliberately thin. A board's name, its handle, when it was last touched, and a link: a list
 * you cross on the way somewhere rather than a place to spend time. What a board *is* is on the
 * board. The one thing it manages besides the way in is the boards themselves — made here, renamed
 * here, downloaded here, and deleted here, each row carrying the three gestures a board answers to.
 *
 * Drawn twice, from this one component: the central page and the lateral panel. The panel is the
 * compact face — no title of its own, and neither the handle nor the hour, which a column's width
 * has no room for.
 */
export const BoardsList: React.FC<{ compact?: boolean }> = ({ compact }) => {
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
    const fileRef = useRef<HTMLInputElement>(null);

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
    const ordered = useMemo(
        () => [...(boards ?? [])].sort((a, b) => (compact
            ? a.name.localeCompare(b.name)
            : b.updatedAt.localeCompare(a.updatedAt))),
        [boards, compact],
    );

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

    return (
        <>
            <div className={compact ? styles.panel : styles.page}
                data-testid={compact ? 'boards-panel' : 'boards-page'}>
                <div className={styles.header}>
                    {!compact && <span className={styles.title}>Boards</span>}
                    <span className={styles.spacer} />
                    <Tooltip title="Show the boards that have been put away">
                        <span className={styles.when}>
                            <Switch size="small" checked={showArchived} onChange={setShowArchived} /> Archived
                        </span>
                    </Tooltip>
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}
                        disabled={loading || !client} aria-label="Reload the boards" />
                    <Button size="small" icon={<UploadOutlined />}
                        onClick={() => fileRef.current?.click()} disabled={!client} loading={importing}>
                        Import
                    </Button>
                    {/* The file behind the Import button: shown never, reset after every pick so
                        the same file can be picked twice. */}
                    <input ref={fileRef} type="file" accept=".json,application/json" hidden
                        data-testid="import-board-input"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void importFile(file);
                        }} />
                    <Tooltip title="Export archived flow nodes (.csv)">
                        <Button size="small" icon={<TableOutlined />}
                            onClick={() => void exportArchivedCsv()}
                            disabled={!client} loading={exportingCsv}
                            aria-label="Export archived flow nodes"
                            data-testid="export-archived-flow-nodes" />
                    </Tooltip>
                    <Button size="small" type="primary" icon={<PlusOutlined />}
                        onClick={() => setCreating(true)} disabled={!client}>
                        New board
                    </Button>
                </div>

                {!client ? (
                    <Alert type="info" showIcon
                        message="No hybridflow store"
                        description={'This instance is not configured to reach one, so it has no boards to list. '
                            + 'The boards live in a database served by operation/hybridflow-store.'} />
                ) : error ? (
                    <Alert type="error" showIcon
                        message="The boards could not be read"
                        description={error}
                        action={<Button size="small" onClick={() => void load()}>Try again</Button>} />
                ) : boards === null ? (
                    <Spin />
                ) : ordered.length === 0 ? (
                    <p className={styles.empty}>
                        No boards yet. A board is a place to lay out the work you are doing — a card per
                        flowNode, chained to what comes after it — and a card can be played by an agent.
                    </p>
                ) : (
                    <div className={styles.list}>
                        {ordered.map(board => {
                            const selected = currentHandle !== null && currentHandle === board.slug;
                            return (
                            // The row is a box with a link in it rather than a link with buttons
                            // in it: a button inside an anchor is invalid HTML, and the three
                            // gestures a row answers to must not navigate anywhere.
                            <div key={board.id}
                                className={`${styles.row} ${board.archived ? styles.archived : ''} ${selected ? styles.selected : ''}`}
                                data-testid={`board-row-${board.slug}`}>
                                <Link to={boardUrl(board.slug)} className={styles.main}
                                    aria-current={selected ? 'page' : undefined}>
                                    <img src={iconImg} className={styles.icon} alt="" />
                                    <span className={styles.name}>{board.name}</span>
                                    {!compact && (
                                        <>
                                            <span className={styles.slug}>/{board.slug}</span>
                                            <span className={styles.spacer} />
                                            <span className={styles.when}>{whenOf(board.updatedAt)}</span>
                                        </>
                                    )}
                                </Link>
                                <span className={styles.actions}>
                                    <Tooltip title="Download this board">
                                        <Button type="text" size="small" icon={<DownloadOutlined />}
                                            aria-label={`Download board “${board.name}”`}
                                            data-testid={`download-board-${board.slug}`}
                                            loading={downloading === board.slug}
                                            onClick={() => void download(board)} />
                                    </Tooltip>
                                    <Tooltip title="Rename this board">
                                        <Button type="text" size="small" icon={<EditOutlined />}
                                            aria-label={`Rename board “${board.name}”`}
                                            data-testid={`rename-board-${board.slug}`}
                                            onClick={() => {
                                                setRenaming(board);
                                                setRenameTo(board.name);
                                            }} />
                                    </Tooltip>
                                    <Tooltip title="Delete this board">
                                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                            aria-label={`Delete board “${board.name}”`}
                                            data-testid={`delete-board-${board.slug}`}
                                            onClick={() => askDelete(board)} />
                                    </Tooltip>
                                </span>
                            </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <Modal open={creating} title="New board" okText="Create"
                onOk={() => void create()} onCancel={() => { setCreating(false); setNewName(''); }}
                okButtonProps={{ disabled: newName.trim() === '' }}>
                <Input autoFocus value={newName} placeholder="What the board is about"
                    onChange={event => setNewName(event.target.value)}
                    onPressEnter={() => void create()} />
            </Modal>

            <Modal open={renaming !== null} title={renaming ? `Rename “${renaming.name}”` : 'Rename board'}
                okText="Rename" onOk={() => void rename()} onCancel={closeRename}
                okButtonProps={{ disabled: renameTo.trim() === '' }}>
                <Input autoFocus value={renameTo} placeholder="What the board is about"
                    aria-label="Board name"
                    onChange={event => setRenameTo(event.target.value)}
                    onPressEnter={() => void rename()} />
                {/* The question every rename is asked: a board keeps its handle, so a link to it —
                    a bookmark, a pasted URL, another tab — still opens it afterwards. */}
                {renaming && (
                    <p className={styles.renameNote}>
                        The board stays at /boards/{renaming.slug} — a rename moves nothing.
                    </p>
                )}
            </Modal>
        </>
    );
};

/** When it was last touched, as a person reads it. */
const whenOf = (iso: string): string => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    return at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
