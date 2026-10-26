import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Input, Modal, Spin } from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined } from '@ant-design/icons';
import { boardUrl } from '../boardRoute';
import { useBoardsList } from '../BoardsList-ctx';
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
 * has no room for. Both forms carry their controls in the header they are handed.
 */
export const BoardsList: React.FC<{ compact?: boolean; header?: React.ReactNode }> = ({
    compact, header,
}) => {
    const {
        client, boards, ordered, error, loading, load,
        creating, setCreating, newName, setNewName, create,
        renaming, renameTo, setRenameTo, startRename, closeRename, rename,
        askDelete, download, downloading, currentHandle,
    } = useBoardsList();
    const shown = ordered(!!compact);

    return (
        <>
            <div className={compact ? styles.panel : styles.page}
                data-testid={compact ? 'boards-panel' : 'boards-page'}>
                {!compact && <span className={styles.title}>Boards</span>}
                {header}

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
                ) : shown.length === 0 ? (
                    <p className={styles.empty}>
                        No boards yet. A board is a place to lay out the work you are doing — a card per
                        flowNode, chained to what comes after it — and a card can be played by an agent.
                    </p>
                ) : (
                    <div className={styles.list}>
                        {shown.map(board => {
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
                                            onClick={() => startRename(board)} />
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
