import React, { useEffect, useRef, useState } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { Pointable } from 'react-advanced-interactions';
import { parentPath } from 'src/cms-core/files/service';
import { FileLabelSwitch } from '../core/FileLabelSwitch-cmp';
import { SilentLink } from '../core/SilentLink-cmp';
import { RowContextMenu } from '../context-menu/RowContextMenu';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useIsCoarsePointer } from '../browser/useLongPress';
import { writeDraggedFiles } from '../dnd/dragPaths';
import { FileTreeRow } from './fileTreeModel';
import { useFileTree } from './useFileTree';
import { useRevealInTree } from './RevealInTree-ctx';

/** Indentation per level, in pixels — enough to read the nesting in a narrow pane. */
const INDENT = 12;

type TreeRowProps = {
    row: FileTreeRow;
    current: boolean;
    onToggle: (path: string) => void;
};

const TreeRowCmp: React.FC<TreeRowProps> = ({ row, current, onToggle }) => {
    // The expander browses the tree; it must not take the click that opens the row itself.
    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle(row.path);
    };

    // A row is dragged out of the tree to say *this file* somewhere else: into a folder to move it
    // there, into a flow node's folder box, into a description or a message where it becomes a link. The
    // whole row is the handle, the label included — a `SilentLink` is a div, not an anchor, so
    // nothing under here starts a drag of its own for this one to lose to.
    //
    // Not the root, which is a row standing for the store rather than an entry of it: there is no
    // moving it, and a box wanting the store root is given the `/` it asks for by typing.
    //
    // Not on a touch screen either, as in the file browser: the same press that would start a drag
    // is the one that opens the row's menu.
    const isCoarse = useIsCoarsePointer();
    const draggable = !row.isRoot && !isCoarse;

    return (
        <Pointable id={row.path}>
            <RowContextMenu path={row.path} isDirectory={row.file.isDirectory}>
                <div
                    className={`cms-nav-tree-row${current ? ' cms-nav-tree-row-current' : ''}`}
                    style={{ paddingLeft: 4 + row.depth * INDENT }}
                    draggable={draggable}
                    onDragStart={draggable
                        ? e => writeDraggedFiles(e.dataTransfer, [{ path: row.path, isDirectory: row.file.isDirectory }])
                        : undefined}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-expanded={row.expandable ? row.expanded : undefined}
                    data-current-row={current || undefined}
                    // How a reveal finds the row it was asked for. The root's is the empty
                    // string, which is the path it holds everywhere else too.
                    data-row-path={row.path}
                >
                    <span
                        className="cms-nav-tree-switcher"
                        onClick={row.expandable ? handleToggle : undefined}
                        data-testid={row.isRoot ? 'nav-toggle-root' : `nav-toggle-${row.path}`}
                        aria-hidden={!row.expandable}
                    >
                        {row.expandable && (row.expanded ? <DownOutlined /> : <RightOutlined />)}
                    </span>
                    <SilentLink
                        to={row.path}
                        className="cms-nav-tree-label"
                        data-testid={row.isRoot ? 'nav-item-root' : `nav-item-${row.path}`}
                    >
                        {row.isRoot
                            ? <div className="file-label cms-nav-tree-root-label">/</div>
                            : <FileLabelSwitch file={row.file} />}
                    </SilentLink>
                </div>
            </RowContextMenu>
        </Pointable>
    );
};

export type FileTreeCmpProps = {
    /**
     * How many times the pane has been asked to show where the open document is — the
     * locate button counting its own clicks. Each new count is one request; the number
     * itself means nothing, which is what lets the same document be asked for twice.
     */
    revealRequest?: number;
};

/**
 * Whether the pane is showing the row whole already. A pane nothing has laid out yet has no
 * box to answer with, and answers no: of the two wrong answers, leaving the open document
 * unshown is the one that is seen.
 */
const wholeInPane = (row: Element, pane: HTMLElement | null): boolean => {
    const paneBox = pane?.getBoundingClientRect();
    if (!paneBox?.height) return false;
    const rowBox = row.getBoundingClientRect();
    return rowBox.top >= paneBox.top && rowBox.bottom <= paneBox.bottom;
};

/**
 * The drawn row for a store path, or null while the branch holding it is still being read. The
 * rows are read rather than matched by a selector: a file name may hold a quote or a backslash,
 * and a pane never holds enough rows for the difference to be worth an escaping rule.
 */
const rowElement = (container: HTMLElement | null, path: string): HTMLElement | null =>
    Array.from(container?.querySelectorAll<HTMLElement>('[data-row-path]') ?? [])
        .find(row => row.dataset.rowPath === path) ?? null;

/** The mark on a row a reveal has just brought into view; `cms-core.css` says how it fades. */
const FLASH_CLASS = 'cms-nav-tree-row-flash';

/**
 * Says which row was the one asked for. The tree marks the open document by keeping it
 * highlighted, and a row shown on request is very often not the open document: without a mark,
 * answering a reveal is a pane that scrolls and leaves the eye to find what moved it.
 *
 * The class comes off when the animation ends, so nothing here has to be timed; taking it off
 * first, and reading the layout in between, is what restarts the animation for a row asked for
 * twice running rather than leaving the second click with nothing to show.
 */
