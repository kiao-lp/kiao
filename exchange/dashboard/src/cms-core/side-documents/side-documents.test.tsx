import React, { useState } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerError } from 'kiao-worker';
import { FileDto } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useFileBrowsingPersistenceContext } from 'src/cms-core/files/core/FileBrowsingPersistence-ctx';
import { usePluginListContext } from 'src/cms-core/core/PluginList-ctx';

vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: vi.fn() }));
vi.mock('src/cms-core/files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: vi.fn(),
}));
vi.mock('src/cms-core/files/core/CurrentFileList-ctx', () => ({ useRefreshFileList: () => refreshFileList }));
vi.mock('src/cms-core/core/PluginList-ctx', () => ({ usePluginListContext: vi.fn() }));

// The real store persists through the backend and is covered by its own tests; what matters here
// is only that one hook holds the open panes and every consumer of the context sees it.
vi.mock('src/cms-core/view-state', () => ({
    useFileViewState: <T extends object>(_scope: string, defaults: T) => {
        const [state, setState] = useState<T>(defaults);
        return [state, (updater: any) => setState(prev => ({
            ...prev, ...(typeof updater === 'function' ? updater(prev) : updater),
        }))];
    },
    // The row the panes are laid out in remembers how wide each of them was dragged; here it
    // just has to hold them for the render.
    useGlobalViewState: <T,>(_key: string, fallback: T) => useState<T>(fallback),
}));

import { SideDocumentsProvider } from './SideDocuments-ctx';
import { SideDocumentRow } from './SideDocumentRow';
import { SideDocumentToggles } from './SideDocumentToggles';
import { SideDocumentDeclaration } from './sideDocumentModel';

const refreshFileList = vi.fn();

const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

const notFound = () => new WorkerError('HTTP 404', 404, 'Not Found');

/** A side document offered to anything but its own kind, exactly like the mindmap's. */
const declaration = (id: string, suffix: string, create = vi.fn().mockResolvedValue(undefined)): SideDocumentDeclaration => ({
    id,
    title: id,
    icon: <span />,
    pathFor: (host: FileDto) => host.path.endsWith(suffix) ? null : `${host.path}${suffix}`,
    create,
    render: ({ path }) => <div data-testid={`pane-${id}`}>{path}</div>,
});

const setCurrentFile = (path: string) =>
    vi.mocked(useFileBrowsingPersistenceContext).mockReturnValue({
        currentFile: file(path), currentPath: '',
    } as any);

const setPlugins = (sideDocuments: SideDocumentDeclaration[]) =>
    vi.mocked(usePluginListContext).mockReturnValue({ sideDocuments } as any);

const mockClient = (getFileMetadata: any) =>
    vi.mocked(useWorkerClient).mockReturnValue({ getFileMetadata } as any);

const renderApp = () => render(
    <SideDocumentsProvider>
        <SideDocumentRow>
            <div data-testid="host">host editor</div>
        </SideDocumentRow>
        <SideDocumentToggles />
    </SideDocumentsProvider>,
);

describe('side documents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentFile('notes/plan.md');
        mockClient(vi.fn().mockResolvedValue(file('notes/plan.md.mmap.json')));
    });

    it('offers one switch per declaration that has something for the open document', () => {
        setPlugins([declaration('mindmap', '.mmap.json'), declaration('graph', '.graph.json')]);
        renderApp();
        expect(screen.getByLabelText('Show mindmap')).toBeInTheDocument();
        expect(screen.getByLabelText('Show graph')).toBeInTheDocument();
    });

    it('offers nothing to a document a declaration has no side document for', () => {
        setPlugins([declaration('mindmap', '.mmap.json')]);
        setCurrentFile('notes/plan.md.mmap.json');
        renderApp();
        expect(screen.queryByLabelText('Show mindmap')).not.toBeInTheDocument();
    });

    it('leaves the host alone until a side document is switched on', async () => {
        setPlugins([declaration('mindmap', '.mmap.json')]);
        renderApp();
        expect(screen.getByTestId('host')).toBeInTheDocument();
        expect(screen.queryByTestId('pane-mindmap')).not.toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Show mindmap'));
        await waitFor(() => expect(screen.getByTestId('pane-mindmap')).toBeInTheDocument());
        // The pane is drawn beside the host, at the path derived from it.
        expect(screen.getByTestId('host')).toBeInTheDocument();
        expect(screen.getByTestId('pane-mindmap')).toHaveTextContent('notes/plan.md.mmap.json');
    });

    it('does not write over a side document that is already there', async () => {
        const create = vi.fn().mockResolvedValue(undefined);
        setPlugins([declaration('mindmap', '.mmap.json', create)]);
        renderApp();

        fireEvent.click(screen.getByLabelText('Show mindmap'));
        await waitFor(() => expect(screen.getByTestId('pane-mindmap')).toBeInTheDocument());
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        ['the store answers a missing path with null', vi.fn().mockResolvedValue(null)],
        ['the store answers it with a 404', vi.fn().mockRejectedValue(notFound())],
    ])('creates the side document the first time its pane is asked for (%s)', async (_case, getFileMetadata) => {
        const create = vi.fn().mockResolvedValue(undefined);
        mockClient(getFileMetadata);
        setPlugins([declaration('mindmap', '.mmap.json', create)]);
        renderApp();

        fireEvent.click(screen.getByLabelText('Show mindmap'));
        await waitFor(() => expect(screen.getByTestId('pane-mindmap')).toBeInTheDocument());
        expect(create).toHaveBeenCalledWith('notes/plan.md.mmap.json', expect.anything());
        // A new file in the browsed folder: the file list has no other way of hearing about it.
        expect(refreshFileList).toHaveBeenCalled();
    });

    it('leaves a side document alone when the store cannot say whether it is there', async () => {
        const create = vi.fn().mockResolvedValue(undefined);
        mockClient(vi.fn().mockRejectedValue(new WorkerError('HTTP 500', 500, 'Server Error')));
        setPlugins([declaration('mindmap', '.mmap.json', create)]);
        renderApp();

        fireEvent.click(screen.getByLabelText('Show mindmap'));
        await waitFor(() => expect(create).not.toHaveBeenCalled());
        expect(screen.queryByTestId('pane-mindmap')).not.toBeInTheDocument();
    });

    it('takes the pane back down when the switch is turned off', async () => {
        setPlugins([declaration('mindmap', '.mmap.json')]);
        renderApp();

        fireEvent.click(screen.getByLabelText('Show mindmap'));
        await waitFor(() => expect(screen.getByTestId('pane-mindmap')).toBeInTheDocument());
        fireEvent.click(screen.getByLabelText('Hide mindmap'));
        await waitFor(() => expect(screen.queryByTestId('pane-mindmap')).not.toBeInTheDocument());
    });
});
