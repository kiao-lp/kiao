import { act, renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { HarnessOptions } from 'kiao-worker';


const client = vi.hoisted(() => ({ getHarnessOptions: vi.fn() }));

vi.mock('@kiao-dashboard-core', () => ({
    useWorkerClient: () => client,
    TOOLBOX_CHANGED_EVENT: 'kiao:toolbox-changed',
}));

import { useChatOptionLists } from './useChatOptionLists';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useChatOptionLists', () => {
    it('keeps the harness list without re-reading when the browser tab comes back', async () => {
        client.getHarnessOptions.mockResolvedValue({
            models: [], efforts: [], permissionModes: [],
            harnesses: [{ value: 'claude', label: 'Claude', models: [], efforts: [], permissionModes: [] }],
        });
        const { result } = renderHook(() => useChatOptionLists());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const options = result.current;
        const visibility = vi.spyOn(document, 'visibilityState', 'get');
        try {
            visibility.mockReturnValue('hidden');
            act(() => { document.dispatchEvent(new Event('visibilitychange')); });
            visibility.mockReturnValue('visible');
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
                window.dispatchEvent(new Event('focus'));
            });

            expect(client.getHarnessOptions).toHaveBeenCalledTimes(1);
            expect(result.current).toBe(options);
        } finally {
            visibility.mockRestore();
        }
    });

    it('shares reads and refreshes across consumers with independent provider scopes', async () => {
        let finish!: (options: HarnessOptions) => void;
        client.getHarnessOptions.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const first = renderHook(() => useChatOptionLists());
        const second = renderHook(() => useChatOptionLists());
        expect(client.getHarnessOptions).toHaveBeenCalledTimes(1);

        await act(async () => { finish({ harnesses: [], models: [], efforts: [], permissionModes: [] }); });
        expect(first.result.current.loading).toBe(false);
        expect(second.result.current.loading).toBe(false);

        client.getHarnessOptions.mockResolvedValue({ harnesses: [], models: [], efforts: [], permissionModes: [] });
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        expect(client.getHarnessOptions).toHaveBeenCalledTimes(2);

        first.unmount();
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        expect(client.getHarnessOptions).toHaveBeenCalledTimes(3);

        second.unmount();
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        expect(client.getHarnessOptions).toHaveBeenCalledTimes(3);
    });

    it('reads a machine that offers no harness as offering none', async () => {
        client.getHarnessOptions.mockResolvedValue({
            harnesses: [], defaultHarness: 'claude', models: [], efforts: [], permissionModes: [],
        } as HarnessOptions);

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.harnesses).toEqual([]);
    });

    it('reads a service that predates harnesses as the one it has always had', async () => {
        client.getHarnessOptions.mockResolvedValue({
            models: [{ value: 'haiku', label: 'Haiku' }],
            efforts: [{ value: 'low', label: 'Low' }],
            permissionModes: [{ value: 'manual', label: 'Manual' }],
        } as HarnessOptions);

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.harnesses.map(entry => entry.value)).toEqual(['claude']);
        expect(result.current.models).toEqual([{ value: 'haiku', label: 'Haiku' }]);
    });

    it('offers no harness before the enabled list has arrived', () => {
        client.getHarnessOptions.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useChatOptionLists());
        expect(result.current.harnesses).toEqual([]);
        expect(result.current.loading).toBe(true);
    });

    it('does not enable Claude when the endpoint cannot be reached', async () => {
        client.getHarnessOptions.mockRejectedValue(new Error('nope'));

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.harnesses).toEqual([]);
    });

    it('updates open panels after a configuration change and ignores an older response', async () => {
        let finishOld!: (options: HarnessOptions) => void;
        const claude: HarnessOptions = {
            models: [], efforts: [], permissionModes: [],
            harnesses: [{ value: 'claude', label: 'Claude', models: [], efforts: [], permissionModes: [] }],
        };
        client.getHarnessOptions.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
        const { result } = renderHook(() => useChatOptionLists());
        client.getHarnessOptions.mockResolvedValue({ ...claude, harnesses: [] });

        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { finishOld(claude); });
        expect(result.current.harnesses).toEqual([]);

        client.getHarnessOptions.mockResolvedValue(claude);
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.harnesses.map(entry => entry.value)).toEqual(['claude']));

        let failOld!: (error: Error) => void;
        client.getHarnessOptions.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }));
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { failOld(new Error('older request failed')); });
        expect(result.current.harnesses.map(entry => entry.value)).toEqual(['claude']);

        client.getHarnessOptions.mockRejectedValue(new Error('offline'));
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.harnesses).toEqual([]);
    });
});
