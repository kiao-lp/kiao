import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Spin } from 'antd';
import { CheckOutlined, DeleteOutlined, DownOutlined, EditOutlined, ReloadOutlined, RightOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { ConfiguredMarkdown, extractName, internalPathOf, resolveInternalLink, useFileBrowsingPersistenceContext, useGlobalViewState, Tooltip } from '@cms-core';
import { ReorderHandle, type Reorderable, useReorderable } from '@cms-kit/reorder';
import { BookmarkPatch, useBookmarks } from './Bookmarks-ctx';
import { Bookmark, indexOfPath } from './bookmarksFile';
import styles from './Bookmarks.module.css';

/** What a bookmark on this document is called to begin with. The store root has no name of its own. */
const nameOfPath = (path: string): string => extractName(path) || '/';

/** Where the row at `rank` ends up once the one at `index` is taken out — or nowhere, when it is that one. */
const rankAfterRemove = (rank: number, index: number): number | null =>
    rank === index ? null : rank > index ? rank - 1 : rank;

/**
 * Where the row at `rank` ends up once the one at `from` has been dropped at `to`.
 *
 * The moved one lands on `to` by definition; every other one is pushed by exactly the one place
 * the move opens or closes, and only when it stands between the two ranks.
 */
const rankAfterMove = (rank: number, from: number, to: number): number => {
    if (rank === from) return to;
    if (from < rank && rank <= to) return rank - 1;
    if (to <= rank && rank < from) return rank + 1;
    return rank;
};

/** What the view state says is open, read forgivingly: anything unexpected is nothing open. */
const readOpen = (stored: unknown): number[] =>
    Array.isArray(stored) ? stored.filter((rank): rank is number => Number.isInteger(rank) && rank >= 0) : [];

/** The title, the link and the note, each in its own box, written as they are typed. */
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

/** One bookmark: the caret it opens by, the grip it is dragged by, and a link to what it points at. */
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
    // A link out of the store is the one that must not replace the app: everything else is a
    // router navigation, which InternalLinkNavigator makes of any anchor pointing inside it.
    const href = bookmark.link ? resolveInternalLink(bookmark.link) : '';
    const external = href !== '' && internalPathOf(href) === null;

    return (
        <div
            {...reorder.rowProps(index, styles.row)}
            data-testid="bookmark"
        >
            <div className={styles.rowHead}>
                <Tooltip title={open ? 'Close the note' : 'Open the note'}>
                    <Button
                        size="small"
                        type="text"
                        icon={open ? <DownOutlined /> : <RightOutlined />}
                        aria-label={`${open ? 'Close' : 'Open'} the note of ${label}`}
                        aria-expanded={open}
                        data-testid="toggle-note"
                        onClick={onToggle}
                    />
                </Tooltip>
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
                    // A bookmark pointing nowhere goes nowhere; its note still opens, and that is
                    // where the link is put back.
                    <span className={styles.rowLink}>
                        <span className={styles.rowName}>{label}</span>
                    </span>
                )}
                <Tooltip title="Edit the bookmark">
                    <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit ${label}`}
                        data-testid="edit-bookmark"
                        onClick={onEdit}
                    />
                </Tooltip>
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

/**
 * The bookmarks of the store, as a flat list, each opening in place on its note.
 *
 * The star bookmarks whatever the browser is on — a document, or a folder — and takes it back out
 * when it is already there, which is the whole of what the panel does to the list without being
 * asked. Everything else is the file: a bookmark is an entry of `kiao-user-config/bookmarks.json`,
 * with its title, its link and its note each in its own field.
 *
 * A row opens like a folder of the file tree — the caret before its name — and is closed until it
 * is opened. What an open row shows is the note, rendered as markdown; the ✎ beside it is the way
 * into the title, the link and the note themselves.
 *
 * The list is ordered by hand: a row is dragged by its grip, or moved from the keyboard once that
 * grip has focus, and where it lands is where its entry lands in the file.
 */
export const BookmarksPanel: React.FC = () => {
    const { bookmarks, loading, add, update, remove, move, ensureLoaded, reload } = useBookmarks();
    const { currentFile } = useFileBrowsingPersistenceContext();

    // The rows whose note is showing, by rank — empty, until a caret is opened. A row being
    // edited is open by definition; closing its caret ends the edit along with the view.
    //
    // Kept in the view state rather than in the panel: the panel lives in a tool bar, which
    // every navigation between documents replaces, so a panel-owned set would close every note
    // on the way to the very document the user navigated to. In the view state — the same one
    // the file tree keeps its open branches in — a note left open is still open after a
    // navigation, and after leaving the dashboard and coming back.
    const [view, setView] = useGlobalViewState('bookmarks', { open: [] as number[] });
    const open = useMemo(() => new Set(readOpen(view.open)), [view.open]);
    const setOpen = useCallback((updater: (prev: ReadonlySet<number>) => ReadonlySet<number>) => {
        setView(prev => ({ ...prev, open: [...updater(new Set(readOpen(prev.open)))] }));
    }, [setView]);
    const [editing, setEditing] = useState<number | null>(null);

    // The list is read the first time the panel is looked at, not when the app starts: the tab may
    // well never be opened, and the file is the store's to be spared a read nobody asked for.
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    // The order of the list is the order of the entries in the file, so a drop rewrites the file.
    const reorder = useReorderable({ count: bookmarks.length, onMove: handleMove });

    const path = currentFile?.path ?? null;
    const bookmarked = path === null ? -1 : indexOfPath(bookmarks, path);

    function handleMove(from: number, to: number): void {
        move(from, to);
        // The rows open below are the same rows, at whatever rank the move leaves them.
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
        // At the end of the list, where it was just added — the note is what is wanted next.
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
                <Tooltip title="Read the file again">
                    <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined spin={loading} />}
                        aria-label="Read the file again"
                        onClick={reload}
                    />
                </Tooltip>
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
