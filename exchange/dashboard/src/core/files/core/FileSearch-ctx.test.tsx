import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ client: { search: vi.fn() } }));

vi.mock('kiao-worker', () => ({ useWorkerClient: () => h.client, WorkerClient: class { } }));
vi.mock('./FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units' }),
}));

import { FileSearchProvider, useFileSearchContext } from './FileSearch-ctx';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FileSearchProvider>{children}</FileSearchProvider>
);

const hit = { file: 'units/a.md', matches: [{ line: 1, content: 'alpha', ranges: [[0, 5]] }] };

describe('FileSearchProvider', () => {
    beforeEach(() => vi.clearAllMocks());

    it('searches the current folder and keeps the truncation flag', async () => {
        h.client.search.mockResolvedValue({ results: [hit], truncated: true });
        const { result } = renderHook(useFileSearchContext, { wrapper });

        await act(async () => { result.current.search('alpha'); });

        expect(h.client.search).toHaveBeenCalledWith('units', 'alpha');
        await waitFor(() => expect(result.current.searchResults).toEqual([hit]));
        expect(result.current.searchTruncated).toBe(true);
        expect(result.current.searchError).toBeNull();
    });

    it('surfaces the server’s complaint and leaves the previous results alone', async () => {
        h.client.search.mockResolvedValue({ results: [hit], truncated: false });
        const { result } = renderHook(useFileSearchContext, { wrapper });
        await act(async () => { result.current.search('alpha'); });
        await waitFor(() => expect(result.current.searchResults).toEqual([hit]));

        h.client.search.mockRejectedValue(new Error('invalid search pattern /[/'));
        await act(async () => { result.current.search('/[/'); });

        await waitFor(() => expect(result.current.searchError).toBe('invalid search pattern /[/'));
        // A syntax slip must not wipe what the user was looking at.
        expect(result.current.searchResults).toEqual([hit]);
        expect(result.current.isSearching).toBe(false);
    });

    it('drops the error on the next search, and everything on clearSearch', async () => {
        h.client.search.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(useFileSearchContext, { wrapper });
        await act(async () => { result.current.search('/[/'); });
        await waitFor(() => expect(result.current.searchError).toBe('boom'));

        h.client.search.mockResolvedValue({ results: [hit], truncated: false });
        await act(async () => { result.current.search('alpha'); });
        await waitFor(() => expect(result.current.searchError).toBeNull());

        act(() => { result.current.clearSearch(); });
        expect(result.current.searchResults).toBeNull();
        expect(result.current.searchTruncated).toBe(false);
    });
});
