import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from 'src/test/render';
import { FileDto } from 'src/core/files/service';
import { readDraggedFiles } from '../dnd/dragPaths';
import { FileTreeRow } from './fileTreeModel';

const h = vi.hoisted(() => ({
    coarse: false,
    browsing: { currentPath: '', currentFile: null as FileDto | null },
    rows: [] as FileTreeRow[],
    settling: false,
    toggle: vi.fn(),
    expandTo: vi.fn(),
}));

vi.mock('./useFileTree', () => ({
    useFileTree: () => ({ rows: h.rows, settling: h.settling, toggle: h.toggle, expandTo: h.expandTo }),
}));
vi.mock('../core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => h.browsing,
}));
// Row chrome is mocked; rows are plain DOM nodes here.
vi.mock('react-advanced-interactions', async () => ({
    Pointable: (await import('src/test/mocks')).Children,
}));
vi.mock('../context-menu/RowContextMenu', async () => ({
    RowContextMenu: (await import('src/test/mocks')).Children,
}));
// SilentLink is a plain span; the test id finds the row.
vi.mock('../core/SilentLink-cmp', () => ({
    SilentLink: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) =>
        <span {...rest}>{children}</span>,
}));
vi.mock('../core/FileLabelSwitch-cmp', () => ({
    FileLabelSwitch: ({ file }: { file: FileDto }) => <span>{file.path}</span>,
}));
// Default is a fine pointer; the coarse case is below.
vi.mock('../../ui-foundation/interactions/useLongPress', () => ({ useIsCoarsePointer: () => h.coarse }));

import { FileTreeCmp } from './FileTree-cmp';
import { RevealInTreeProvider, useRevealInTree } from './RevealInTree-ctx';

const row = (path: string, over: Partial<FileTreeRow> = {}): FileTreeRow => ({
    path,
    file: { path, isDirectory: false, size: 0, lastModified: 0 },
    depth: 1,
    expandable: false,
    expanded: false,
    isRoot: false,
    ...over,
});

const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

/** jsdom lays nothing out, so scrolling into view is only observable as the call. */
type ScrollIntoView = typeof Element.prototype.scrollIntoView;
let scrollIntoView: Mock<ScrollIntoView>;

/** Pane height for layout cases. */
const PANE_HEIGHT = 100;
const ROW_HEIGHT = 20;

const noLayout = Element.prototype.getBoundingClientRect;

// Lays out the pane and the current row; unlaid boxes measure zero.
const layOut = (rowTop: number) => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
        return (this.hasAttribute('data-current-row')
            ? { top: rowTop, bottom: rowTop + ROW_HEIGHT, height: ROW_HEIGHT }
            : { top: 0, bottom: PANE_HEIGHT, height: PANE_HEIGHT }) as DOMRect;
    };
};

