import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WorkerClientProvider } from 'kiao-worker';

/**
 * The other half of "a token renewal must be invisible": even with the page kept, a
 * renewal re-renders the whole tree, because App reads the auth state at its root. The
 * open document has to sit through that untouched — re-reading it replaces the
 * CodeMirror document, and with it the caret, the scroll position and any keystroke
 * still inside the save debounce.
 */

const probe = vi.hoisted(() => ({
    mounts: 0,
    /** Set by the stubbed editor body, so a test can type without a real CodeMirror. */
    edit: (_text: string) => { },
}));

const client = vi.hoisted(() => ({
    getFileText: vi.fn(async () => '# stored heading'),
    getFileMetadata: vi.fn(async () => ({ lastModified: 1000 })),
    update: vi.fn(async () => undefined),
}));

const currentFile = { path: 'notes/doc.md', isDirectory: false, size: 3, lastModified: 0 };

// The real `useTextFileSync`, reading through the stubbed client: what is under test is that a
// renewal leaves the document where it is, and the reading is the hook's.
vi.mock('@cms-core', async importOriginal => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile, currentPath: 'notes' }),
    useTextFileSync: (await importOriginal<typeof import('@cms-core')>()).useTextFileSync,
}));

// The shared body is CodeMirror-backed; standing it in keeps the assertions on what
// markdown-edit hands it rather than on the editor widget.
vi.mock('@cms-kit/markdown-editor', () => ({
    MarkdownEditorBody: React.forwardRef<
        unknown,
        { value: string; onChange: (v: string) => void }
    >(({ value, onChange }, _ref) => {
        // Mounts, not renders: a remount is what would cost the document its state.
        React.useEffect(() => { probe.mounts += 1; }, []);
        probe.edit = onChange;
        return <div data-testid="editor-body">{value}</div>;
    }),
}));

import { MarkdownFileEditor } from './MarkdownEditor';

/** Stands in for App's auth layer: re-renders its children whenever the token changes. */
let renewToken: () => void = () => { };
const TokenHolder: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [token, setToken] = React.useState(0);
    renewToken = () => setToken((t) => t + 1);
    return <div data-token={token}>{children}</div>;
};

describe('MarkdownFileEditor across a token renewal', () => {
    beforeEach(() => {
        probe.mounts = 0;
        client.getFileText.mockClear();
        client.update.mockClear();
    });

    it('does not re-read the file when the access token is renewed', async () => {
        render(<WorkerClientProvider workerClient={client as never}><TokenHolder><MarkdownFileEditor /></TokenHolder></WorkerClientProvider>);
        expect(await screen.findByTestId('editor-body')).toHaveTextContent('stored heading');
        expect(client.getFileText).toHaveBeenCalledTimes(1);

        act(() => { renewToken(); });
        act(() => { renewToken(); });

        expect(client.getFileText).toHaveBeenCalledTimes(1);
        expect(probe.mounts).toBe(1);
    });

    it('keeps an edit that has not reached the debounced save yet', async () => {
        render(<WorkerClientProvider workerClient={client as never}><TokenHolder><MarkdownFileEditor /></TokenHolder></WorkerClientProvider>);
        await screen.findByTestId('editor-body');

        act(() => { probe.edit('# stored heading\n\ntyped but not saved'); });
        expect(screen.getByTestId('editor-body')).toHaveTextContent('typed but not saved');

        act(() => { renewToken(); });

        expect(screen.getByTestId('editor-body')).toHaveTextContent('typed but not saved');
        expect(client.getFileText).toHaveBeenCalledTimes(1);
    });
});
