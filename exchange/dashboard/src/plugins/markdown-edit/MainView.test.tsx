import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const secondary = vi.hoisted(() => ({
    file: null as { path: string } | null,
    open: vi.fn(),
    close: vi.fn(),
}));
const client = vi.hoisted(() => ({
    getFileMetadata: vi.fn(),
    saveDocument: vi.fn(),
}));
const refreshFileList = vi.hoisted(() => vi.fn());

vi.mock('@cms-core', () => ({
    extractFileNameFn: () => (file: { path: string }) => file.path,
    LayoutContent: ({ children, additionalPanels }: { children: React.ReactNode; additionalPanels?: React.ReactNode }) => (
        <div>{additionalPanels}{children}</div>
    ),
    TopBanner: () => null,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useFileBrowsingPersistenceContext: () => ({
        currentFile: { path: 'notes/plan.md', isDirectory: false, size: 0, lastModified: 0 },
        currentPath: 'notes',
    }),
    useSecondaryDocument: () => secondary,
    useWorkerClient: () => client,
    useRefreshFileList: () => refreshFileList,
}));

vi.mock('@cms-kit/markdown-editor', () => ({
    MarkdownEditorToolbar: () => <div data-testid="markdown-toolbar" />,
    useMarkdownEditorControls: () => ({
        toolbarProps: {},
        bodyProps: { showSource: true, showPreview: true },
        editorRef: { current: null },
    }),
}));

vi.mock('./MarkdownEditor', () => ({
    MarkdownFileEditor: React.forwardRef(() => <div data-testid="markdown-editor" />),
}));

import MainView from './MainView';

describe('markdown mindmap toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        secondary.file = null;
        secondary.open.mockImplementation((file: { path: string }) => { secondary.file = file; });
        secondary.close.mockImplementation(() => { secondary.file = null; });
        client.saveDocument.mockResolvedValue(undefined);
    });

    it('creates the mindmap file and opens it as the secondary document', async () => {
        client.getFileMetadata.mockResolvedValue(null);
        render(<MainView />);

        fireEvent.click(screen.getByLabelText('Show Mindmap'));

        await waitFor(() => expect(secondary.open).toHaveBeenCalledWith({
            path: 'notes/plan.md.mmap.json', isDirectory: false, size: 0, lastModified: 0,
        }));
        expect(client.saveDocument).toHaveBeenCalledWith('notes/plan.md.mmap.json', expect.objectContaining({
            docType: 'QuickMindmap',
            content: { elements: { notes: [], relations: [] } },
        }));
        expect(refreshFileList).toHaveBeenCalled();
    });

    it('opens an existing mindmap without creating it, then closes it', async () => {
        client.getFileMetadata.mockResolvedValue({ path: 'notes/plan.md.mmap.json' });
        const view = render(<MainView />);

        fireEvent.click(screen.getByLabelText('Show Mindmap'));
        await waitFor(() => expect(secondary.open).toHaveBeenCalled());
        expect(client.saveDocument).not.toHaveBeenCalled();

        view.rerender(<MainView />);
        fireEvent.click(screen.getByLabelText('Hide Mindmap'));
        expect(secondary.close).toHaveBeenCalled();
    });
});
