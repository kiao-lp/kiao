import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from 'src/test/render';
import { FileDto } from 'src/cms-core/files/service';

const h = await vi.hoisted(async () => {
    const { createExternalStore } = await import('src/test/mocks');
    // External store backing the store-changed signal.
    const revision = createExternalStore(0);
    return {
        browsing: { currentPath: '', currentFile: null as FileDto | null },
        listing: [] as FileDto[],
        store: {} as Record<string, unknown>,
        listFiles: vi.fn(async (_path: string): Promise<FileDto[]> => []),
        subscribeToStore: revision.subscribe,
        readRevision: revision.getSnapshot,
        storeChanged: () => revision.set(revision.value + 1),
    };
});

vi.mock('../core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => h.browsing,
}));
vi.mock('../core/CurrentFileList-ctx', () => ({
    useCurrentFileListContext: () => h.listing,
    useStoreRevision: () => React.useSyncExternalStore(h.subscribeToStore, h.readRevision),
}));
vi.mock('src/cms-core/files/service/ui', () => ({
    useWorkerClient: () => ({ listFiles: h.listFiles }),
}));
// Plain-object store so tests can assert persisted state.
vi.mock('src/cms-core/view-state', () => ({
    useGlobalViewState: <T,>(key: string, fallback: T) => {
        const [state, setState] = React.useState<T>((h.store[key] as T) ?? fallback);
        return [state, (next: T | ((prev: T) => T)) => {
            setState(prev => {
                const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
                h.store[key] = value;
                return value;
            });
        }];
    },
}));

import { useFileTree } from './useFileTree';
import { NavTreeStoreProvider, useNavTreeStore } from './NavTreeStore-ctx';

const dir = (path: string, childrenCount?: number): FileDto =>
    ({ path, isDirectory: true, size: 0, lastModified: 0, childrenCount });
const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

const TreeProbe: React.FC = () => {
    const { rows, toggle, settling } = useFileTree();
    return (
        <ul>
            <li data-testid="settling">{settling ? 'settling' : 'settled'}</li>
            {rows.map(row => (
                <li key={row.path || '/'}>
                    <span data-testid={`row-${row.path || '/'}`}>{`${row.depth}:${row.path || '/'}`}</span>
                    <button onClick={() => toggle(row.path)} data-testid={`toggle-${row.path || '/'}`}>
                        {row.expanded ? 'close' : 'open'}
                    </button>
                </li>
            ))}
        </ul>
    );
};

const shownRows = () => screen.getAllByTestId(/^row-/).map(el => el.textContent);

const store = (listings: Record<string, FileDto[]>) => {
    h.listFiles.mockImplementation(async (path: string) => listings[path] ?? []);
};