const flash = (row: HTMLElement): void => {
    row.classList.remove(FLASH_CLASS);
    void row.offsetWidth;
    row.classList.add(FLASH_CLASS);
    row.addEventListener('animationend', () => row.classList.remove(FLASH_CLASS), { once: true });
};

/**
 * The store as a tree: every folder opens in place, and what is open stays open while
 * browsing. Clicking a row opens it — a folder in the file browser, a file in its editor —
 * which is also how the tree comes to follow the document on screen.
 */
export const FileTreeCmp: React.FC<FileTreeCmpProps> = ({ revealRequest = 0 }) => {
    const { rows, toggle, expandTo, settling } = useFileTree();
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const { request, taken } = useRevealInTree();
    const containerRef = useRef<HTMLDivElement>(null);

    // A folder is named by currentPath: the store root reports its own path as ".", and
    // would never recognise its row. See useIndexAutoOpen, which reads it the same way.
    const currentRowPath = currentFile && !currentFile.isDirectory ? currentFile.path : currentPath;

    // The row the pane has been asked for and has not shown yet. Held as state rather than in a
    // ref because taking a request is half of answering it: opening the way down changes the
    // shape of the tree, and the pass that asked for that is looking at the rows from before.
    const [pending, setPending] = useState<string | null>(null);

    // The pane goes to the open document of its own accord, once per document: a deep file
    // opened from a link or a search hit would otherwise land in a branch scrolled out of the
    // pane. The row it names may only be drawn several listings later, which is why every
    // change of shape is looked at — but opening a branch is browsing, and must leave the pane
    // where the hand put it.
    //
    // Bringing the row into view once is not enough while the tree is still filling — a
    // fresh load reads the store branch by branch, and a listing landing above the row
    // pushes it straight back out of the pane. So the document counts as shown only once
    // nothing is left to arrive; until then the pane keeps up with it.
    const shownFor = useRef<string | null>(null);
    useEffect(() => {
        // A request outstanding is the stronger claim on the pane, and it centres the row it names
        // whether or not the pane is showing it: keeping up with the open document at the same time
        // would be the pane scrolled twice for one move.
        if (pending !== null) return;
        if (shownFor.current === currentRowPath) return;
        const container = containerRef.current;
        if (!container) return;
        const row = rowElement(container, currentRowPath);
        if (!row) return;
        if (!settling) shownFor.current = currentRowPath;
        // Whenever the pane moves, it moves the row to the middle: it is the row being looked
        // for, and it reads better with the branch around it than pinned against the edge it
        // came in by. It does that only for a row it is not already showing whole — clicking a
        // row in the tree is a navigation like any other, and must not pull the tree out from
        // under the hand that clicked.
        if (!wholeInPane(row, container.parentElement)) row.scrollIntoView({ block: 'center' });
    }, [rows, settling, currentRowPath, pending]);

    // Asked outright, by the pane's own crosshair: the open document, whatever has happened
    // since — however far the pane was scrolled, and even if the branch holding it was closed by
    // hand, which is why the way down is opened again rather than merely looked for.
    const answered = useRef(revealRequest);
    useEffect(() => {
        if (answered.current === revealRequest) return;
        answered.current = revealRequest;
        setPending(currentRowPath);
        expandTo(currentPath);
    }, [revealRequest, currentRowPath, currentPath, expandTo]);

    // Asked outright from anywhere else in the app — a link in the middle of a document, the
    // folder written on a flow node — for a document that is very often not the one on screen. The
    // way down is opened as far as the folder holding it; opening the row's own branch would be
    // browsing into it, which is not what being shown where something is asks for.
    //
    // The request is taken off the context as it is taken in hand, since a pane mounting later is
    // one nobody asked anything of — see RevealInTree-ctx.
    useEffect(() => {
        if (request === null) return;
        setPending(request);
        expandTo(parentPath(request));
        taken();
    }, [request, expandTo, taken]);

    // Reading a branch back takes a listing or two, so a request stands while the tree is filling
    // — and goes on being kept in sight until it has stopped, for the same reason the open
    // document is.
    //
    // Once nothing is left to arrive and the row is still not there, the request is let go rather
    // than left standing: the path was a link to a file since deleted, or a folder typed into a
    // flow node by hand. A request that never ends is one that holds the pane off the open document
    // for the rest of the pane's life, for a row that is never coming.
    useEffect(() => {
        if (pending === null) return;
        const row = rowElement(containerRef.current, pending);
        if (!row) {
            if (!settling) setPending(null);
            return;
        }
        if (!settling) setPending(null);
        // The open document asked for outright is the open document shown: the automatic pass
        // above has nothing left to do, and would otherwise scroll the pane a second time for it.
        if (pending === currentRowPath) shownFor.current = currentRowPath;
        // Asked outright, the pane moves whether or not it is showing the row already: the
        // crosshair is clicked on a document in sight to have it centred.
        row.scrollIntoView({ block: 'center' });
        flash(row);
    }, [pending, rows, settling, currentRowPath]);

    return (
        <div className="cms-nav-tree" role="tree" ref={containerRef} data-testid="nav-tree">
            {rows.map(row => (
                <TreeRowCmp
                    key={row.path || '/'}
                    row={row}
                    current={row.path === currentRowPath}
                    onToggle={toggle}
                />
            ))}
        </div>
    );
};
