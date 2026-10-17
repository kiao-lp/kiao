import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewStateProvider } from './ViewState-ctx';
import { useFileViewState, useGlobalViewState } from './useViewState';
import { SMALL_SCREEN_VIEW_STATE_DOC, VIEW_STATE_DOC, ViewStateFile } from './viewStateModel';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useFileBrowsingPersistenceContext } from 'src/cms-core/files/core/FileBrowsingPersistence-ctx';

vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: vi.fn() }));
vi.mock('src/cms-core/files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: vi.fn(),
}));

// The provider tells a missing document from a broken backend by the status, so
// the real error type matters here.
const httpError = (status: number) => new WorkerError(`HTTP ${status}`, status, 'x');

const stored = (files: ViewStateFile['files'] = {}, global: ViewStateFile['global'] = {}) =>
    ({ version: 1, global, folders: {}, files });

const mockClient = (getConfigJson: any, saveConfigJson = vi.fn().mockResolvedValue(undefined)) => {
    vi.mocked(useWorkerClient).mockReturnValue({ getConfigJson, saveConfigJson } as any);
    return { getConfigJson, saveConfigJson };
};

const setCurrentFile = (path: string | null) => {
    vi.mocked(useFileBrowsingPersistenceContext).mockReturnValue({
        currentFile: path ? { path, isDirectory: false, size: 0, lastModified: 0 } : null,
        currentPath: '',
    } as any);
};

const Panes = () => {
    const [panes, setPanes] = useFileViewState('markdown', { showPreview: true, syncScroll: true });
    return (
        <div>
            <span data-testid="preview">{String(panes.showPreview)}</span>
            <span data-testid="sync">{String(panes.syncScroll)}</span>
            <button onClick={() => setPanes({ showPreview: false })}>hide</button>
        </div>
    );
};

const Theme = () => {
    const [theme, setTheme] = useGlobalViewState('theme', 'dark');
    return <button data-testid="theme" onClick={() => setTheme('light')}>{theme}</button>;
};

const renderApp = (ui: React.ReactNode) => render(<ViewStateProvider>{ui}</ViewStateProvider>);

/** jsdom is 1024 wide, so every other test here is a desktop by default. */
const setViewportWidth = (width: number) =>
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });

