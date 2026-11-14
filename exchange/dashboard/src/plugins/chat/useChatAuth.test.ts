import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { HarnessAuthStatus } from 'kiao-worker';


const client = vi.hoisted(() => ({ getHarnessAuthStatus: vi.fn() }));

vi.mock('@kiao-dashboard-core', () => ({
    useWorkerClient: () => client,
}));

import { useChatAuth, CHAT_AUTH_POLL_MS } from './useChatAuth';

const SIGNED_IN: HarnessAuthStatus = { loggedIn: true, loginEnabled: true, email: 'someone@example.com' };
const SIGNED_OUT: HarnessAuthStatus = { loggedIn: false, loginEnabled: true };

/** Puts the tab in the background or back in front, the way a browser does. */
const setVisibility = (value: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client.getHarnessAuthStatus.mockResolvedValue(SIGNED_IN);
    setVisibility('visible');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useChatAuth', () => {
    it('does not check auth or poll while Claude is disabled', async () => {
        const { result } = renderHook(() => useChatAuth(false));
        act(() => { result.current.refresh(); });
        setVisibility('visible');
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS * 2); });

        expect(client.getHarnessAuthStatus).not.toHaveBeenCalled();
        expect(result.current.status).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('clears a sign-out and stops polling when disabled, then reads again when enabled', async () => {
        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result, rerender } = renderHook(({ enabled }) => useChatAuth(enabled), {
            initialProps: { enabled: true },
        });
        await waitFor(() => expect(result.current.status).toEqual(SIGNED_OUT));

        rerender({ enabled: false });
        expect(result.current.status).toBeNull();
        setVisibility('visible');
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS * 2); });
        expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1);

        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_IN);
        rerender({ enabled: true });
        await waitFor(() => expect(result.current.status).toEqual(SIGNED_IN));
        expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
    });

    it('ignores an auth check that finishes after Claude is disabled', async () => {
        let finish!: (status: HarnessAuthStatus) => void;
        client.getHarnessAuthStatus.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const { result, rerender } = renderHook(({ enabled }) => useChatAuth(enabled), {
            initialProps: { enabled: true },
        });
        rerender({ enabled: false });
        await act(async () => { finish(SIGNED_OUT); });
        expect(result.current.status).toBeNull();
    });

    it('reads the status once mounted', async () => {
        const { result } = renderHook(() => useChatAuth(true));

        await waitFor(() => expect(result.current.status).toEqual(SIGNED_IN));
        expect(result.current.loading).toBe(false);
    });

    it('notices a session that ends while the panel sits open', async () => {
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));

        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });

        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));
    });

    it('keeps the current status without re-reading when the tab comes back', async () => {
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));
        const status = result.current.status;

        setVisibility('hidden');
        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        setVisibility('visible');
        act(() => { window.dispatchEvent(new Event('focus')); });

        expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe(status);
        expect(result.current.loading).toBe(false);
    });

    it('does not re-read when the tab is hidden', async () => {
        renderHook(() => useChatAuth(true));
        await waitFor(() => expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1));

        setVisibility('hidden');

        expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });

    // A service that cannot be reached says nothing about the session on its host.
    it('keeps the last known status when a re-read fails', async () => {
        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));

        client.getHarnessAuthStatus.mockRejectedValue(new Error('Get Claude auth status failed: Service Unavailable'));
        act(() => { result.current.refresh(); });
        await waitFor(() => expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(2));

        expect(result.current.status).toEqual(SIGNED_OUT);

        // And the same on the poll, which is the read that happens without anyone asking: a banner correctly up must not blink out at.
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });
        expect(result.current.status).toEqual(SIGNED_OUT);
    });

    it('recovers from a first read that failed', async () => {
        client.getHarnessAuthStatus.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.status).toBeNull();

        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });

        await waitFor(() => expect(result.current.status).toEqual(SIGNED_OUT));
    });

    // What the login dialog calls when the user has just signed in: the banner must go without
    it('re-reads on demand once a sign-in has completed', async () => {
        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));

        client.getHarnessAuthStatus.mockResolvedValue(SIGNED_IN);
        act(() => { result.current.refresh(); });

        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));
    });

    it('stops polling once unmounted', async () => {
        const { unmount } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1));

        unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS * 3); });
        setVisibility('visible');

        expect(client.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });
});
