import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The slot is exercised by standing in for the manifests, so the assertions do not depend on what
// the real ones happen to provide — and, since the plugin list is loaded rather than imported,
// without pulling a single plugin into this test. What used to need six `vi.mock` calls (react-pdf
// reads DOMMatrix at import time; the board, bookmarks, tags and markdown want a files client) is
// now two stub objects: the loaded assembly is a value, and a test may simply hand one over.
const probe = vi.hoisted(() => ({ mounts: 0 }));

const plugins = [
    {
        id: 'first',
        fileConfigFor: () => null,
        providers: [({ children }: { children?: React.ReactNode }) => (
            <div data-testid="first-provider">{children}</div>
        )],
    },
    {
        id: 'second',
        fileConfigFor: () => null,
        providers: [({ children }: { children?: React.ReactNode }) => {
            // Mounts, not renders: what the slot promises is that the provider is never torn
            // down, and a remount is what would drop a socket or an in-flight request.
            React.useEffect(() => { probe.mounts += 1; }, []);
            return <div data-testid="second-provider">{children}</div>;
        }],
    },
];

vi.mock('./cms-core/core/assembly', () => ({
    usePluginAssembly: () => ({ plugins, missing: [] }),
    PluginAssemblyProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    pluginCatalogue: [],
}));

import { createWorkerClient, PluginProviders } from './App';

const MarkdownView: React.FC = () => <span>markdown view</span>;
const PdfView: React.FC = () => <span>pdf view</span>;

describe('PluginProviders', () => {
    beforeEach(() => { probe.mounts = 0; });

    it('wraps the tree in the provider a plugin declares', () => {
        render(<PluginProviders><MarkdownView /></PluginProviders>);
        expect(screen.getByTestId('second-provider')).toHaveTextContent('markdown view');
    });

    it('nests the plugins in registry order, the first one outermost', () => {
        render(<PluginProviders><MarkdownView /></PluginProviders>);
        expect(screen.getByTestId('first-provider'))
            .toContainElement(screen.getByTestId('second-provider'));
    });

    it('keeps its providers mounted across a change of active plugin', () => {
        const { rerender } = render(<PluginProviders><MarkdownView /></PluginProviders>);
        const provider = screen.getByTestId('second-provider');

        // Opening a document of another type swaps the main view for a component of a different
        // type — the unmount that costs a toolbar panel its state. The providers sit above it, so
        // the very same instance must still be there afterwards.
        rerender(<PluginProviders><PdfView /></PluginProviders>);

        expect(screen.getByTestId('second-provider')).toBe(provider);
        expect(provider).toHaveTextContent('pdf view');
        expect(probe.mounts).toBe(1);
    });
});

/**
 * Which calls wait for a fresh token, and which do not.
 *
 * A file action is one request the server may spend minutes on — exporting a long document reads it aloud
 * from end to end — while the bearer it carries is a snapshot nothing renews in flight. A
 * 73-second publish fired 60 seconds before expiry came back 401 on the write at the end of it.
 * So an action is preceded by a top-up, and the header is read *after* it: renewing and then
 * sending the token that was just replaced would fix nothing.
 */
describe('createWorkerClient', () => {
    const jsonOk = () =>
        ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}) }) as Response;

    /** The real plumbing in miniature: the top-up replaces what the token provider hands out. */
    const freshening = (token: { current: string }) => {
        const freshenToken = vi.fn(async () => { token.current = 'fresh'; });
        return { freshenToken, getToken: () => token.current };
    };

    const headersOf = (fetchMock: ReturnType<typeof vi.fn>): Record<string, string> =>
        (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => jsonOk());
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('runs an action on the token the top-up just produced, not the one it replaced', async () => {
        const token = { current: 'stale' };
        const { freshenToken, getToken } = freshening(token);

        await createWorkerClient(getToken, freshenToken).runAction('doc.publish', 'docs/u.md', {});

        expect(freshenToken).toHaveBeenCalledTimes(1);
        expect(headersOf(fetchMock).Authorization).toBe('Bearer fresh');
    });

    it('leaves every other call alone — a listing must not renew a token', async () => {
        const token = { current: 'stale' };
        const { freshenToken, getToken } = freshening(token);

        await createWorkerClient(getToken, freshenToken).listFiles('units');

        expect(freshenToken).not.toHaveBeenCalled();
        expect(headersOf(fetchMock).Authorization).toBe('Bearer stale');
    });

    it('sends no bearer at all in a build without security', async () => {
        await createWorkerClient().listFiles('units');

        const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.headers).toBeUndefined();
    });
});