describe('FileTreeCmp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        scrollIntoView = vi.fn<ScrollIntoView>();
        Element.prototype.scrollIntoView = scrollIntoView;
        Element.prototype.getBoundingClientRect = noLayout;
        h.browsing = { currentPath: '', currentFile: null };
        h.rows = [];
        h.settling = false;
    });

    it('brings the open document into view once its branch is drawn', () => {
        h.browsing = { currentPath: 'units/fr', currentFile: file('units/fr/a.md') };
        h.rows = [row('units'), row('units/fr')];

        const { rerender } = render(<FileTreeCmp />);
        expect(scrollIntoView).not.toHaveBeenCalled();

        h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];
        rerender(<FileTreeCmp />);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    // Fresh load fills branch by branch; the row can shift as listings land.
    it('keeps up with the open document until the tree has stopped filling', () => {
        h.settling = true;
        h.browsing = { currentPath: 'units/fr', currentFile: file('units/fr/a.md') };
        h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];

        const { rerender } = render(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        h.rows = [row('docs'), row('docs/read.me', { depth: 2 }), ...h.rows];
        rerender(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(2);

        h.settling = false;
        rerender(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(3);

        h.rows = [...h.rows, row('docs/notes.md', { depth: 2 })];
        rerender(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(3);
    });

    it('leaves the pane where it is when a branch is opened', () => {
        h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
        h.rows = [row('units'), row('units/a.md'), row('docs')];

        const { rerender } = render(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        h.rows = [...h.rows, row('docs/read.me', { depth: 2 })];
        rerender(<FileTreeCmp />);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('follows the document on screen when another one is opened', () => {
        h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
        h.rows = [row('units'), row('units/a.md'), row('units/b.md')];

        const { rerender } = render(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        h.browsing = { currentPath: 'units', currentFile: file('units/b.md') };
        rerender(<FileTreeCmp />);

        expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    // Reveal centres an off-screen row.
    describe('landing on a document the pane was not showing', () => {
        beforeEach(() => {
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];
        });

        it('centres a row below the fold', () => {
            layOut(PANE_HEIGHT + 40);

            render(<FileTreeCmp />);

            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        });

        it('centres a row the pane is only showing half of', () => {
            layOut(PANE_HEIGHT - ROW_HEIGHT / 2);

            render(<FileTreeCmp />);

            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        });

        // A fully visible row must not scroll on click.
        it('leaves the pane alone for a row it is already showing whole', () => {
            layOut(30);

            render(<FileTreeCmp />);

            expect(scrollIntoView).not.toHaveBeenCalled();
        });
    });

    describe('asked to show the open document', () => {
        it('goes back to it although it was already shown once', () => {
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];

            const { rerender } = render(<FileTreeCmp revealRequest={0} />);
            expect(scrollIntoView).toHaveBeenCalledTimes(1);

            rerender(<FileTreeCmp revealRequest={1} />);

            expect(scrollIntoView).toHaveBeenCalledTimes(2);
            expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        });

        // Reveal centres even a fully visible row.
        it('centres a row the pane is already showing whole', () => {
            layOut(30);
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];

            const { rerender } = render(<FileTreeCmp revealRequest={0} />);
            expect(scrollIntoView).not.toHaveBeenCalled();

            rerender(<FileTreeCmp revealRequest={1} />);

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        });

        it('opens the way down to it, and waits for the row to be drawn', () => {
            // The branch was closed by hand, so the open document has no row to show.
            h.browsing = { currentPath: 'units/fr', currentFile: file('units/fr/a.md') };
            h.rows = [row('units')];

            const { rerender } = render(<FileTreeCmp revealRequest={0} />);
            // Reopening sets settling while rows are still pending.
            h.settling = true;
            rerender(<FileTreeCmp revealRequest={1} />);

            expect(h.expandTo).toHaveBeenCalledWith('units/fr');
            expect(scrollIntoView).not.toHaveBeenCalled();

            h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];
            h.settling = false;
            rerender(<FileTreeCmp revealRequest={1} />);

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
        });

        it('leaves the pane alone until it is asked', () => {
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];

            const { rerender } = render(<FileTreeCmp revealRequest={3} />);
            expect(scrollIntoView).toHaveBeenCalledTimes(1); // the once-per-document one

            h.rows = [...h.rows, row('docs')];
            rerender(<FileTreeCmp revealRequest={3} />);

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(h.expandTo).not.toHaveBeenCalled();
        });
    });

    // Reveal for a path named elsewhere in the app.
    describe('asked to show a document from elsewhere in the app', () => {
        const Asking: React.FC<{ path: string }> = ({ path }) => {
            const { reveal } = useRevealInTree();
            return <button data-testid="ask" onClick={() => reveal(path)}>ask</button>;
        };

        const pane = (asked: string) => (
            <RevealInTreeProvider>
                <Asking path={asked} />
                <FileTreeCmp />
            </RevealInTreeProvider>
        );

        const showPane = (asked: string) => render(pane(asked));

        it('opens the way down to the folder holding it, and waits for the row', () => {
            // Nothing is open, so nothing the pane does here is about the open document.
            h.rows = [row('units')];

            showPane('units/fr/a.md');
            fireEvent.click(screen.getByTestId('ask'));

            // Expands only to the containing folder, not into the file row.
            expect(h.expandTo).toHaveBeenCalledWith('units/fr');
            expect(h.expandTo).not.toHaveBeenCalledWith('units/fr/a.md');
            expect(scrollIntoView).not.toHaveBeenCalled();

            h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];
            fireEvent.click(screen.getByTestId('ask'));

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        });

        it('marks the row it was asked for, the open document being marked another way', () => {
            h.rows = [row('units'), row('units/a.md')];

            showPane('units/a.md');
            fireEvent.click(screen.getByTestId('ask'));

            expect(rowOf('units/a.md')).toHaveClass('cms-nav-tree-row-flash');
        });

        // A stale reveal for a missing path must not block following the open document.
        it('lets go of a path the store does not hold, and follows the document again', () => {
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];

            const { rerender } = showPane('units/gone.md');
            fireEvent.click(screen.getByTestId('ask'));
            expect(scrollIntoView).toHaveBeenCalledTimes(1); // the open document, on the way in

            h.browsing = { currentPath: 'units', currentFile: file('units/b.md') };
            h.rows = [...h.rows, row('units/b.md')];
            rerender(pane('units/gone.md'));

            expect(scrollIntoView).toHaveBeenCalledTimes(2);
        });

        // A reveal handled by one pane must not replay in the next pane.
        it('is taken in hand once, and not answered again by the next pane', () => {
            h.rows = [row('units'), row('units/a.md')];

            const { unmount } = showPane('units/a.md');
            fireEvent.click(screen.getByTestId('ask'));
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            unmount();

            render(<FileTreeCmp />);

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
        });
    });
});

// jsdom has no DataTransfer; this stand-in stores type/value pairs.
const dataTransfer = () => {
    const store: Record<string, string> = {};
    return {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
    } as unknown as DataTransfer;
};

const rowOf = (path: string) =>
    screen.getByTestId(`nav-item-${path}`).closest('.cms-nav-tree-row') as HTMLElement;

// Drag payload shape is pinned by dragPaths tests.
describe('dragging a row out of the tree', () => {
    beforeEach(() => { h.coarse = false; });

    it('carries the file the row names', () => {
        h.rows = [row('units/abc/cadre.md')];
        render(<FileTreeCmp />);

        const data = dataTransfer();
        fireEvent.dragStart(rowOf('units/abc/cadre.md'), { dataTransfer: data });

        expect(readDraggedFiles(data)).toEqual([{ path: 'units/abc/cadre.md', isDirectory: false }]);
    });

    it('says a folder is one, which is what a box asking for a folder reads', () => {
        h.rows = [row('units', { file: { path: 'units', isDirectory: true, size: 0, lastModified: 0 } })];
        render(<FileTreeCmp />);

        const data = dataTransfer();
        fireEvent.dragStart(rowOf('units'), { dataTransfer: data });

        expect(readDraggedFiles(data)).toEqual([{ path: 'units', isDirectory: true }]);
    });

    // Root row is not draggable; the store root is entered as `/`.
    it('leaves the root row where it is', () => {
        h.rows = [row('', { isRoot: true, depth: 0 })];
        render(<FileTreeCmp />);
        expect(rowOf('root')).not.toHaveAttribute('draggable', 'true');
    });

    // On touch, long-press opens the menu, so rows are not draggable.
    it('leaves every row alone on a touch screen', () => {
        h.coarse = true;
        h.rows = [row('units/abc/cadre.md')];
        render(<FileTreeCmp />);
        expect(rowOf('units/abc/cadre.md')).not.toHaveAttribute('draggable', 'true');
    });
});