describe('useFileTree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.browsing = { currentPath: '', currentFile: null };
        h.listing = [];
        h.store = {};
        h.listFiles.mockImplementation(async () => []);
    });

    it('takes the open folder from the file browser rather than listing it again', async () => {
        h.listing = [dir('units'), file('read.me')];

        render(<TreeProbe />);

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units', '1:read.me']));
        expect(h.listFiles).not.toHaveBeenCalled();
    });

    it('reads a branch when it is opened, and forgets it when it is closed', async () => {
        h.listing = [dir('units')];
        store({ units: [file('units/index.md'), dir('units/fr')] });

        render(<TreeProbe />);
        await waitFor(() => expect(screen.getByTestId('toggle-units')).toBeTruthy());

        fireEvent.click(screen.getByTestId('toggle-units'));

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units', '2:units/fr', '2:units/index.md']));
        expect(h.listFiles).toHaveBeenCalledWith('units');

        fireEvent.click(screen.getByTestId('toggle-units'));

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units']));
    });

    it('reads a branch again each time it is opened', async () => {
        h.listing = [dir('units')];
        store({ units: [file('units/index.md')] });

        render(<TreeProbe />);
        await waitFor(() => expect(screen.getByTestId('toggle-units')).toBeTruthy());

        fireEvent.click(screen.getByTestId('toggle-units'));
        await waitFor(() => expect(shownRows()).toContain('2:units/index.md'));
        fireEvent.click(screen.getByTestId('toggle-units'));

        store({ units: [file('units/index.md'), file('units/added.md')] });
        fireEvent.click(screen.getByTestId('toggle-units'));

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units', '2:units/added.md', '2:units/index.md']));
    });

    it('opens the tree down to the folder being browsed', async () => {
        h.browsing = { currentPath: 'units/fr', currentFile: dir('units/fr') };
        h.listing = [file('units/fr/greetings.mlunit.json')];
        store({
            '': [dir('units')],
            units: [dir('units/fr')],
        });

        render(<TreeProbe />);

        await waitFor(() => expect(shownRows()).toEqual([
            '0:/', '1:units', '2:units/fr', '3:units/fr/greetings.mlunit.json',
        ]));
    });

    // `settling` tells the pane when row positions are final.
    it('reports the tree as settling until every open branch has been read', async () => {
        h.browsing = { currentPath: 'units/fr', currentFile: dir('units/fr') };
        h.listing = [file('units/fr/greetings.mlunit.json')];
        store({
            '': [dir('units')],
            units: [dir('units/fr')],
        });

        render(<TreeProbe />);

        expect(screen.getByTestId('settling').textContent).toBe('settling');
        await waitFor(() => expect(screen.getByTestId('settling').textContent).toBe('settled'));
        expect(shownRows()).toEqual(['0:/', '1:units', '2:units/fr', '3:units/fr/greetings.mlunit.json']);
    });

    it('remembers what is open for the next session', async () => {
        h.listing = [dir('units')];
        store({ units: [] });

        render(<TreeProbe />);
        await waitFor(() => expect(screen.getByTestId('toggle-units')).toBeTruthy());
        fireEvent.click(screen.getByTestId('toggle-units'));

        await waitFor(() => expect(h.store.navTree).toEqual({ expanded: ['', 'units'] }));
    });

    // Expansion must survive a pane remount.
    describe('across a remount', () => {
        const Pane: React.FC<{ shown: boolean }> = ({ shown }) => (
            <NavTreeStoreProvider>{shown ? <TreeProbe /> : null}</NavTreeStoreProvider>
        );

        const remount = (rerender: (ui: React.ReactElement) => void) => {
            rerender(<Pane shown={false} />);
            rerender(<Pane shown />);
        };

        const openTree = async () => {
            h.browsing = { currentPath: 'units', currentFile: dir('units') };
            h.listing = [dir('units/fr')];
            store({ '': [dir('units')] });

            const view = render(<Pane shown />);
            await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units', '2:units/fr']));
            h.listFiles.mockClear();
            return view;
        };

        it('draws the same tree on its first frame', async () => {
            const { rerender } = await openTree();

            remount(rerender);

            expect(shownRows()).toEqual(['0:/', '1:units', '2:units/fr']);
        });

        it('reads what it shows again, in place', async () => {
            const { rerender } = await openTree();

            remount(rerender);

            // Root is re-read; the open folder uses the browser listing.
            await waitFor(() => expect(h.listFiles).toHaveBeenCalledWith(''));
            expect(h.listFiles).toHaveBeenCalledTimes(1);
            expect(shownRows()).toEqual(['0:/', '1:units', '2:units/fr']);
        });
    });

    // The store-changed signal covers folders outside the browsed folder.
    it('reads the folder a file operation changed when the browser is on another one', async () => {
        h.browsing = { currentPath: 'units', currentFile: dir('units') };
        h.listing = [file('units/index.md')];
        store({ '': [dir('docs'), dir('units')], docs: [file('docs/old.md')] });

        render(<TreeProbe />);
        await waitFor(() => expect(screen.getByTestId('toggle-docs')).toBeTruthy());
        fireEvent.click(screen.getByTestId('toggle-docs'));
        await waitFor(() => expect(shownRows()).toContain('2:docs/old.md'));

        store({ '': [dir('docs'), dir('units')], docs: [file('docs/new.md')] });
        act(() => h.storeChanged());

        await waitFor(() => expect(shownRows()).toEqual([
            '0:/', '1:docs', '2:docs/new.md', '1:units', '2:units/index.md',
        ]));
    });

    it('leaves a closed branch alone when the store changes', async () => {
        h.listing = [dir('units')];
        store({ units: [file('units/index.md')] });

        render(<TreeProbe />);
        await waitFor(() => expect(screen.getByTestId('toggle-units')).toBeTruthy());
        h.listFiles.mockClear();

        act(() => h.storeChanged());

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units']));
        expect(h.listFiles).not.toHaveBeenCalled();
    });

    it('ignores a listing that still belongs to the folder just left', async () => {
        h.browsing = { currentPath: 'units', currentFile: dir('units') };
        h.listing = [file('docs/other.md')]; // the previous folder's entries
        store({ '': [dir('units')] });

        render(<TreeProbe />);

        await waitFor(() => expect(shownRows()).toEqual(['0:/', '1:units']));
    });

    // Git focus tracks browsing; toggling moves it without navigating.
    describe('the git focus', () => {
        const FocusProbe: React.FC = () => {
            const { toggle } = useFileTree();
            const { focusedPath } = useNavTreeStore();
            return (
                <>
                    <span data-testid="focus">{focusedPath || '/'}</span>
                    <button onClick={() => toggle('units')} data-testid="toggle-units">toggle</button>
                </>
            );
        };

        const renderFocused = () => render(
            <NavTreeStoreProvider><FocusProbe /></NavTreeStoreProvider>,
        );
        const focus = () => screen.getByTestId('focus').textContent;

        it('sits on the browsed folder', async () => {
            h.browsing = { currentPath: 'units/fr', currentFile: dir('units/fr') };

            renderFocused();

            await waitFor(() => expect(focus()).toBe('units/fr'));
        });

        it('moves to a branch opened without navigating', async () => {
            h.browsing = { currentPath: '', currentFile: null };
            store({ units: [file('units/index.md')] });

            renderFocused();
            await waitFor(() => expect(focus()).toBe('/'));

            fireEvent.click(screen.getByTestId('toggle-units'));

            await waitFor(() => expect(focus()).toBe('units'));
            expect(h.browsing.currentPath).toBe('');
        });

        it('stays on a branch closed by hand', async () => {
            renderFocused();
            await waitFor(() => expect(focus()).toBe('/'));

            fireEvent.click(screen.getByTestId('toggle-units'));
            await waitFor(() => expect(focus()).toBe('units'));
            fireEvent.click(screen.getByTestId('toggle-units'));

            await waitFor(() => expect(focus()).toBe('units'));
        });

        it('tracks the browser when it moves on', async () => {
            const view = renderFocused();
            await waitFor(() => expect(focus()).toBe('/'));

            fireEvent.click(screen.getByTestId('toggle-units'));
            await waitFor(() => expect(focus()).toBe('units'));

            h.browsing = { currentPath: 'docs', currentFile: dir('docs') };
            view.rerender(<NavTreeStoreProvider><FocusProbe /></NavTreeStoreProvider>);

            await waitFor(() => expect(focus()).toBe('docs'));
        });
    });
});
