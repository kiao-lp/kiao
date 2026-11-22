import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Spin } from 'antd';
import { CheckOutlined, DeleteOutlined, DownOutlined, EditOutlined, ReloadOutlined, RightOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { ConfiguredMarkdown, extractName, internalPathOf, resolveInternalLink, useFileBrowsingPersistenceContext, useGlobalViewState } from '@kiao-dashboard-core';
import { ReorderHandle, type Reorderable, useReorderable } from '@kiao-dashboard-kit/reorder';
import { BookmarkPatch, useBookmarks } from './Bookmarks-ctx';
import { Bookmark, indexOfPath } from './bookmarksFile';
import styles from './Bookmarks.module.css';

// Store root has no name.
const nameOfPath = (path: string): string => extractName(path) || '/';

const rankAfterRemove = (rank: number, index: number): number | null =>
    rank === index ? null : rank > index ? rank - 1 : rank;

const rankAfterMove = (rank: number, from: number, to: number): number => {
    if (rank === from) return to;
    if (from < rank && rank <= to) return rank - 1;
    if (to <= rank && rank < from) return rank + 1;
    return rank;
};

// Invalid stored value: nothing open.
const readOpen = (stored: unknown): number[] =>
    Array.isArray(stored) ? stored.filter((rank): rank is number => Number.isInteger(rank) && rank >= 0) : [];

const BookmarkForm: React.FC<{
    bookmark: Bookmark;
    onUpdate: (patch: BookmarkPatch) => void;
    onDone: () => void;
    onRemove: () => void;
}> = ({ bookmark, onUpdate, onDone, onRemove }) => (
    <div className={styles.form}>
        <label className={styles.field}>
            <span className={styles.fieldName}>Title</span>
            <Input
                size="small"
                value={bookmark.title}
                aria-label="Title"
                data-testid="bookmark-title"
                onChange={event => onUpdate({ title: event.target.value })}
            />
        </label>
        <label className={styles.field}>
            <span className={styles.fieldName}>Link</span>
            <Input
                size="small"
                value={bookmark.link}
                aria-label="Link"
                data-testid="bookmark-link"
                onChange={event => onUpdate({ link: event.target.value })}
            />
        </label>
        <label className={styles.field}>
            <span className={styles.fieldName}>Note</span>
            <Input.TextArea
                size="small"
                value={bookmark.note}
                aria-label="Note"
                data-testid="bookmark-note"
                autoSize={{ minRows: 3 }}
                onChange={event => onUpdate({ note: event.target.value })}
            />
        </label>
        <div className={styles.hint}>The note is markdown.</div>
        <div className={styles.formActions}>
            <Popconfirm
                title="Delete this bookmark?"
                description="Its entry leaves the file."
                okText="Delete"
                okButtonProps={{ danger: true }}
                cancelText="Cancel"
                onConfirm={onRemove}
            >
                <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Delete bookmark"
                    data-testid="delete-bookmark"
                />
            </Popconfirm>
            <Button
                size="small"
                icon={<CheckOutlined />}
                aria-label="Done editing"
                data-testid="done-editing"
                onClick={onDone}
            >
                Done
            </Button>
        </div>
    </div>
);

const BookmarkRow: React.FC<{
    bookmark: Bookmark;
    index: number;
    open: boolean;
    editing: boolean;
    reorder: Reorderable;
    onToggle: () => void;
    onEdit: () => void;
    onDone: () => void;
    onUpdate: (patch: BookmarkPatch) => void;
    onRemove: () => void;
}> = ({ bookmark, index, open, editing, reorder, onToggle, onEdit, onDone, onUpdate, onRemove }) => {
    const label = bookmark.title || 'Untitled';
    // External links must not replace the app.
    const href = bookmark.link ? resolveInternalLink(bookmark.link) : '';
    const external = href !== '' && internalPathOf(href) === null;

    return (
        <div
            {...reorder.rowProps(index, styles.row)}
            data-testid="bookmark"
        >
            <div className={styles.rowHead}>
                <Button
                    size="small"
                    type="text"
                    icon={open ? <DownOutlined /> : <RightOutlined />}
                    aria-label={`${open ? 'Close' : 'Open'} the note of ${label}`}
                    aria-expanded={open}
                    data-testid="toggle-note"
                    onClick={onToggle}
                />
                <ReorderHandle {...reorder.handleProps(index)} label={`Move ${label}`} />
                {href ? (
                    <a
                        className={styles.rowLink}
                        href={href}
                        title={`Open ${bookmark.link}`}
                        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    >
                        <span className={styles.rowName}>{label}</span>
                    </a>
                ) : (
                    // No link: the note still opens for editing.
                    <span className={styles.rowLink}>
                        <span className={styles.rowName}>{label}</span>
                    </span>
                )}
                <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label={`Edit ${label}`}
                    data-testid="edit-bookmark"
                    onClick={onEdit}
                />
            </div>
            {open && (
                <div className={styles.noteBody}>
                    {editing ? (
                        <BookmarkForm
                            bookmark={bookmark}
                            onUpdate={onUpdate}
                            onDone={onDone}
                            onRemove={onRemove}
                        />
                    ) : bookmark.note ? (
                        <ConfiguredMarkdown revealLinkTargets={false}>
                            {bookmark.note}
                        </ConfiguredMarkdown>
                    ) : (
                        <span className={styles.hint}>No note yet.</span>
                    )}
                </div>
            )}
        </div>
    );
};

/** Bookmarks from `kiao-user-config/bookmarks.json`. The star toggles the current document or folder. */
export const BookmarksPanel: React.FC = () => {
    const { bookmarks, loading, add, update, remove, move, ensureLoaded, reload } = useBookmarks();
    const { currentFile } = useFileBrowsingPersistenceContext();

    // Open state lives in view state: the panel remounts on navigation.
    // Closing a row also ends its edit.
    const [view, setView] = useGlobalViewState('bookmarks', { open: [] as number[] });
    const open = useMemo(() => new Set(readOpen(view.open)), [view.open]);
    const setOpen = useCallback((updater: (prev: ReadonlySet<number>) => ReadonlySet<number>) => {
        setView(prev => ({ ...prev, open: [...updater(new Set(readOpen(prev.open)))] }));
    }, [setView]);
    const [editing, setEditing] = useState<number | null>(null);

    // Load on first panel view, not at app start.
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    const reorder = useReorderable({ count: bookmarks.length, onMove: handleMove });

    const path = currentFile?.path ?? null;
    const bookmarked = path === null ? -1 : indexOfPath(bookmarks, path);

    function handleMove(from: number, to: number): void {
        move(from, to);
        setOpen(prev => new Set([...prev].map(rank => rankAfterMove(rank, from, to))));
        setEditing(prev => (prev === null ? null : rankAfterMove(prev, from, to)));
    }

    const handleRemove = (index: number) => {
        remove(index);
        setOpen(prev => {
            const next = new Set<number>();
            for (const rank of prev) {
                const kept = rankAfterRemove(rank, index);
                if (kept !== null) next.add(kept);
            }
            return next;
        });
        setEditing(prev => (prev === null ? null : rankAfterRemove(prev, index)));
    };

    const handleAdd = (docPath: string) => {
        // New bookmark opens in edit mode.
        const at = add(docPath, nameOfPath(docPath));
        setOpen(prev => new Set(prev).add(at));
        setEditing(at);
    };

    const toggle = (index: number) => {
        setOpen(prev => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
                if (editing === index) setEditing(null);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    return (
        <div className={styles.panel} data-testid="bookmarks-panel">
            <div className={styles.header}>
                <Button
                    className={styles.star}
                    size="small"
                    icon={bookmarked >= 0 ? <StarFilled /> : <StarOutlined />}
                    disabled={path === null}
                    data-testid="toggle-bookmark"
                    onClick={() => (bookmarked >= 0 ? handleRemove(bookmarked) : handleAdd(path ?? ''))}
                >
                    {bookmarked >= 0 ? 'Unbookmark this document' : 'Bookmark this document'}
                </Button>
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined spin={loading} />}
                    aria-label="Read the file again"
                    onClick={reload}
                />
            </div>

            <div className={styles.list}>
                {loading && bookmarks.length === 0 && <div className={styles.center}><Spin /></div>}
                {!loading && bookmarks.length === 0 && (
                    <div className={styles.hint}>No bookmarks yet.</div>
                )}
                {bookmarks.map((bookmark, index) => (
                    <BookmarkRow
                        key={index}
                        bookmark={bookmark}
                        index={index}
                        open={open.has(index)}
                        editing={editing === index}
                        reorder={reorder}
                        onToggle={() => toggle(index)}
                        onEdit={() => {
                            setOpen(prev => new Set(prev).add(index));
                            setEditing(index);
                        }}
                        onDone={() => setEditing(null)}
                        onUpdate={patch => update(index, patch)}
                        onRemove={() => handleRemove(index)}
                    />
                ))}
            </div>
        </div>
    );
};
