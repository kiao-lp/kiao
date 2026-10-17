import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentAuthStatus } from 'kiao-worker';

// ── Why this file exists ──────────────────────────────────────────────────────
//
// The Claude panel offers a way to sign in on one field alone: `status.loggedIn`. Every time that
// banner has failed to appear, the cause has been on the road to that field rather than in the
// banner itself — a status nobody re-read, or one a failed request quietly erased. So these tests
// are about the *reading*: when it happens again, and what a failure to read is allowed to change.

const client = vi.hoisted(() => ({ getAgentAuthStatus: vi.fn() }));

vi.mock('@cms-core', () => ({
    useWorkerClient: () => client,
}));

import { useChatAuth, CHAT_AUTH_POLL_MS } from './useChatAuth';

const SIGNED_IN: AgentAuthStatus = { loggedIn: true, loginEnabled: true, email: 'someone@example.com' };
const SIGNED_OUT: AgentAuthStatus = { loggedIn: false, loginEnabled: true };

/** Puts the tab in the background or back in front, the way a browser does. */
const setVisibility = (value: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client.getAgentAuthStatus.mockResolvedValue(SIGNED_IN);
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

        expect(client.getAgentAuthStatus).not.toHaveBeenCalled();
        expect(result.current.status).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('clears a sign-out and stops polling when disabled, then reads again when enabled', async () => {
        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result, rerender } = renderHook(({ enabled }) => useChatAuth(enabled), {
            initialProps: { enabled: true },
        });
        await waitFor(() => expect(result.current.status).toEqual(SIGNED_OUT));

        rerender({ enabled: false });
        expect(result.current.status).toBeNull();
        setVisibility('visible');
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS * 2); });
        expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(1);

        client.getAgentAuthStatus.mockResolvedValue(SIGNED_IN);
        rerender({ enabled: true });
        await waitFor(() => expect(result.current.status).toEqual(SIGNED_IN));
        expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(2);
    });

    it('ignores an auth check that finishes after Claude is disabled', async () => {
        let finish!: (status: AgentAuthStatus) => void;
        client.getAgentAuthStatus.mockReturnValue(new Promise(resolve => { finish = resolve; }));
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

    // The reported failure, as a test. The panel was open when the session ended; nothing about the
    // page changed, so nothing but a re-read can bring the banner up.
    it('notices a session that ends while the panel sits open', async () => {
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));

        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });

        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));
    });

    // Coming back to a tab is the moment the user is about to type into the panel, and the cheapest
    // opportunity there is to tell them they cannot.
    it('re-reads when the tab comes back to the front', async () => {
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));

        setVisibility('hidden');
        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        setVisibility('visible');

        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));
    });

    // Going away is not an event worth a request: the read is for the user who is looking.
    it('does not re-read when the tab is hidden', async () => {
        renderHook(() => useChatAuth(true));
        await waitFor(() => expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(1));

        setVisibility('hidden');

        expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(1);
    });

    // A service that cannot be reached says nothing about the session on its host. Erasing the
    // status on a failed read is how a banner that had correctly appeared disappears again on the
    // next poll — the same bug, arrived at from the other side.
    it('keeps the last known status when a re-read fails', async () => {
        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));

        client.getAgentAuthStatus.mockRejectedValue(new Error('Get Claude auth status failed: Service Unavailable'));
        act(() => { result.current.refresh(); });
        await waitFor(() => expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(2));

        expect(result.current.status).toEqual(SIGNED_OUT);

        // And the same on the poll, which is the read that happens without anyone asking: a banner
        // correctly up must not blink out at the next five-minute mark.
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });
        expect(result.current.status).toEqual(SIGNED_OUT);
    });

    // A first read that fails leaves nothing known, which the panel renders as nothing at all — and
    // the next read has to be able to put that right rather than leave the hook wedged.
    it('recovers from a first read that failed', async () => {
        client.getAgentAuthStatus.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.status).toBeNull();

        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS); });

        await waitFor(() => expect(result.current.status).toEqual(SIGNED_OUT));
    });

    // What the login dialog calls when the user has just signed in: the banner must go without
    // waiting out a poll interval.
    it('re-reads on demand once a sign-in has completed', async () => {
        client.getAgentAuthStatus.mockResolvedValue(SIGNED_OUT);
        const { result } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(result.current.status?.loggedIn).toBe(false));

        client.getAgentAuthStatus.mockResolvedValue(SIGNED_IN);
        act(() => { result.current.refresh(); });

        await waitFor(() => expect(result.current.status?.loggedIn).toBe(true));
    });

    // The poll belongs to the mounted panel. A tab that navigated away from it must not keep
    // spawning `claude auth status` on the host forever.
    it('stops polling once unmounted', async () => {
        const { unmount } = renderHook(() => useChatAuth(true));
        await waitFor(() => expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(1));

        unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(CHAT_AUTH_POLL_MS * 3); });
        setVisibility('visible');

        expect(client.getAgentAuthStatus).toHaveBeenCalledTimes(1);
    });
});
