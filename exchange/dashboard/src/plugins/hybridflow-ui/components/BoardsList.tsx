import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Input, Modal, Spin } from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined } from '@ant-design/icons';
import { boardUrl } from '../boardRoute';
import { useBoardsList } from '../BoardsList-ctx';
import iconImg from '../hybridflow.svg';
import styles from './BoardsList.module.css';

/** Shared board list for the Boards panel and the Board panel's empty state. */
export const BoardsList: React.FC<{ compact?: boolean; header?: React.ReactNode }> = ({
    compact, header,
}) => {
    const {
        client, boards, error, load,
        creating, setCreating, newName, setNewName, create,
        renaming, renameTo, setRenameTo, startRename, closeRename, rename,
        askDelete, download, downloading, currentHandle,
    } = useBoardsList();

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
                ) : boards.length === 0 ? (
                    <p className={styles.empty}>
                        No boards yet. A board is a place to lay out the work you are doing — a card per
                        flowNode, chained to what comes after it — and a card can be played by an agent.
                    </p>
                ) : (
                    <div className={styles.list}>
                        {boards.map(board => {
                            const selected = currentHandle !== null && currentHandle === board.slug;
                            return (
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
                                    <Button type="text" size="small" icon={<DownloadOutlined />}
                                        aria-label={`Download board “${board.name}”`}
                                        data-testid={`download-board-${board.slug}`}
                                        loading={downloading === board.slug}
                                        onClick={() => void download(board)} />
                                    <Button type="text" size="small" icon={<EditOutlined />}
                                        aria-label={`Rename board “${board.name}”`}
                                        data-testid={`rename-board-${board.slug}`}
                                        onClick={() => startRename(board)} />
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                        aria-label={`Delete board “${board.name}”`}
                                        data-testid={`delete-board-${board.slug}`}
                                        onClick={() => askDelete(board)} />
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

                {renaming && (
                    <p className={styles.renameNote}>
                        The board stays at /boards/{renaming.slug} — a rename moves nothing.
                    </p>
                )}
            </Modal>
        </>
    );
};

const whenOf = (iso: string): string => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    return at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
