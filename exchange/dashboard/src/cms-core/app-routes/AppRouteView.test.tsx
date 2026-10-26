import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { AppRoutesProvider, useAppRoute } from './AppRoutes-ctx';
import { AppRouteView } from './AppRouteView';

const bars = vi.hoisted(() => ({
    tabs: [{ id: 'board' }],
    showTab: vi.fn(),
}));
vi.mock('../tool-bars/ToolBars-ctx', () => ({ useToolBars: () => ({ ...bars }) }));

const BoardRoute = () => <span data-testid="board-route">{useAppRoute()?.rest}</span>;
const routes = [
    { prefix: '/boards', panel: 'board', render: () => <BoardRoute /> },
    { prefix: '/settings', render: () => <span>Settings page</span> },
];

const Harness = ({ initial = '/note.md' }: { initial?: string }) => (
    <MemoryRouter basename="/dashboard" initialEntries={[`/dashboard${initial}`]}>
        <AppRoutesProvider routes={routes}>
            <Link to="/boards/major">Major</Link>
            <Link to="/boards/minor">Minor</Link>
            <Link to="/note.md">Document</Link>
            <Link to="/settings">Settings</Link>
            <AppRouteView><input aria-label="Document draft" defaultValue="" /></AppRouteView>
        </AppRoutesProvider>
    </MemoryRouter>
);

beforeEach(() => {
    bars.tabs = [{ id: 'board' }];
    bars.showTab.mockClear();
});

describe('panel app routes', () => {
    it('keeps the document and its draft mounted when opening and leaving a panel route', () => {
        render(<Harness />);
        const draft = screen.getByRole('textbox', { name: 'Document draft' });
        fireEvent.change(draft, { target: { value: 'Work in progress' } });

        fireEvent.click(screen.getByText('Major'));

        expect(bars.showTab).toHaveBeenLastCalledWith('board');
        expect(screen.getByTestId('board-route')).toHaveTextContent('major');
        expect(screen.getByRole('textbox', { name: 'Document draft' })).toBe(draft);
        expect(draft).toHaveValue('Work in progress');

        fireEvent.click(screen.getByText('Document'));

        expect(screen.queryByTestId('board-route')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Document draft' })).toBe(draft);
        expect(draft).toHaveValue('Work in progress');
    });

    it('opens direct links after the target panel registers without taking back a manually chosen tab', () => {
        bars.tabs = [];
        const { rerender } = render(<Harness initial="/boards/major" />);
        expect(bars.showTab).not.toHaveBeenCalled();

        bars.tabs = [{ id: 'board' }];
        rerender(<Harness initial="/boards/major" />);
        expect(bars.showTab).toHaveBeenCalledTimes(1);

        rerender(<Harness initial="/boards/major" />);
        expect(bars.showTab).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Minor'));
        expect(bars.showTab).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('board-route')).toHaveTextContent('minor');
    });

    it('reveals the panel again when following the same link', () => {
        render(<Harness initial="/boards/major" />);
        fireEvent.click(screen.getByText('Major'));
        expect(bars.showTab).toHaveBeenCalledTimes(2);
    });

    it('renders page routes in place of the document', () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('Settings'));
        expect(screen.getByText('Settings page')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(bars.showTab).not.toHaveBeenCalled();
    });
});
