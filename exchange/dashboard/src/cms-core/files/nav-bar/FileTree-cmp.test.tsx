import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from 'src/test/render';
import { FileDto } from 'src/cms-core/files/service';
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
// The chrome around a row — pointing, the context menu, the link, the label — is another
// subsystem's; here a row only has to be a DOM node the effect under test can find.
vi.mock('react-advanced-interactions', async () => ({
    Pointable: (await import('src/test/mocks')).Children,
}));
vi.mock('../context-menu/RowContextMenu', async () => ({
    RowContextMenu: (await import('src/test/mocks')).Children,
}));
// Everything but the navigating, the row's test id included: it is how a case below finds the row.
vi.mock('../core/SilentLink-cmp', () => ({
    SilentLink: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) =>
        <span {...rest}>{children}</span>,
}));
vi.mock('../core/FileLabelSwitch-cmp', () => ({
    FileLabelSwitch: ({ file }: { file: FileDto }) => <span>{file.path}</span>,
}));
// A mouse, in every case here: what a touch screen does instead is its own case, below.
vi.mock('../browser/useLongPress', () => ({ useIsCoarsePointer: () => h.coarse }));

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

/** How tall the pane is laid out below, when a case is about what it is showing. */
const PANE_HEIGHT = 100;
const ROW_HEIGHT = 20;

const noLayout = Element.prototype.getBoundingClientRect;

/**
 * Lays the pane out as a band of `PANE_HEIGHT`, with the row of the open document at
 * `rowTop` — the only two boxes read. Left unlaid, they measure zero, which is a pane the
 * component cannot tell anything from and every other case here relies on.
 */
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

        // The listing the row was waiting for lands.
        h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];
        rerender(<FileTreeCmp />);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    // A fresh load reads the store branch by branch: the row can be drawn, brought into
    // view, and pushed out again by a listing landing above it several fetches later.
    it('keeps up with the open document until the tree has stopped filling', () => {
        h.settling = true;
        h.browsing = { currentPath: 'units/fr', currentFile: file('units/fr/a.md') };
        h.rows = [row('units'), row('units/fr'), row('units/fr/a.md')];

        const { rerender } = render(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        // A branch that was still on its way lands above the document, pushing its row down.
        h.rows = [row('docs'), row('docs/read.me', { depth: 2 }), ...h.rows];
        rerender(<FileTreeCmp />);
        expect(scrollIntoView).toHaveBeenCalledTimes(2);

        // The last listing lands: the pane settles on the document and lets go of it.
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

        // Another branch is opened: the tree changes shape, the open document does not.
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

    // Landing on a document from a link or a search hit is how a row far down the tree comes
    // to be shown at all, and it arrives in the middle of the pane rather than against the
    // edge it came in by — the place the crosshair puts it.
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

        // Clicking a row in the tree opens a document like any other, and the pane must not
        // slide out from under the hand that clicked it.
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

        // The crosshair is clicked on a document in sight as well as on one that is not:
        // what it is asked for then is the centring itself.
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
            // Reopening the branch is what sets the tree filling again; the pane sees that as
            // rows still to come, which is what tells it the row it wants may yet be drawn.
            h.settling = true;
            rerender(<FileTreeCmp revealRequest={1} />);

            expect(h.expandTo).toHaveBeenCalledWith('units/fr');
            expect(scrollIntoView).not.toHaveBeenCalled();

            // The listings the reopened branch was waiting for land.
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

            // Another branch is opened: the tree changes shape, nothing was asked.
            h.rows = [...h.rows, row('docs')];
            rerender(<FileTreeCmp revealRequest={3} />);

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(h.expandTo).not.toHaveBeenCalled();
        });
    });

    // The other half of the crosshair: a document named somewhere in the app — a link in a page,
    // the folder written on a flow node — which is very often not the one on screen.
    describe('asked to show a document from elsewhere in the app', () => {
        /** What asks: anything rendered under the same provider as the pane. */
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

            // As far as the folder and no further: opening the row's own branch would be
            // browsing into it, which being shown where something is does not ask for.
            expect(h.expandTo).toHaveBeenCalledWith('units/fr');
            expect(h.expandTo).not.toHaveBeenCalledWith('units/fr/a.md');
            expect(scrollIntoView).not.toHaveBeenCalled();

            // The listings the reopened branch was waiting for land.
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

        // A link to a file since deleted, a folder typed into a flow node by hand. A request left
        // standing for a row that is never coming is one that holds the pane off the open
        // document for good — the automatic pass stands aside while one is outstanding.
        it('lets go of a path the store does not hold, and follows the document again', () => {
            h.browsing = { currentPath: 'units', currentFile: file('units/a.md') };
            h.rows = [row('units'), row('units/a.md')];

            const { rerender } = showPane('units/gone.md');
            fireEvent.click(screen.getByTestId('ask'));
            expect(scrollIntoView).toHaveBeenCalledTimes(1); // the open document, on the way in

            // Another document is opened, and the pane follows it of its own accord — which a
            // request still standing for a row that never came would have held it back from.
            h.browsing = { currentPath: 'units', currentFile: file('units/b.md') };
            h.rows = [...h.rows, row('units/b.md')];
            rerender(pane('units/gone.md'));

            expect(scrollIntoView).toHaveBeenCalledTimes(2);
        });

        // Every plugin main view brings its own pane, so opening a document of another type takes
        // this one down and mounts a new one. A request still standing then would pull the fresh
        // pane away from the document it was mounted to show.
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

// jsdom builds no DataTransfer, so the bag both ends of a drag use stands in for it.
const dataTransfer = () => {
    const store: Record<string, string> = {};
    return {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
    } as unknown as DataTransfer;
};

/** The row's own box — the node the drag is started from, inside the link and the label. */
const rowOf = (path: string) =>
    screen.getByTestId(`nav-item-${path}`).closest('.cms-nav-tree-row') as HTMLElement;

/**
 * A row of the tree is dragged out of it to say *this file* somewhere else: into a folder to move
 * it, into a flow node's folder box, into a description or a message where it becomes a link. What it
 * says is read by `dnd/dragPaths`, whose own tests are what the payload's shape is pinned by.
 */
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

    // The root row stands for the store rather than for an entry of it: there is no moving it, and
    // a box wanting the store root is told so by typing the `/` it asks for.
    it('leaves the root row where it is', () => {
        h.rows = [row('', { isRoot: true, depth: 0 })];
        render(<FileTreeCmp />);
        expect(rowOf('root')).not.toHaveAttribute('draggable', 'true');
    });

    // The same press that would start a drag is the one that opens the row's menu, so on a touch
    // screen the menu keeps it — as in the file browser.
    it('leaves every row alone on a touch screen', () => {
        h.coarse = true;
        h.rows = [row('units/abc/cadre.md')];
        render(<FileTreeCmp />);
        expect(rowOf('units/abc/cadre.md')).not.toHaveAttribute('draggable', 'true');
    });
});
