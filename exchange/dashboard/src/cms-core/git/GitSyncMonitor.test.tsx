import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GitDiffProvider, useGitDiff } from './GitDiff-ctx';

const client = vi.hoisted(() => ({ gitFetch: vi.fn(), gitStatus: vi.fn() }));

vi.mock('../files/service/ui', () => ({ useWorkerClient: () => client }));

import { GitSyncMonitor } from './GitSyncMonitor';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('reads Git status on its timer and explicit refresh, without a read on tab return', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    client.gitFetch.mockResolvedValue({ repo: false });
    client.gitStatus.mockResolvedValue({ repo: false });
    let refresh!: () => void;
    const Monitor = () => {
        refresh = useGitDiff().requestRefresh;
        return <GitSyncMonitor />;
    };
    render(<GitDiffProvider><Monitor /></GitDiffProvider>);
    await act(async () => {});
    expect(client.gitStatus).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(client.gitStatus).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
    });
    expect(client.gitStatus).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(client.gitStatus).toHaveBeenCalledTimes(2);
    await act(async () => { refresh(); });
    expect(client.gitStatus).toHaveBeenCalledTimes(3);
    expect(client.gitFetch).toHaveBeenCalledTimes(1);
});
