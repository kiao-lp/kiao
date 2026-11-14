import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
    results: [
        {
            file: 'docs/alpha-beta.md',
            matches: [{ line: 3, content: 'alpha and beta', ranges: [[0, 5], [10, 14]] }],
        },
        { file: 'docs/alpha-only.md', matches: [] },
    ],
    truncated: false,
    search: vi.fn(async (_path: string, _query: string) => ({ results: h.results, truncated: h.truncated })),
}));

vi.mock('kiao-worker', () => ({ useWorkerClient: () => ({ search: h.search }) }));

vi.mock('../core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'docs', currentFile: null }),
}));

const nav = vi.hoisted(() => ({ open: vi.fn(), openInNewTab: vi.fn(), openInNewWindow: vi.fn() }));

vi.mock('../navigation/NavigationModel', () => ({
    useNavigation: () => nav,
}));

import { FileSearchProvider, useFileSearchContext } from '../core/FileSearch-ctx';
import { CentralStackProvider, CentralStackView, useCentralStack } from '../../dashboard-ui/documents/CentralStack-ctx';
import { FileSearchResultsStackPanel, FILE_SEARCH_RESULTS_PANEL_ID } from './FileSearchResultsView';

// Panel opens over current view; results survive remount.
const Opener: React.FC = () => {
    const { search, clearSearch } = useFileSearchContext();
    return (
        <>
            <button data-testid="search" onClick={() => search('alpha')}>Search</button>
            <button data-testid="clear" onClick={() => clearSearch()}>Clear</button>
        </>
    );
};

const Area: React.FC = () => (
    <CentralStackProvider>
        <div data-testid="document">the document</div>
        <FileSearchResultsStackPanel />
        <CentralStackView />
    </CentralStackProvider>
);

const Harness: React.FC<{ area: boolean }> = ({ area }) => (
    <FileSearchProvider>
        <Opener />
        {area && <Area />}
    </FileSearchProvider>
);

const PushDummy: React.FC = () => {
    const { push } = useCentralStack();
    return (
        <button
            data-testid="push-dummy"
            onClick={() => push({ id: 'dummy', title: 'Dummy', content: 'dummy panel' })}
        >
            Dummy
        </button>
    );
};

const StackingArea: React.FC = () => (
    <CentralStackProvider>
        <div data-testid="document">the board</div>
        <PushDummy />
        <FileSearchResultsStackPanel />
        <CentralStackView />
    </CentralStackProvider>
);

const StackingHarness: React.FC = () => (
    <FileSearchProvider>
        <Opener />
        <StackingArea />
    </FileSearchProvider>
);

const panelId = `central-panel-${FILE_SEARCH_RESULTS_PANEL_ID}`;

beforeEach(() => {
    vi.clearAllMocks();
    h.results = [
        {
            file: 'docs/alpha-beta.md',
            matches: [{ line: 3, content: 'alpha and beta', ranges: [[0, 5], [10, 14]] }],
        },
        { file: 'docs/alpha-only.md', matches: [] },
    ];
    h.truncated = false;
    nav.open.mockClear();
    nav.openInNewTab.mockClear();
});

describe('FileSearchResultsStackPanel', () => {
    it('opens the results over the area when the search answers', async () => {
        render(<Harness area />);

        fireEvent.click(screen.getByTestId('search'));

        const panel = await screen.findByTestId(panelId);
        expect(panel).toHaveAttribute('role', 'dialog');
        expect(panel).toHaveAccessibleName('Search results');
        expect(screen.getByTestId('document')).toBeInTheDocument();
        expect(screen.getByTestId('file-search-results-view')).toBeInTheDocument();
        expect(screen.getByTestId('file-search-results-count')).toHaveTextContent('2 files');
        expect(h.search).toHaveBeenCalledWith('docs', 'alpha');
    });

    it('shows each hit with its matched lines marked', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        const panel = await screen.findByTestId(panelId);

        expect(within(panel).getByText('alpha-beta.md')).toBeInTheDocument();
        expect(within(panel).getByText('alpha-only.md')).toBeInTheDocument();
        const marks = within(panel).getAllByText(/^(alpha|beta)$/, { selector: 'mark' });
        expect(marks).toHaveLength(2);
    });

    it('says so when the server stopped at its cap', async () => {
        h.truncated = true;
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));

        await screen.findByTestId(panelId);
        expect(screen.getByTestId('search-truncated-notice')).toHaveTextContent('Showing the first 2 files');
    });

    it('says so when nothing matches', async () => {
        h.results = [];
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));

        const panel = await screen.findByTestId(panelId);
        expect(within(panel).getByText('No files match this search.')).toBeInTheDocument();
        expect(screen.getByTestId('file-search-results-count')).toHaveTextContent('0 files');
    });

    it('closes through the floating cross, and opens again after', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId(`${panelId}-close`));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());

        // Reopen proves search cleared, not just hidden.
        fireEvent.click(screen.getByTestId('search'));
        await screen.findByTestId(panelId);
    });

    it('closes when the search is cleared in code', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId('clear'));

        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });

    it('comes back after the area is remounted', async () => {
        const { rerender } = render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        await screen.findByTestId(panelId);

        rerender(<Harness area={false} />);
        expect(screen.queryByTestId(panelId)).toBeNull();
        rerender(<Harness area />);

        await screen.findByTestId(panelId);
        expect(screen.getByTestId('file-search-results-view')).toBeInTheDocument();
    });

    it('opens a hit in place and clears the search', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        const panel = await screen.findByTestId(panelId);

        fireEvent.click(within(panel).getByText('alpha-beta.md'));

        await waitFor(() => expect(nav.open).toHaveBeenCalledWith('docs/alpha-beta.md'));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });

    it('leaves the panel up when a hit is opened beside this tab', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('search'));
        const panel = await screen.findByTestId(panelId);

        fireEvent.click(within(panel).getByText('alpha-beta.md'), { ctrlKey: true });

        await waitFor(() => expect(nav.openInNewTab).toHaveBeenCalledWith('docs/alpha-beta.md'));
        expect(screen.getByTestId(panelId)).toBeInTheDocument();
    });

    it('stacks over the panel below and unwinds back onto it', async () => {
        render(<StackingHarness />);

        fireEvent.click(screen.getByTestId('push-dummy'));
        expect(screen.getByTestId('central-panel-dummy')).not.toHaveAttribute('hidden');
        fireEvent.click(screen.getByTestId('search'));
        const panel = await screen.findByTestId(panelId);

        expect(panel).not.toHaveAttribute('hidden');
        expect(screen.getByTestId('central-panel-dummy')).toHaveAttribute('hidden');

        fireEvent.click(screen.getByTestId(`${panelId}-close`));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
        expect(screen.getByTestId('central-panel-dummy')).not.toHaveAttribute('hidden');
        expect(screen.getByTestId('document')).toHaveTextContent('the board');
    });
});
