import { act, renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentOptions } from 'kiao-worker';


const client = vi.hoisted(() => ({ getAgentOptions: vi.fn() }));

vi.mock('@cms-core', () => ({
    useWorkerClient: () => client,
    TOOLBOX_CHANGED_EVENT: 'kiao:toolbox-changed',
}));

import { useChatOptionLists } from './useChatOptionLists';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useChatOptionLists', () => {
    it('keeps the agent list without re-reading when the browser tab comes back', async () => {
        client.getAgentOptions.mockResolvedValue({
            models: [], efforts: [], permissionModes: [],
            agents: [{ value: 'claude', label: 'Claude', models: [], efforts: [], permissionModes: [] }],
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

            expect(client.getAgentOptions).toHaveBeenCalledTimes(1);
            expect(result.current).toBe(options);
        } finally {
            visibility.mockRestore();
        }
    });

    it('shares reads and refreshes across consumers with independent provider scopes', async () => {
        let finish!: (options: AgentOptions) => void;
        client.getAgentOptions.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const first = renderHook(() => useChatOptionLists());
        const second = renderHook(() => useChatOptionLists());
        expect(client.getAgentOptions).toHaveBeenCalledTimes(1);

        await act(async () => { finish({ agents: [], models: [], efforts: [], permissionModes: [] }); });
        expect(first.result.current.loading).toBe(false);
        expect(second.result.current.loading).toBe(false);

        client.getAgentOptions.mockResolvedValue({ agents: [], models: [], efforts: [], permissionModes: [] });
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        expect(client.getAgentOptions).toHaveBeenCalledTimes(2);

        first.unmount();
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        expect(client.getAgentOptions).toHaveBeenCalledTimes(3);

        second.unmount();
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        expect(client.getAgentOptions).toHaveBeenCalledTimes(3);
    });

    it('reads a machine that offers no agent as offering none', async () => {
        client.getAgentOptions.mockResolvedValue({
            agents: [], defaultAgent: 'claude', models: [], efforts: [], permissionModes: [],
        } as AgentOptions);

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.agents).toEqual([]);
    });

    it('reads a service that predates agents as the one it has always had', async () => {
        client.getAgentOptions.mockResolvedValue({
            models: [{ value: 'haiku', label: 'Haiku' }],
            efforts: [{ value: 'low', label: 'Low' }],
            permissionModes: [{ value: 'manual', label: 'Manual' }],
        } as AgentOptions);

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.agents.map(entry => entry.value)).toEqual(['claude']);
        expect(result.current.models).toEqual([{ value: 'haiku', label: 'Haiku' }]);
    });

    it('offers no agent before the enabled list has arrived', () => {
        client.getAgentOptions.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useChatOptionLists());
        expect(result.current.agents).toEqual([]);
        expect(result.current.loading).toBe(true);
    });

    it('does not enable Claude when the endpoint cannot be reached', async () => {
        client.getAgentOptions.mockRejectedValue(new Error('nope'));

        const { result } = renderHook(() => useChatOptionLists());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.agents).toEqual([]);
    });

    it('updates open panels after a configuration change and ignores an older response', async () => {
        let finishOld!: (options: AgentOptions) => void;
        const claude: AgentOptions = {
            models: [], efforts: [], permissionModes: [],
            agents: [{ value: 'claude', label: 'Claude', models: [], efforts: [], permissionModes: [] }],
        };
        client.getAgentOptions.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
        const { result } = renderHook(() => useChatOptionLists());
        client.getAgentOptions.mockResolvedValue({ ...claude, agents: [] });

        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { finishOld(claude); });
        expect(result.current.agents).toEqual([]);

        client.getAgentOptions.mockResolvedValue(claude);
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.agents.map(entry => entry.value)).toEqual(['claude']));

        let failOld!: (error: Error) => void;
        client.getAgentOptions.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }));
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { failOld(new Error('older request failed')); });
        expect(result.current.agents.map(entry => entry.value)).toEqual(['claude']);

        client.getAgentOptions.mockRejectedValue(new Error('offline'));
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.agents).toEqual([]);
    });
});
