import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readBookmarks } from './bookmarksFile';
import { BookmarksPanel } from './BookmarksPanel';

/**
 * The panel is the list and the star over it. What matters is that the star answers for the
 * document the browser is actually on, that a row opens in place on its note — closed until it
 * is opened — and that what is typed into the title, the link or the note reaches the file.
 */

const FILE = [
    { title: 'cadre.md', link: '/units/abc/cadre.md', note: 'the one to *copy* from.' },
    { title: 'Anthropic', link: 'https://anthropic.com', note: '' },
];

const list = vi.hoisted(() => ({
    bookmarks: [] as any[],
    loading: false,
    add: vi.fn((_path: string, _title: string) => 0),
    update: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    ensureLoaded: vi.fn(),
    reload: vi.fn(),
}));

const browsing = vi.hoisted(() => ({ currentFile: { path: 'units/abc/cadre.md' } as { path: string } | null }));

// The view-state store, as far as this panel is concerned: app-level, so what one mount writes
// the next mount reads back — that is the navigation these tests remount through.
const viewState = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('./Bookmarks-ctx', () => ({ useBookmarks: () => list }));
vi.mock('@cms-core', async importOriginal => {
    const { useState } = await import('react');
    return {
    // The real link writer: what a bookmark points at is what these tests read.
    storedLinkOf: (await importOriginal<typeof import('@cms-core')>()).storedLinkOf,
    useFileBrowsingPersistenceContext: () => browsing,
    useGlobalViewState: (key: string, fallback: any) => {
        const [state, setState] = useState(() => viewState.store[key] ?? fallback);
        const update = (next: any) => {
            const value = typeof next === 'function' ? next(viewState.store[key] ?? fallback) : next;
            viewState.store[key] = value;
            setState(value);
        };
        return [state, update];
    },
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    // The app is mounted at /dashboard/ in production; what the panel is about is which of the two
    // a link is, not where the mount point puts it.
    resolveInternalLink: (link: string) => link,
    internalPathOf: (link: string) => (link.startsWith('/') ? link : null),
    // The assertions are on the note reaching the markdown renderer, not on the renderer itself.
    ConfiguredMarkdown: ({ children }: { children: string }) => (
        <div data-testid="rendered-note">{children}</div>
    ),
    Tooltip: (await import('antd')).Tooltip,
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    viewState.store = {};
    list.bookmarks = readBookmarks(FILE);
    list.loading = false;
    browsing.currentFile = { path: 'units/abc/cadre.md' };
});

describe('BookmarksPanel', () => {
    it('lists the bookmarks, each a link to what it points at, notes closed', () => {
        render(<BookmarksPanel />);
        expect(screen.getAllByTestId('bookmark')).toHaveLength(2);
        expect(screen.getByText('cadre.md').closest('a')).toHaveAttribute('href', '/units/abc/cadre.md');
        expect(screen.queryByTestId('rendered-note')).not.toBeInTheDocument();
        expect(screen.queryByTestId('bookmark-title')).not.toBeInTheDocument();
    });

    // A link out of the store would replace the app with the site it points at.
    it('opens a link out of the store in a tab of its own', () => {
        render(<BookmarksPanel />);
        expect(screen.getByText('Anthropic').closest('a')).toHaveAttribute('target', '_blank');
        expect(screen.getByText('cadre.md').closest('a')).not.toHaveAttribute('target');
    });

    it('says the open document is bookmarked, and takes it back out', () => {
        render(<BookmarksPanel />);
        fireEvent.click(screen.getByTestId('toggle-bookmark'));
        expect(screen.getByTestId('toggle-bookmark')).toHaveTextContent('Unbookmark this document');
        expect(list.remove).toHaveBeenCalledWith(0);
        expect(list.add).not.toHaveBeenCalled();
    });

    it('bookmarks the open document under its own name, and opens its note for it', () => {
        browsing.currentFile = { path: 'backlog/board/05 Ready.tasks.md' };
        list.add.mockReturnValue(2);
        const { rerender } = render(<BookmarksPanel />);
        expect(screen.getByTestId('toggle-bookmark')).toHaveTextContent('Bookmark this document');
        fireEvent.click(screen.getByTestId('toggle-bookmark'));
        expect(list.add).toHaveBeenCalledWith('backlog/board/05 Ready.tasks.md', '05 Ready.tasks.md');

        list.bookmarks = readBookmarks([
            ...FILE,
            { title: '05 Ready.tasks.md', link: '/backlog/board/05%20Ready.tasks.md', note: '' },
        ]);
        rerender(<BookmarksPanel />);
        expect(screen.getAllByTestId('bookmark-title')).toHaveLength(1);
        expect(screen.getAllByTestId('bookmark-title')[0]).toHaveValue('05 Ready.tasks.md');
    });

    it('has nothing to bookmark while no document is open', () => {
        browsing.currentFile = null;
        render(<BookmarksPanel />);
        expect(screen.getByTestId('toggle-bookmark')).toBeDisabled();
    });

    it('opens a row on its note, rendered as markdown, and closes it again', () => {
        render(<BookmarksPanel />);
        const carets = screen.getAllByTestId('toggle-note');
        expect(carets[0]).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(carets[0]);
        expect(carets[0]).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('rendered-note')).toHaveTextContent('the one to *copy* from.');
        // …while the other row stays closed.
        expect(screen.getAllByTestId('rendered-note')).toHaveLength(1);

        fireEvent.click(carets[0]);
        expect(screen.queryByTestId('rendered-note')).not.toBeInTheDocument();
    });

    // A navigation replaces the panel — every main view brings its own tool bars — but a
    // note left open is still the open note on the way back.
    it('keeps the open notes open across a navigation', () => {
        const first = render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('toggle-note')[0]);
        expect(screen.getByTestId('rendered-note')).toBeInTheDocument();
        first.unmount();

        render(<BookmarksPanel />);
        expect(screen.getAllByTestId('toggle-note')[0]).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('rendered-note')).toHaveTextContent('the one to *copy* from.');
        expect(screen.getAllByTestId('toggle-note')[1]).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps a closed note closed across a navigation', () => {
        const first = render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('toggle-note')[0]);
        fireEvent.click(screen.getAllByTestId('toggle-note')[0]);
        first.unmount();

        render(<BookmarksPanel />);
        expect(screen.getAllByTestId('toggle-note')[0]).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('rendered-note')).not.toBeInTheDocument();
    });

    it('says so when the open note has none yet', () => {
        render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('toggle-note')[1]);
        expect(screen.getByText('No note yet.')).toBeInTheDocument();
    });

    it('edits the title, the link and the note each in its own box', () => {
        render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('edit-bookmark')[0]);

        expect(screen.getByTestId('bookmark-title')).toHaveValue('cadre.md');
        expect(screen.getByTestId('bookmark-link')).toHaveValue('/units/abc/cadre.md');
        expect(screen.getByTestId('bookmark-note')).toHaveValue('the one to *copy* from.');

        fireEvent.change(screen.getByTestId('bookmark-title'), { target: { value: 'The framing' } });
        expect(list.update).toHaveBeenCalledWith(0, { title: 'The framing' });
        fireEvent.change(screen.getByTestId('bookmark-link'), { target: { value: '/elsewhere.md' } });
        expect(list.update).toHaveBeenCalledWith(0, { link: '/elsewhere.md' });
        fireEvent.change(screen.getByTestId('bookmark-note'), { target: { value: 'now with *more*.' } });
        expect(list.update).toHaveBeenCalledWith(0, { note: 'now with *more*.' });
    });

    it('leaves the note open once the edit is done', () => {
        render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('edit-bookmark')[0]);
        fireEvent.click(screen.getByTestId('done-editing'));

        expect(screen.queryByTestId('bookmark-title')).not.toBeInTheDocument();
        expect(screen.getByTestId('rendered-note')).toHaveTextContent('the one to *copy* from.');
    });

    it('deletes the bookmark the form is open on', async () => {
        render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('edit-bookmark')[1]);
        fireEvent.click(screen.getByTestId('delete-bookmark'));

        const confirm = await screen.findByRole('button', { name: 'Delete' });
        fireEvent.click(confirm);
        expect(list.remove).toHaveBeenCalledWith(1);
    });

    // The one open is still the one open once something above it is gone — by rank, it has moved.
    it('follows the open note when an earlier bookmark is removed', () => {
        const { rerender } = render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('toggle-note')[1]);
        fireEvent.click(screen.getByTestId('toggle-bookmark'));

        expect(list.remove).toHaveBeenCalledWith(0);
        list.bookmarks = readBookmarks([FILE[1]]);
        rerender(<BookmarksPanel />);
        expect(screen.getAllByTestId('toggle-note')[0]).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('No note yet.')).toBeInTheDocument();
    });

    // The grip is the one way in, and it is a real button — so the same reordering is one
    // keystroke away for anyone who is not holding a pointer.
    it('moves a bookmark from the grip of its row', () => {
        render(<BookmarksPanel />);
        const grips = screen.getAllByRole('button', { name: /^Move / });
        expect(grips.map(grip => grip.getAttribute('aria-label'))).toEqual(['Move cadre.md', 'Move Anthropic']);

        fireEvent.keyDown(grips[1], { key: 'ArrowUp' });
        expect(list.move).toHaveBeenCalledWith(1, 0);
    });

    it('follows the open note through a move', () => {
        const { rerender } = render(<BookmarksPanel />);
        fireEvent.click(screen.getAllByTestId('toggle-note')[0]);

        const grips = screen.getAllByRole('button', { name: /^Move / });
        fireEvent.keyDown(grips[0], { key: 'ArrowDown' });
        expect(list.move).toHaveBeenCalledWith(0, 1);

        list.bookmarks = readBookmarks([FILE[1], FILE[0]]);
        rerender(<BookmarksPanel />);
        // The note that was open is still the one open, at the rank the move left it.
        const notes = screen.getAllByTestId('rendered-note');
        expect(notes).toHaveLength(1);
        expect(notes[0]).toHaveTextContent('the one to *copy* from.');
        expect(screen.getAllByTestId('toggle-note')[1]).toHaveAttribute('aria-expanded', 'true');
    });

    // Nothing to reorder a list of one against.
    it('leaves the grip inert while the store keeps a single bookmark', () => {
        list.bookmarks = readBookmarks([FILE[0]]);
        render(<BookmarksPanel />);
        expect(screen.getByRole('button', { name: 'Move cadre.md' })).toBeDisabled();
    });

    it('says so when the store keeps none', () => {
        list.bookmarks = readBookmarks([]);
        render(<BookmarksPanel />);
        expect(screen.getByText('No bookmarks yet.')).toBeInTheDocument();
    });

    // The file is read for a panel that is looked at, not for one that ships with the app.
    it('asks for the list on the way in', () => {
        render(<BookmarksPanel />);
        expect(list.ensureLoaded).toHaveBeenCalled();
    });
});
