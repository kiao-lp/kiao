import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, useNavigate } from 'react-router-dom';
import { AppRoutesProvider, useAppRoute } from '../../app-routes/AppRoutes-ctx';
import { AppRouteView } from './AppRouteView';

const bars = vi.hoisted(() => ({
    tabs: [{ id: 'boards' }, { id: 'board' }, { id: 'document' }, { id: 'file-navigation-tree' }],
    showTab: vi.fn(),
}));
vi.mock('../toolbars/ToolBars-ctx', () => ({ useToolBars: () => ({ ...bars }) }));

const BoardRoute = () => <span data-testid="board-route">{useAppRoute()?.rest}</span>;
const routes = [
    { prefix: '/boards', panel: 'board', render: () => <BoardRoute /> },
    { prefix: '/settings', render: () => <span>Settings page</span> },
];

const BackButton = () => {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back</button>;
};

const Harness = ({ initial = '/note.md' }: { initial?: string }) => (
    <MemoryRouter basename="/dashboard" initialEntries={[`/dashboard${initial}`]}>
        <AppRoutesProvider routes={routes}>
            <Link to="/boards">Boards list</Link>
            <Link to="/boards/major">Major</Link>
            <Link to="/boards/minor">Minor</Link>
            <Link to="/note.md">Document</Link>
            <Link to="/other.md">Other document</Link>
            <Link to="/docs">Folder</Link>
            <Link to="/note.md#section">Section</Link>
            <Link to="/settings">Settings</Link>
            <BackButton />
            <AppRouteView><input aria-label="Document draft" defaultValue="" /></AppRouteView>
        </AppRoutesProvider>
    </MemoryRouter>
);

const shownTabs = () => bars.showTab.mock.calls.map(call => call[0]);

beforeEach(() => {
    bars.tabs = [{ id: 'boards' }, { id: 'board' }, { id: 'document' }, { id: 'file-navigation-tree' }];
    bars.showTab.mockClear();
});

describe('route tab selection', () => {
    it('selects only Document when a document URL opens', () => {
        const { rerender } = render(<Harness initial="/note.md" />);
        expect(shownTabs()).toEqual(['document']);

        rerender(<Harness initial="/note.md" />);
        expect(bars.showTab).toHaveBeenCalledTimes(1);
    });

    it.each(['/boards', '/boards/major'])('selects only Board when %s opens', initial => {
        render(<Harness initial={initial} />);
        expect(shownTabs()).toEqual(['board']);
    });

    it('keeps the document and its draft mounted when opening and leaving a panel route', () => {
        render(<Harness />);
        const draft = screen.getByRole('textbox', { name: 'Document draft' });
        fireEvent.change(draft, { target: { value: 'Work in progress' } });
        bars.showTab.mockClear();

        fireEvent.click(screen.getByText('Major'));

        expect(shownTabs()).toEqual(['board']);
        expect(screen.getByTestId('board-route')).toHaveTextContent('major');
        expect(screen.getByRole('textbox', { name: 'Document draft' })).toBe(draft);
        expect(draft).toHaveValue('Work in progress');

        fireEvent.click(screen.getByText('Document'));

        expect(bars.showTab).toHaveBeenLastCalledWith('document');
        expect(screen.queryByTestId('board-route')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Document draft' })).toBe(draft);
        expect(draft).toHaveValue('Work in progress');
    });

    it.each([
        ['/note.md', 'document'],
        ['/boards', 'board'],
        ['/boards/major', 'board'],
    ])('waits for the target tab to register for %s, once per navigation', (initial, tabId) => {
        bars.tabs = [];
        const { rerender } = render(<Harness initial={initial} />);
        expect(bars.showTab).not.toHaveBeenCalled();

        bars.tabs = [{ id: 'boards' }, { id: 'file-navigation-tree' }];
        rerender(<Harness initial={initial} />);
        expect(bars.showTab).not.toHaveBeenCalled();

        bars.tabs = [...bars.tabs, { id: tabId }];
        rerender(<Harness initial={initial} />);
        expect(shownTabs()).toEqual([tabId]);

        bars.tabs = [...bars.tabs, { id: 'another-tab' }];
        rerender(<Harness initial={initial} />);
        expect(bars.showTab).toHaveBeenCalledTimes(1);
    });

    it('selects Board again when following the same board link', () => {
        render(<Harness initial="/boards/major" />);
        fireEvent.click(screen.getByText('Major'));
        expect(shownTabs()).toEqual(['board', 'board']);
    });

    it.each(['Document', 'Other document', 'Folder', 'Section'])(
        'selects only Document when following a store link (%s)', label => {
            const { rerender } = render(<Harness initial="/boards/major" />);
            bars.showTab.mockClear();

            fireEvent.click(screen.getByText(label));

            expect(shownTabs()).toEqual(['document']);

            rerender(<Harness initial="/boards/major" />);
            expect(bars.showTab).toHaveBeenCalledTimes(1);
        },
    );

    it('waits for Document to register after following a link', () => {
        bars.tabs = [{ id: 'board' }];
        const { rerender } = render(<Harness initial="/boards/major" />);
        bars.showTab.mockClear();
        fireEvent.click(screen.getByText('Other document'));
        expect(bars.showTab).not.toHaveBeenCalled();

        bars.tabs = [{ id: 'board' }, { id: 'file-navigation-tree' }, { id: 'document' }];
        rerender(<Harness initial="/boards/major" />);

        expect(shownTabs()).toEqual(['document']);
    });

    it('selects only Document again when following the same link twice', () => {
        render(<Harness initial="/boards/major" />);
        bars.showTab.mockClear();
        fireEvent.click(screen.getByText('Document'));
        fireEvent.click(screen.getByText('Document'));

        expect(shownTabs()).toEqual(['document', 'document']);
    });

    it('selects only Document when returning from a panel route with browser history', () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('Major'));
        bars.showTab.mockClear();

        fireEvent.click(screen.getByText('Back'));

        expect(shownTabs()).toEqual(['document']);
    });

    it('selects Document again after returning from a route whose tab has not registered', () => {
        bars.tabs = [{ id: 'document' }];
        render(<Harness />);
        bars.showTab.mockClear();

        fireEvent.click(screen.getByText('Major'));
        expect(bars.showTab).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Back'));

        expect(shownTabs()).toEqual(['document']);
    });

    it('selects only Board when navigating between boards and returning through browser history', () => {
        render(<Harness initial="/boards/major" />);
        bars.showTab.mockClear();

        fireEvent.click(screen.getByText('Minor'));
        expect(screen.getByTestId('board-route')).toHaveTextContent('minor');
        fireEvent.click(screen.getByText('Back'));

        expect(shownTabs()).toEqual(['board', 'board']);
        expect(screen.getByTestId('board-route')).toHaveTextContent('major');
    });

    it('selects Board again when returning from a page route', () => {
        render(<Harness initial="/boards/major" />);
        fireEvent.click(screen.getByText('Settings'));
        bars.showTab.mockClear();

        fireEvent.click(screen.getByText('Back'));

        expect(shownTabs()).toEqual(['board']);
    });

    it('renders page routes in place of the document and selects no tab', () => {
        render(<Harness />);
        bars.showTab.mockClear();
        fireEvent.click(screen.getByText('Settings'));
        expect(screen.getByText('Settings page')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(bars.showTab).not.toHaveBeenCalled();
    });
});