describe('ViewStateProvider', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        setCurrentFile('units/abc/cadre.md');
        setViewportWidth(1024);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // Panes must mount already correct; painting the default first is the flicker
    // this whole mechanism exists to avoid.
    it('seeds a pane from the stored scope without rendering the default first', async () => {
        mockClient(vi.fn().mockResolvedValue(stored({ 'units/abc/cadre.md': { markdown: { showPreview: false } } })));

        renderApp(<Panes />);

        await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('false'));
        // A key the stored scope does not carry keeps its default.
        expect(screen.getByTestId('sync')).toHaveTextContent('true');
    });

    it('falls back to the defaults for a file it has never seen', async () => {
        mockClient(vi.fn().mockResolvedValue(stored()));
        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('true'));
    });

    it('seeds the document with defaults when it does not exist yet', async () => {
        const notFound = vi.fn().mockRejectedValue(httpError(404));
        const { saveConfigJson } = mockClient(notFound);

        renderApp(<Panes />);

        await waitFor(() => expect(saveConfigJson).toHaveBeenCalledWith(VIEW_STATE_DOC, expect.objectContaining({ files: {} })));
        expect(screen.getByTestId('preview')).toHaveTextContent('true');
    });

    // Writing back a document we failed to read would replace real state with defaults.
    it('never writes when the document could not be read', async () => {
        const broken = vi.fn().mockRejectedValue(httpError(500));
        const { saveConfigJson } = mockClient(broken);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        act(() => { screen.getByText('hide').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

        expect(saveConfigJson).not.toHaveBeenCalled();
        // The toggle still works in memory; only persistence is off.
        expect(screen.getByTestId('preview')).toHaveTextContent('false');
    });

    it('debounces a change and writes it under the file path', async () => {
        const getConfigJson = vi.fn().mockResolvedValue(stored());
        const { saveConfigJson } = mockClient(getConfigJson);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        act(() => { screen.getByText('hide').click(); });
        expect(saveConfigJson).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(saveConfigJson).toHaveBeenCalledTimes(1);
        const written = saveConfigJson.mock.calls[0][1] as ViewStateFile;
        expect(written.files['units/abc/cadre.md'].markdown).toEqual({ showPreview: false, syncScroll: true });
    });

    it('does not write when nothing actually changed', async () => {
        const { saveConfigJson } = mockClient(
            vi.fn().mockResolvedValue(stored({ 'units/abc/cadre.md': { markdown: { showPreview: false, syncScroll: true } } })));

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('false'));

        act(() => { screen.getByText('hide').click(); });  // already hidden
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(saveConfigJson).not.toHaveBeenCalled();
    });

    // Another tab may have written since we loaded; a blind PUT would drop its work.
    it('re-reads and keeps another tab\'s entry when saving', async () => {
        const getConfigJson = vi.fn()
            .mockResolvedValueOnce(stored())
            .mockResolvedValueOnce(stored({ 'other.md': { at: 1, markdown: { showPreview: false } } }));
        const { saveConfigJson } = mockClient(getConfigJson);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        act(() => { screen.getByText('hide').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        const written = saveConfigJson.mock.calls[0][1] as ViewStateFile;
        expect(written.files['other.md']).toEqual({ at: 1, markdown: { showPreview: false } });
        expect(written.files['units/abc/cadre.md'].markdown).toMatchObject({ showPreview: false });
    });

    it('remembers an app-wide preference outside any file', async () => {
        const { saveConfigJson } = mockClient(vi.fn().mockResolvedValue(stored({}, { theme: 'light' })));

        renderApp(<Theme />);

        await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('light'));
        expect(saveConfigJson).not.toHaveBeenCalled();
    });

    // The same store is browsed from a phone and from a desktop, and what is stored here is the
    // layout itself. One document would have the phone's single column closing the desktop's panes.
    it('reads and writes a document of its own on a small screen', async () => {
        setViewportWidth(390);
        const getConfigJson = vi.fn().mockResolvedValue(stored());
        const { saveConfigJson } = mockClient(getConfigJson);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        expect(getConfigJson).toHaveBeenCalledWith(SMALL_SCREEN_VIEW_STATE_DOC);
        expect(getConfigJson).not.toHaveBeenCalledWith(VIEW_STATE_DOC);

        act(() => { screen.getByText('hide').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(saveConfigJson).toHaveBeenCalledWith(SMALL_SCREEN_VIEW_STATE_DOC, expect.anything());
    });

    it('keeps the desktop document for a roomy viewport', async () => {
        const getConfigJson = vi.fn().mockResolvedValue(stored());
        mockClient(getConfigJson);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        expect(getConfigJson).toHaveBeenCalledWith(VIEW_STATE_DOC);
    });

    // A window dragged narrow mid-session keeps writing where it started: switching would re-seed
    // every mounted pane from a document it has never read. The next load picks up the right one.
    it('does not switch documents when the window is resized', async () => {
        const getConfigJson = vi.fn().mockResolvedValue(stored());
        const { saveConfigJson } = mockClient(getConfigJson);

        renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument());

        setViewportWidth(390);
        act(() => { screen.getByText('hide').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(saveConfigJson).toHaveBeenCalledWith(VIEW_STATE_DOC, expect.anything());
    });

    // Navigating between two files the same plugin handles does not remount it.
    it('re-seeds when the open file changes under a mounted view', async () => {
        mockClient(vi.fn().mockResolvedValue(stored({
            'units/abc/cadre.md': { markdown: { showPreview: false } },
            'units/abc/other.md': { markdown: { showPreview: true } },
        })));

        const { rerender } = renderApp(<Panes />);
        await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('false'));

        setCurrentFile('units/abc/other.md');
        rerender(<ViewStateProvider><Panes /></ViewStateProvider>);

        await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('true'));
    });
});
